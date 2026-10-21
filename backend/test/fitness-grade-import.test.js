import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { importFitnessGrades } from '../scripts/import-fitness-grades.js';
import { buildFitnessGradeData } from '../scripts/fitness-grade-data.js';
import { fitnessFixture } from './fitness-grade-data.test.js';

const hash = value => createHash('sha256').update(value).digest('hex');

test('fitness import uses isolated PostgreSQL and preserves all account and exercise data',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 }, async t => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.match(url.pathname, /_test$/, 'A dedicated _test database is required');
    const schema = `fitness_import_${randomUUID().replaceAll('-', '')}`;
    const admin = new PrismaClient({ datasourceUrl: url.toString() });
    let db, created = false;
    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
      url.searchParams.set('schema', schema);
      await promisify(execFile)(process.execPath, [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 60000,
      });
      db = new PrismaClient({ datasourceUrl: url.toString() });
      const source = fitnessFixture(), all = buildFitnessGradeData(fitnessFixture(3)).students;
      const timestamp = new Date('2026-09-01T00:00:00.123Z');
      await db.user.createMany({ data: all.map((student, i) => ({
        id: randomUUID(), role: 'student', studentNumber: student.studentNumber, name: student.name, grade: 1, classNumber: 1,
        targetType: i ? 'optional' : 'required', passwordHash: `TEST-NO-LOGIN-${i}`, mustChangePassword: Boolean(i),
        weekendReminder: Boolean(i), lastLoginAt: i ? null : timestamp, createdAt: timestamp, updatedAt: timestamp,
      })) });
      const users = await db.user.findMany({ orderBy: { studentNumber: 'asc' } });
      const teacher = await db.user.create({ data: { role: 'teacher', studentNumber: 'TEST-TEACHER', name: 'TEST TEACHER', passwordHash: 'TEST-NO-LOGIN', mustChangePassword: false } });
      await db.session.create({ data: { id: 'TEST SESSION', userId: users[0].id, expiresAt: new Date('2030-01-01T00:00:00Z') } });
      await db.challengeMembership.create({ data: { challengeId: 'challenge-2026-self-fit', userId: users[0].id, mode: 'forced', status: 'active', invitedById: teacher.id } });
      await db.dailyRecord.create({ data: { challengeId: 'challenge-2026-self-fit', userId: users[0].id, date: '2026-05-04', value: 5 } });
      await db.notification.create({ data: { userId: users[0].id, eventKey: 'TEST-ONLY-EVENT', type: 'correction', title: 'TEST ONLY', body: 'TEST ONLY' } });
      const originalRows = all.map(student => {
        const row = Array(27).fill(null);
        Object.assign(row, { 0: student.studentNumber, 1: student.name, 2: 1, 3: 1, 4: '필수', 5: '참여', 6: 2026, 7: '예시',
          12: student.fitness.semester1.score, 13: student.fitness.semester1.grade, 14: student.fitness.semester2.score, 15: student.fitness.semester2.grade });
        return row;
      });
      const prior = await db.sourceDataset.create({ data: { hash: 'b'.repeat(64), filename: 'TEST-ORIGINAL.xlsx',
        metadataJson: { transform: 'same-exercise-week-block-v1', sourceSheets: { '학생명단': [[], [], [], [], [], ...originalRows] } } } });
      const revised = await db.sourceDataset.create({ data: { hash: 'c'.repeat(64), filename: 'TEST-REVISED.xlsx', metadataJson: { transform: 'twelve-week-participation-revision-v1' } } });
      for (const [index, user] of users.entries()) {
        await db.studentSource.create({ data: { datasetId: prior.id, userId: user.id, rosterJson: originalRows[index],
          fitnessJson: all[index].fitness, metadataJson: { sourceSheet: '학생명단', sourceRow: index + 6 } } });
        await db.studentSource.create({ data: { datasetId: revised.id, userId: user.id, rosterJson: ['TEST ONLY'],
          fitnessJson: all[index].fitness, metadataJson: { sourceSheet: '학생별현황', sourceRow: index + 6 } } });
      }
      await db.$executeRaw`UPDATE "SourceDataset" SET "metadataJson" = "metadataJson" || '{"precision":0.12345678901234567890123456789}'::jsonb WHERE "id" = ${prior.id}`;
      const snapshot = async () => {
        const [result] = await db.$queryRaw`SELECT jsonb_build_object(
          'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM "User" u),
          'sources',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM "SourceDataset" s),
          'rows',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM "StudentSource" s),
          'assessments',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM "StudentFitnessAssessment" s))::text AS text`;
        return hash(result.text);
      };
      const protectedSnapshot = async () => {
        const [result] = await db.$queryRaw`SELECT jsonb_build_object(
          'users',(SELECT jsonb_agg(to_jsonb(u)-'fitnessGrade'-'fitnessGradeYear'-'fitnessGradeSemester' ORDER BY u.id) FROM "User" u),
          'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM "Session" s),
          'records',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM "DailyRecord" s),
          'memberships',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM "ChallengeMembership" s),
          'notifications',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM "Notification" s),
          'sources',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM "SourceDataset" s WHERE s.id IN (${prior.id},${revised.id})),
          'rows',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM "StudentSource" s WHERE s."datasetId" IN (${prior.id},${revised.id})))::text AS text`;
        return hash(result.text);
      };
      const rejectWithoutChange = async (operation, pattern) => {
        const before = await snapshot(); await assert.rejects(operation, pattern); assert.equal(await snapshot(), before);
      };
      const protectedBefore = await protectedSnapshot();

      await t.test('preview does not write and distinguishes direct import from existing-source supplementation', async () => {
        const before = await snapshot(), result = await importFitnessGrades(db, source);
        assert.equal(result.mode, 'dry-run'); assert.equal(result.changed, false);
        assert.equal(result.matchedStudents, 2); assert.equal(result.supplementedStudents, 0);
        assert.equal(result.assessmentInserts, 4); assert.equal(result.cacheUpdates, 2);
        assert.equal(result.unlinkedSourceRows, 1);
        const allResult = await importFitnessGrades(db, source, { includeExisting: true });
        assert.equal(allResult.supplementedStudents, 1); assert.equal(allResult.assessmentInserts, 6);
        assert.equal(await snapshot(), before);
      });

      await t.test('identity mismatch, conflicting original values and invalid source coordinates fail closed', async () => {
        const mismatched = structuredClone(source); mismatched.sheets['2026 학생명단'][1][4] = 'TEST WRONG IDENTITY';
        await rejectWithoutChange(() => importFitnessGrades(db, mismatched, { apply: true }), /일치하지/);
        const row = await db.studentSource.findUnique({ where: { datasetId_userId: { datasetId: revised.id, userId: users[0].id } } });
        const changed = structuredClone(row.fitnessJson); changed.semester2.grade = 1;
        await db.studentSource.update({ where: { id: row.id }, data: { fitnessJson: changed } });
        await rejectWithoutChange(() => importFitnessGrades(db, source, { apply: true }), /학기 값이 다릅니다/);
        await db.studentSource.update({ where: { id: row.id }, data: { fitnessJson: row.fitnessJson } });
        const anchor = await db.studentSource.findUnique({ where: { datasetId_userId: { datasetId: prior.id, userId: users[0].id } } });
        await db.studentSource.update({ where: { id: anchor.id }, data: { metadataJson: { sourceSheet: '학생명단', sourceRow: 7 } } });
        await rejectWithoutChange(() => importFitnessGrades(db, source, { apply: true }), /보존된 파일과 다릅니다/);
        await db.studentSource.update({ where: { id: anchor.id }, data: { metadataJson: anchor.metadataJson } });
      });

      await t.test('database failure after provenance writes rolls the entire batch back', async () => {
        await db.$executeRawUnsafe(`CREATE FUNCTION fail_fitness_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId"='${users[2].id}' THEN RAISE EXCEPTION 'TEST late fitness failure'; END IF; RETURN NEW; END $$`);
        await db.$executeRawUnsafe('CREATE TRIGGER fail_fitness_batch BEFORE INSERT ON "StudentFitnessAssessment" FOR EACH ROW EXECUTE FUNCTION fail_fitness_batch()');
        try { await rejectWithoutChange(() => importFitnessGrades(db, source, { apply: true, includeExisting: true }), /TEST late fitness failure/); }
        finally {
          await db.$executeRawUnsafe('DROP TRIGGER fail_fitness_batch ON "StudentFitnessAssessment"');
          await db.$executeRawUnsafe('DROP FUNCTION fail_fitness_batch()');
        }
      });

      let applied;
      await t.test('direct import saves both semesters, preserves the complete source and does not create historical identities', async () => {
        applied = await importFitnessGrades(db, source, { apply: true });
        assert.equal(applied.changed, true); assert.equal(applied.sourceArchiveExact, true);
        assert.equal(await db.user.count(), 4); assert.equal(await db.studentFitnessAssessment.count(), 4);
        assert.equal(await db.studentSource.count({ where: { datasetId: applied.datasetId } }), 2);
        assert.equal(await db.studentFitnessAssessment.count({ where: { year: 2025 } }), 0);
        const saved = await db.sourceDataset.findUnique({ where: { id: applied.datasetId } });
        assert.deepEqual(saved.metadataJson.source, source);
        const user = await db.user.findUnique({ where: { id: users[0].id } });
        assert.deepEqual([user.fitnessGrade, user.fitnessGradeYear, user.fitnessGradeSemester], [3, 2026, 2]);
        assert.equal((await db.user.findUnique({ where: { id: users[2].id } })).fitnessGrade, null);
        assert.equal(await protectedSnapshot(), protectedBefore);
      });

      await t.test('same workbook rerun is exactly idempotent, and a later supplement adds only missing students', async () => {
        const before = await snapshot();
        const rerun = await importFitnessGrades(db, source, { apply: true });
        assert.equal(rerun.alreadyImported, true); assert.equal(rerun.changed, false);
        assert.equal(await snapshot(), before);
        const supplement = await importFitnessGrades(db, source, { apply: true, includeExisting: true });
        assert.equal(supplement.assessmentInserts, 2); assert.equal(supplement.cacheUpdates, 1);
        assert.equal(supplement.sourceDatasetInserts, 0); assert.equal(supplement.studentSourceInserts, 0);
        assert.equal(await db.studentFitnessAssessment.count(), 6);
        const history = await db.studentFitnessAssessment.findMany({ where: { userId: users[2].id }, orderBy: { semester: 'asc' } });
        assert(history.every(row => row.sourceDatasetId === prior.id && row.sourceSheet === '학생명단' && row.sourceRow === 8));
        const supplemented = await snapshot();
        assert.equal((await importFitnessGrades(db, source, { apply: true, includeExisting: true })).changed, false);
        assert.equal(await snapshot(), supplemented);
        assert.equal(await protectedSnapshot(), protectedBefore);
      });

      await t.test('changed archive or conflicting saved assessment is rejected without overwriting it', async () => {
        const changed = structuredClone(source); changed.sheets['분석 기준'][1][1] = 'CHANGED';
        await rejectWithoutChange(() => importFitnessGrades(db, changed, { apply: true }), /보존 원본이 다릅니다/);
        const row = await db.studentFitnessAssessment.findFirst({ where: { userId: users[0].id, semester: 1 } });
        await db.studentFitnessAssessment.update({ where: { id: row.id }, data: { score: row.score + 1 } });
        await rejectWithoutChange(() => importFitnessGrades(db, source, { apply: true }), /평가와 원본 값이 다릅니다/);
        await db.studentFitnessAssessment.update({ where: { id: row.id }, data: { score: row.score } });
      });

      await t.test('importing an older year cannot replace a newer confirmed second semester cache', async () => {
        await db.studentFitnessAssessment.create({ data: { userId: users[0].id, year: 2027, semester: 2, grade: 2, score: 60,
          sourceDatasetId: prior.id, sourceSheet: 'TEST FUTURE', sourceRow: 1 } });
        await db.$executeRaw`UPDATE "User" SET "fitnessGrade"=2,"fitnessGradeYear"=2027,"fitnessGradeSemester"=2 WHERE id=${users[0].id}`;
        const before = await snapshot();
        assert.equal((await importFitnessGrades(db, source, { apply: true, includeExisting: true })).changed, false);
        assert.equal(await snapshot(), before);
      });
    } finally {
      if (db) await db.$disconnect();
      if (created) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });
