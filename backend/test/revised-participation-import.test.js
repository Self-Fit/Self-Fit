import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { LEGACY_CHALLENGE_ID } from '../scripts/participation-data.js';
import { buildRevisedParticipationData } from '../scripts/revised-participation-data.js';
import { importRevisedParticipationData } from '../scripts/import-revised-participation.js';
import { makeRevisedSourceFixture } from './revised-participation-data.test.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const originalTime = new Date('2026-09-20T01:02:03.123Z');

test('revision importer uses real isolated PostgreSQL transactions and preserves protected data',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 }, async t => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.match(url.pathname, /_test$/, 'A dedicated database ending in _test is required');
    const schema = `revision_${randomUUID().replaceAll('-', '')}`;
    const admin = new PrismaClient({ datasourceUrl: url.toString() });
    let db, created = false;
    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
      url.searchParams.set('schema', schema);
      await promisify(execFile)(process.execPath, [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 60000,
      });
      db = new PrismaClient({ datasourceUrl: url.toString() });
      const source = makeRevisedSourceFixture(194), prepared = buildRevisedParticipationData(source);
      await db.user.createMany({ data: prepared.students.map((student, index) => ({
        id: randomUUID(), role: 'student', studentNumber: student.studentNumber, name: student.name, grade: student.grade,
        classNumber: student.classNumber, targetType: student.targetType,
        passwordHash: `TEST-ONLY-UNUSABLE-PASSWORD-${index}`, mustChangePassword: index !== 0, weekendReminder: index === 0,
        lastLoginAt: index === 0 ? originalTime : null, createdAt: originalTime, updatedAt: originalTime,
      })) });
      const teacher = await db.user.create({ data: { role: 'teacher', studentNumber: 'TEST-TEACHER', name: 'Synthetic teacher', passwordHash: 'TEST-ONLY-UNUSABLE-TEACHER', mustChangePassword: false } });
      const users = await db.user.findMany({ where: { role: 'student' }, orderBy: { studentNumber: 'asc' } });
      const first = users[0], second = users[1];
      await db.session.createMany({ data: [first, teacher].map(user => ({ id: `TEST-SESSION-${user.id}`, userId: user.id, createdAt: originalTime, expiresAt: new Date('2030-01-01T00:00:00Z') })) });
      const prior1 = await db.sourceDataset.create({ data: { hash: 'b'.repeat(64), filename: 'TEST-ONLY-ORIGINAL.xlsx', metadataJson: { transform: 'same-exercise-week-block-v1', preserved: true } } });
      const prior2 = await db.sourceDataset.create({ data: { hash: 'c'.repeat(64), filename: 'TEST-ONLY-DUMBBELL.xlsx', metadataJson: { transform: 'week12-dumbbell-sets-v1', preserved: true } } });
      await db.studentSource.createMany({ data: users.map(user => ({ datasetId: prior1.id, userId: user.id, rosterJson: ['TEST ORIGINAL'], fitnessJson: { semester1: { score: 30.125, grade: 3 }, semester2: { score: 32.625, grade: 3 } } })) });
      await db.$executeRaw`UPDATE "SourceDataset" SET "metadataJson" = "metadataJson" || '{"precision":0.12345678901234567890123456789}'::jsonb WHERE "id" = ${prior1.id}`;
      const oldSpecs = [
        { userId: first.id, date: '2026-05-04', value: 0, sourceDatasetId: prior1.id },
        { userId: first.id, date: '2026-05-18', value: true, sourceDatasetId: prior1.id },
        { userId: first.id, date: '2026-05-25', value: 7, sourceDatasetId: prior1.id },
        { userId: first.id, date: '2026-05-05', value: 5, sourceDatasetId: prior1.id },
        { userId: first.id, date: '2026-06-29', value: 0.1, sourceDatasetId: prior1.id },
        { userId: first.id, date: '2026-08-31', value: { D12_ROW: 2, D12_CURL: 2, D12_SQUAT: 2 }, sourceDatasetId: prior2.id },
        { userId: first.id, date: '2026-09-03', value: { D12_CURL: 2, D12_SQUAT: 2, D12_ROW: 2 }, sourceDatasetId: prior2.id },
        { userId: second.id, date: '2026-08-31', value: { D12_CURL: 1, D12_SQUAT: 1, D12_ROW: 1 }, sourceDatasetId: prior2.id },
      ];
      await db.dailyRecord.createMany({ data: oldSpecs.map(record => ({ id: randomUUID(), challengeId: LEGACY_CHALLENGE_ID, ...record, sourceMetadata: { isSynthetic: true, oldSourceRow: 11 }, createdAt: originalTime, updatedAt: originalTime })) });
      // More precision than JS can represent checks that both archival and change detection use JSONB.
      await db.$executeRaw`UPDATE "DailyRecord" SET "value" = '0.10000000000000000000001'::jsonb,
        "sourceMetadata" = '{"isSynthetic":true,"precise":0.12345678901234567890123456789}'::jsonb WHERE "userId" = ${first.id} AND "date" = '2026-06-29'`;
      const originalRecords = await db.dailyRecord.findMany({ orderBy: { id: 'asc' } });
      const record = originalRecords.find(row => row.date === '2026-05-18');

      const snapshot = async () => {
        const [result] = await db.$queryRaw`SELECT jsonb_build_object(
          'users', (SELECT jsonb_agg(to_jsonb(u) ORDER BY u."id") FROM "User" u),
          'sessions', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "Session" s),
          'datasets', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "SourceDataset" s),
          'sourceRows', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "StudentSource" s),
          'records', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r."id") FROM "DailyRecord" r),
          'revisions', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r."id") FROM "RecordRevision" r),
          'corrections', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r."id") FROM "Correction" r),
          'attachments', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r."id") FROM "Attachment" r),
          'memberships', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m."id") FROM "ChallengeMembership" m))::text AS "text"`;
        return hash(result.text);
      };
      const protectedSnapshot = async () => {
        const [result] = await db.$queryRaw`SELECT jsonb_build_object(
          'users', (SELECT jsonb_agg(to_jsonb(u) ORDER BY u."id") FROM "User" u),
          'sessions', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "Session" s),
          'datasets', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "SourceDataset" s WHERE s."id" IN (${prior1.id}, ${prior2.id})),
          'sourceRows', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "StudentSource" s WHERE s."datasetId" IN (${prior1.id}, ${prior2.id})))::text AS "text"`;
        return hash(result.text);
      };
      const unchanged = async (operation, pattern) => {
        const before = await snapshot();
        await assert.rejects(operation, pattern);
        assert((await snapshot()) === before, 'A rejected import must leave every row unchanged');
      };

      await t.test('default preview is read-only and calculates inserts, changes, unchanged values and blank deletions exactly', async () => {
        const before = await snapshot(), preview = await importRevisedParticipationData(db, source);
        assert.equal(preview.readyToApply, true); assert.equal(preview.changed, false);
        assert.deepEqual(preview.operations, { inserted: prepared.records.length - 7, changed: 5, unchanged: 2, deleted: 1 });
        assert.equal(preview.expectedRecordsAfter, prepared.records.length);
        assert((await snapshot()) === before, 'Preview must not change anything');
        await unchanged(() => importRevisedParticipationData(db, makeRevisedSourceFixture(2), { apply: true }), /194/);
      });

      await t.test('full roster mismatch, unrecognized source, edited versions and timestamps abort without any writes', async () => {
        const outsider = await db.user.create({ data: { role: 'student', studentNumber: '99999', name: 'TEST OUTSIDER', grade: 1, classNumber: 1, targetType: 'optional', passwordHash: 'TEST-NO-LOGIN' } });
        await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /complete database student roster differs/);
        await db.user.delete({ where: { id: outsider.id } });
        await db.$executeRaw`UPDATE "User" SET "name" = 'TEST CHANGED IDENTITY' WHERE "id" = ${first.id}`;
        await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /identity or participation/);
        await db.$executeRaw`UPDATE "User" SET "name" = ${first.name} WHERE "id" = ${first.id}`;
        await db.$executeRaw`UPDATE "DailyRecord" SET "sourceDatasetId" = NULL WHERE "id" = ${record.id}`;
        await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /unrecognized import source/);
        await db.$executeRaw`UPDATE "DailyRecord" SET "sourceDatasetId" = ${prior1.id}, "version" = 2 WHERE "id" = ${record.id}`;
        await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /was edited/);
        await db.$executeRaw`UPDATE "DailyRecord" SET "version" = 1, "updatedAt" = ${new Date('2026-09-21T00:00:00Z')} WHERE "id" = ${record.id}`;
        await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /was edited/);
        await db.$executeRaw`UPDATE "DailyRecord" SET "updatedAt" = "createdAt" WHERE "id" = ${record.id}`;
        const foreign = await db.dailyRecord.create({ data: { challengeId: LEGACY_CHALLENGE_ID, userId: first.id, date: '2026-05-11', value: 1, sourceDatasetId: prior1.id, sourceMetadata: {}, createdAt: originalTime, updatedAt: originalTime } });
        await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /outside this roster/);
        await db.dailyRecord.delete({ where: { id: foreign.id } });
      });

      await t.test('attachments, all correction states and revisions block replacement and deletion', async () => {
        const missing = originalRecords.find(row => row.date === '2026-05-05');
        const attachment = await db.attachment.create({ data: { recordId: missing.id, name: 'TEST ONLY.png', storageKey: `test-${randomUUID()}`, kind: 'image', mimeType: 'image/png', size: 1 } });
        await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /Corrections, revisions, or attachments/);
        await db.attachment.delete({ where: { id: attachment.id } });
        for (const status of ['pending', 'approved', 'rejected']) {
          const correction = await db.correction.create({ data: { recordId: record.id, requesterId: first.id, beforeValue: true, requestedValue: false, baseVersion: 1, reason: 'TEST ONLY', status, decisionReason: status === 'rejected' ? 'TEST REJECTION' : null } });
          await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /Corrections, revisions, or attachments/);
          await db.correction.delete({ where: { id: correction.id } });
        }
        const revision = await db.recordRevision.create({ data: { recordId: record.id, value: false, version: 1, actorId: teacher.id, source: 'TEST ONLY' } });
        await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /Corrections, revisions, or attachments/);
        await db.recordRevision.delete({ where: { id: revision.id } });
      });

      await t.test('a real database trigger failure after earlier writes rolls back the entire revision', async () => {
        const ids = new Map(users.map(user => [user.studentNumber, user.id]));
        const late = prepared.records[600], lateUser = ids.get(late.studentNumber);
        await db.$executeRawUnsafe(`CREATE FUNCTION "fail_revision_batch"() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW."userId" = '${lateUser}' AND NEW."date" = '${late.date}' THEN RAISE EXCEPTION 'TEST late batch failure'; END IF; RETURN NEW; END $$`);
        await db.$executeRawUnsafe('CREATE TRIGGER "fail_revision_batch" BEFORE INSERT OR UPDATE ON "DailyRecord" FOR EACH ROW EXECUTE FUNCTION "fail_revision_batch"()');
        try { await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /TEST late batch failure/); }
        finally {
          await db.$executeRawUnsafe('DROP TRIGGER "fail_revision_batch" ON "DailyRecord"');
          await db.$executeRawUnsafe('DROP FUNCTION "fail_revision_batch"()');
        }
      });

      await t.test('a concurrent correction wins before validation or makes the revision abort; it is never lost', async () => {
        let release, signal;
        const releaseGate = new Promise(resolve => { release = resolve; });
        const acquired = new Promise(resolve => { signal = resolve; });
        let correctionId;
        const writer = db.$transaction(async tx => {
          const correction = await tx.correction.create({ data: { recordId: record.id, requesterId: first.id, beforeValue: true, requestedValue: false, baseVersion: 1, reason: 'TEST CONCURRENT' } });
          correctionId = correction.id; signal(); await releaseGate;
        }, { timeout: 15000 });
        await acquired;
        const attempt = importRevisedParticipationData(db, source, { apply: true });
        // The correction transaction holds its write lock until after import has begun.
        await new Promise(resolve => setTimeout(resolve, 100)); release(); await writer;
        await assert.rejects(attempt, /Corrections, revisions, or attachments|P2034|serialize|deadlock/i);
        assert.equal(await db.sourceDataset.count(), 2); assert.equal(await db.dailyRecord.count(), oldSpecs.length);
        assert.equal(await db.correction.count({ where: { id: correctionId } }), 1);
        await db.correction.delete({ where: { id: correctionId } });
      });

      let applied;
      await t.test('apply archives exact old JSONB, preserves accounts/sessions/prior sources, retains IDs and updates only changed value versions', async () => {
        const protectedBefore = await protectedSnapshot();
        const [before] = await db.$queryRaw`SELECT jsonb_agg(to_jsonb(r) ORDER BY r."id")::text AS "text" FROM "DailyRecord" r`;
        const otherChallenge = await db.challenge.create({ data: { title: 'Unrelated challenge', year: 2026, startDate: '2026-05-04', endDate: '2026-05-10', enrollmentDeadline: '2026-05-03' } });
        const unrelated = await db.dailyRecord.create({ data: { challengeId: otherChallenge.id, userId: first.id, date: '2026-05-04', value: 4 } });
        const unrelatedRevision = await db.recordRevision.create({ data: { recordId: unrelated.id, value: 2, version: 1, actorId: teacher.id, source: 'TEST OTHER CHALLENGE' } });
        applied = await importRevisedParticipationData(db, source, { apply: true });
        assert.deepEqual(await db.dailyRecord.findUnique({ where: { id: unrelated.id } }), unrelated);
        assert.deepEqual(await db.recordRevision.findUnique({ where: { id: unrelatedRevision.id } }), unrelatedRevision);
        await db.recordRevision.delete({ where: { id: unrelatedRevision.id } });
        await db.dailyRecord.delete({ where: { id: unrelated.id } });
        await db.challenge.delete({ where: { id: otherChallenge.id } });
        assert.equal(applied.changed, true); assert.equal(applied.previousRecordsArchiveExact, true);
        assert.deepEqual(applied.operations, { inserted: prepared.records.length - 7, changed: 5, unchanged: 2, deleted: 1 });
        assert((await protectedSnapshot()) === protectedBefore, 'All User fields, passwords, Sessions, prior datasets and fitness rows must be unchanged');
        const [archive] = await db.$queryRaw`SELECT ("metadataJson"->'revision'->'previousRecords') = ${before.text}::jsonb AS "exact",
          ("metadataJson"->'source') = ${JSON.stringify(source)}::jsonb AS "sourceExact"
          FROM "SourceDataset" WHERE "id" = ${applied.datasetId}`;
        assert.equal(archive.exact, true); assert.equal(archive.sourceExact, true);
        assert.equal(await db.dailyRecord.count(), prepared.records.length);
        assert.equal(await db.studentSource.count({ where: { datasetId: applied.datasetId } }), 194);
        assert.equal(await db.challengeMembership.count({ where: { challengeId: LEGACY_CHALLENGE_ID, status: 'active' } }), 194);
        assert.equal(await db.dailyRecord.count({ where: { challengeId: LEGACY_CHALLENGE_ID } }), prepared.records.length);
        for (const old of originalRecords) {
          const current = await db.dailyRecord.findUnique({ where: { id: old.id } });
          if (old.date === '2026-05-05') { assert.equal(current, null); continue; }
          assert.equal(current.id, old.id); assert.deepEqual(current.createdAt, old.createdAt);
          const same = old.date === '2026-05-04' || (old.date === '2026-08-31' && old.userId === first.id);
          assert.equal(current.version, same ? 1 : 2);
          if (same) assert.deepEqual(current.updatedAt, old.updatedAt);
          else assert(current.updatedAt > old.updatedAt);
        }
        const values = await db.dailyRecord.findMany({ where: { userId: first.id } });
        assert.equal(values.find(row => row.date === '2026-05-04').value, 0);
        assert.equal(values.find(row => row.date === '2026-05-18').value, false);
        assert.equal(values.find(row => row.date === '2026-05-25').value, 0);
        assert.deepEqual(values.find(row => row.date === '2026-09-03').value, { D12_CURL: 0, D12_SQUAT: null, D12_ROW: 1 });
        assert(!values.some(row => row.date === '2026-09-04'));
      });

      await t.test('pre-challenge revision fingerprints remain valid and other challenge dates stay isolated', async () => {
        const [saved] = await db.$queryRaw`SELECT "metadataJson"::text AS "text" FROM "SourceDataset" WHERE "id" = ${applied.datasetId}`;
        const [snapshots] = await db.$queryRaw`SELECT
          (SELECT jsonb_agg(value - 'challengeId')::text FROM jsonb_array_elements("metadataJson"->'revision'->'previousRecords')) AS "before",
          (SELECT jsonb_agg(to_jsonb(r) - 'challengeId' ORDER BY r."id")::text FROM "DailyRecord" r WHERE r."challengeId" = ${LEGACY_CHALLENGE_ID}) AS "after"
          FROM "SourceDataset" WHERE "id" = ${applied.datasetId}`;
        // This recreates the exact archive shape written before the schema added
        // challengeId, without converting its precise JSON numbers through JS.
        await db.$executeRaw`UPDATE "SourceDataset" SET "metadataJson" = jsonb_set("metadataJson", '{revision}',
          (("metadataJson"->'revision') - 'recordSnapshotVersion' - 'previousRecords' - 'previousRecordsSha256' - 'afterRecordsSha256')
          || jsonb_build_object('previousRecords', ${snapshots.before}::jsonb, 'previousRecordsSha256', ${hash(snapshots.before)}, 'afterRecordsSha256', ${hash(snapshots.after)}))
          WHERE "id" = ${applied.datasetId}`;
        const other = await db.challenge.create({ data: { title: 'Other challenge', year: 2026, startDate: '2026-05-04', endDate: '2026-05-10', enrollmentDeadline: '2026-05-03' } });
        const foreign = await db.dailyRecord.create({ data: { challengeId: other.id, userId: first.id, date: '2026-05-04', value: 3 } });
        const before = await snapshot();
        try {
          const result = await importRevisedParticipationData(db, source, { apply: true });
          assert.equal(result.alreadyImported, true); assert.equal(result.changed, false);
          assert.equal(await snapshot(), before, 'Existing source archive, memberships and other challenge records remain untouched');
          assert.equal((await db.dailyRecord.findUnique({ where: { id: foreign.id } })).value, 3);
        } finally {
          await db.dailyRecord.delete({ where: { id: foreign.id } });
          await db.challenge.delete({ where: { id: other.id } });
          await db.$executeRaw`UPDATE "SourceDataset" SET "metadataJson" = ${saved.text}::jsonb WHERE "id" = ${applied.datasetId}`;
        }
      });

      await t.test('same workbook rerun verifies every field without writes and refuses later changes', async () => {
        const before = await snapshot();
        const rerun = await importRevisedParticipationData(db, source, { apply: true });
        assert.equal(rerun.alreadyImported, true); assert.equal(rerun.changed, false);
        assert((await snapshot()) === before, 'Idempotent rerun must write nothing');
        const membership = await db.challengeMembership.findUnique({ where: { challengeId_userId: { challengeId: LEGACY_CHALLENGE_ID, userId: first.id } } });
        await db.challengeMembership.delete({ where: { id: membership.id } });
        await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /레거시 참여 정보가 누락/);
        await db.challengeMembership.create({ data: membership });
        await db.dailyRecord.update({ where: { id: record.id }, data: { value: true, version: { increment: 1 } } });
        await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /records differ/);
        await db.dailyRecord.update({ where: { id: record.id }, data: { value: false } });
        await unchanged(() => importRevisedParticipationData(db, source, { apply: true }), /modified after the revision/);
      });
    } finally {
      if (db) await db.$disconnect();
      if (created) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });
