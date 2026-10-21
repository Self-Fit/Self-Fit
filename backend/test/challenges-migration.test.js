import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { LEGACY_WEEKS, activityDates, summarizeProgram } from '../src/domain/index.js';
import { LEGACY_CHALLENGE_ID, legacyChallengeId } from '../scripts/participation-data.js';

const backend = fileURLToPath(new URL('../', import.meta.url));
const migration = '20261020120000_challenges';
const oldMigrations = ['20261020000000_initial', '20261020010000_last_login', '20261020020000_source_provenance'];
const exec = promisify(execFile);

test('challenge migration backfills existing data exactly and enforces challenge boundaries',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async t => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.match(url.pathname, /_test$/, 'A dedicated database ending in _test is required');
    const schema = `migration_${randomUUID().replaceAll('-', '')}`;
    const admin = new PrismaClient({ datasourceUrl: url.toString() });
    let db, created = false;
    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
      url.searchParams.set('schema', schema);
      const executeMigration = folder => exec(process.execPath, [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'db', 'execute',
        '--schema', 'prisma/schema.prisma', '--file', `prisma/migrations/${folder}/migration.sql`], {
        cwd: backend, env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 30000,
      });
      for (const folder of oldMigrations) await executeMigration(folder);
      db = new PrismaClient({ datasourceUrl: url.toString() });
      const teacher = await db.user.create({ data: { role: 'teacher', studentNumber: 'TEST-TEACHER', name: '테스트 교사', passwordHash: 'TEST-ONLY-UNUSABLE-HASH' } });
      // The current Prisma schema no longer has User.participating; raw inserts reproduce the old accounts.
      const insertUser = async ({ role, studentNumber, name, grade = null, classNumber = null, targetType = null, participating = false, passwordHash }) => {
        const id = randomUUID();
        await db.$executeRaw`INSERT INTO "User" ("id", "role", "studentNumber", "name", "grade", "classNumber", "targetType", "participating", "passwordHash", "updatedAt")
          VALUES (${id}, ${role}, ${studentNumber}, ${name}, ${grade}, ${classNumber}, ${targetType}, ${participating}, ${passwordHash}, CURRENT_TIMESTAMP)`;
        return { id, role, studentNumber, name, grade, classNumber, targetType, participating };
      };
      const required = await insertUser({ role: 'student', studentNumber: 'TEST-REQUIRED', name: '필수 학생', grade: 1, classNumber: 1, targetType: 'required', participating: true, passwordHash: 'TEST-ONLY-UNUSABLE-HASH' });
      const requiredInactive = await insertUser({ role: 'student', studentNumber: 'TEST-REQUIRED-NOT-PARTICIPATING', name: '필수 기존 상태', grade: 1, classNumber: 1, targetType: 'required', participating: false, passwordHash: 'TEST-ONLY-UNUSABLE-HASH' });
      const optional = await insertUser({ role: 'student', studentNumber: 'TEST-OPTIONAL', name: '선택 학생', grade: 1, classNumber: 1, targetType: 'optional', participating: true, passwordHash: 'TEST-ONLY-UNUSABLE-HASH' });
      const outsider = await insertUser({ role: 'student', studentNumber: 'TEST-NONPARTICIPANT', name: '미참여 학생', grade: 1, classNumber: 1, targetType: 'optional', participating: false, passwordHash: 'TEST-ONLY-UNUSABLE-HASH' });
      const source = await db.sourceDataset.create({ data: { hash: 'a'.repeat(64), filename: 'TEST-LEGACY.xlsx', metadataJson: {} } });
      await db.$executeRaw`UPDATE "SourceDataset" SET "metadataJson" = '{"original":0.12345678901234567890123456789,"revision":{"afterRecordsSha256":"TEST-IMMUTABLE-FINGERPRINT"}}'::jsonb WHERE "id" = ${source.id}`;
      await db.studentSource.create({ data: { datasetId: source.id, userId: required.id, rosterJson: ['TEST ONLY'], fitnessJson: { score: 30.25 } } });
      // Session gains push device columns in a later migration, so insert the old shape directly.
      await db.$executeRaw`INSERT INTO "Session" ("id", "userId", "expiresAt") VALUES ('TEST-IMMUTABLE-SESSION', ${required.id}, '2030-01-01T00:00:00Z')`;
      // Current Prisma expects challengeId; raw inserts reproduce the actual old schema.
      for (const [index, item] of [
        ...['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08'].map(date => ({ date, value: 5 })),
        { date: '2026-05-18', value: false }, { date: '2026-05-25', value: 1000 }, { date: '2026-06-29', value: 0 },
        ...['2026-08-31', '2026-09-01', '2026-09-02'].map(date => ({ date, value: { D12_CURL: 2, D12_SQUAT: 2, D12_ROW: 2 } })),
      ].entries()) {
        await db.$executeRaw`INSERT INTO "DailyRecord" ("id", "userId", "date", "value", "sourceDatasetId", "sourceMetadata", "createdAt", "updatedAt")
          VALUES (${`legacy-record-${index}`}, ${required.id}, ${item.date}, ${JSON.stringify(item.value)}::jsonb, ${source.id}, '{"original":0.12345678901234567890123456789}'::jsonb,
            '2026-09-04T12:34:56.789Z', '2026-09-04T12:34:56.789Z')`;
      }
      await db.$executeRaw`INSERT INTO "Notification" ("id", "userId", "eventKey", "type", "title", "body")
        VALUES ('TEST-NOTIFICATION', ${required.id}, ${`reminder:${required.id}:2026-05-04`}, 'reminder', '기존 알림', '그대로 보존')`;
      const snapshot = async () => {
        const [value] = await db.$queryRaw`SELECT jsonb_build_object(
          'users', (SELECT jsonb_agg(to_jsonb(u) ORDER BY u."id") FROM "User" u),
          'records', (SELECT jsonb_agg(to_jsonb(r) - 'challengeId' ORDER BY r."id") FROM "DailyRecord" r),
          'sessions', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "Session" s),
          'notifications', (SELECT jsonb_agg(to_jsonb(n) - 'data' ORDER BY n."id") FROM "Notification" n),
          'sources', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "SourceDataset" s),
          'sourceRows', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "StudentSource" s))::text AS "text"`;
        return value.text;
      };
      const before = await snapshot();
      const oldRecords = await db.$queryRaw`SELECT "date", "value" FROM "DailyRecord" ORDER BY "date"`;
      const oldSummary = summarizeProgram(LEGACY_WEEKS, oldRecords);
      assert.equal(oldSummary.completedWeeks, 3);
      await executeMigration(migration);

      await t.test('legacy definitions, records, identities, credentials, sessions and source archives are preserved', async () => {
        assert.equal(await snapshot(), before);
        assert.equal(await legacyChallengeId(db), LEGACY_CHALLENGE_ID);
        const challenge = await db.challenge.findUnique({ where: { id: LEGACY_CHALLENGE_ID }, include: { weeks: { orderBy: { week: 'asc' } }, memberships: true } });
        assert.equal(challenge.createdById, teacher.id); assert.equal(challenge.lifecycle, 'published');
        assert.equal(challenge.title, '2026 Self Fit 챌린지');
        assert.equal(challenge.weeks.length, 12); assert.equal(activityDates(challenge.weeks).length, 82);
        for (const [index, actual] of challenge.weeks.entries()) {
          const { id, challengeId, exercises, ...fields } = actual;
          const { deferred, exercises: expectedExercises, ...expectedFields } = LEGACY_WEEKS[index];
          assert.deepEqual(fields, expectedFields); assert.deepEqual(exercises, expectedExercises ?? null);
        }
        assert.equal(await db.dailyRecord.count({ where: { challengeId: LEGACY_CHALLENGE_ID } }), 11);
        assert.deepEqual(summarizeProgram(challenge.weeks, await db.dailyRecord.findMany()), oldSummary);
        const members = new Map(challenge.memberships.map(member => [member.userId, member]));
        assert.equal(members.size, 3); assert.equal(members.has(teacher.id), false); assert.equal(members.has(outsider.id), false);
        for (const user of [required, requiredInactive]) assert.equal(members.get(user.id).mode, 'forced');
        assert.equal(members.get(optional.id).mode, 'invited');
        assert(challenge.memberships.every(member => member.status === 'active' && member.invitedById === teacher.id));
        assert.equal((await db.notification.findUnique({ where: { id: 'TEST-NOTIFICATION' } })).data, null);
      });

      await t.test('same-day records remain unique within one challenge but may coexist across challenges', async () => {
        const other = await db.challenge.create({ data: { title: '다른 챌린지', year: 2026, startDate: '2026-05-04', endDate: '2026-05-10', enrollmentDeadline: '2026-05-03' } });
        await db.dailyRecord.create({ data: { challengeId: other.id, userId: required.id, date: '2026-05-04', value: 0 } });
        await assert.rejects(db.dailyRecord.create({ data: { challengeId: LEGACY_CHALLENGE_ID, userId: required.id, date: '2026-05-04', value: 0 } }), { code: 'P2002' });
        assert.equal(await db.dailyRecord.count({ where: { userId: required.id, date: '2026-05-04' } }), 2);
      });

      await t.test('database rejects invalid enums, dates and out-of-period weeks, including parent changes', async () => {
        const data = { title: '제약 검사', year: 2027, startDate: '2027-03-01', endDate: '2027-03-07', enrollmentDeadline: '2027-02-28' };
        await assert.rejects(db.challenge.create({ data: { ...data, lifecycle: 'unknown' } }));
        await assert.rejects(db.challenge.create({ data: { ...data, startDate: '2027-03-09' } }));
        const challenge = await db.challenge.create({ data });
        const week = { challengeId: challenge.id, week: 1, title: '걷기', startDate: data.startDate, endDate: data.endDate, inputType: 'walking', weeklyTarget: 5, unit: '일', color: '#123456' };
        await assert.rejects(db.challengeWeek.create({ data: { ...week, inputType: 'unknown' } }));
        await assert.rejects(db.challengeWeek.create({ data: { ...week, endDate: '2027-03-08' } }));
        await db.challengeWeek.create({ data: week });
        await assert.rejects(db.challenge.update({ where: { id: challenge.id }, data: { endDate: '2027-03-06' } }));
        await assert.rejects(db.challengeMembership.create({ data: { challengeId: challenge.id, userId: optional.id, mode: 'unknown', status: 'active' } }));
        await assert.rejects(db.challengeMembership.create({ data: { challengeId: challenge.id, userId: optional.id, mode: 'invited', status: 'unknown' } }));
        await db.$transaction(async tx => {
          await tx.challenge.update({ where: { id: challenge.id }, data: { startDate: '2027-03-08', endDate: '2027-03-14' } });
          await tx.challengeWeek.updateMany({ where: { challengeId: challenge.id }, data: { startDate: '2027-03-08', endDate: '2027-03-14' } });
        });
        assert.equal((await db.challengeWeek.findFirst({ where: { challengeId: challenge.id } })).startDate, '2027-03-08');
      });

      await t.test('dropping User.participating keeps every legacy membership', async () => {
        const memberships = await db.challengeMembership.findMany({ where: { challengeId: LEGACY_CHALLENGE_ID }, orderBy: { userId: 'asc' } });
        assert.ok(memberships.length >= 2);
        await executeMigration('20261021090000_drop_user_participating');
        const [{ count }] = await db.$queryRaw`SELECT count(*)::int AS count FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'participating'`;
        assert.equal(count, 0);
        assert.deepEqual(await db.challengeMembership.findMany({ where: { challengeId: LEGACY_CHALLENGE_ID }, orderBy: { userId: 'asc' } }), memberships);
        assert.equal((await db.user.findUnique({ where: { id: optional.id } })).studentNumber, 'TEST-OPTIONAL');
      });
    } finally {
      if (db) await db.$disconnect();
      if (created) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });
