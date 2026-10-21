import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { buildDumbbellData } from '../scripts/dumbbell-data.js';
import { LEGACY_CHALLENGE_ID } from '../scripts/participation-data.js';
import { importDumbbellData } from '../scripts/import-dumbbell-data.js';

const dates = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
const ids = ['D12_CURL', 'D12_SQUAT', 'D12_ROW'];
const titles = ['덤벨 컬', '덤벨 스쿼트', '덤벨 로우'];
function fixture(values = day => day === 0 ? [null, null, null] : [2, 2, 2], count = 1) {
  const sheets = { 운동기준: Array.from({ length: 43 }, () => []), 주간요약: Array.from({ length: 12 }, () => []), 일별집계: Array.from({ length: 5 }, () => []), 운동별기록: Array.from({ length: 5 }, () => []) };
  sheets.운동기준[4] = ['활동일', '운동 식별값', '운동명', '세트당 반복 수', '목표 세트', '좌우 수행 기준', '필수 여부', '완료 세트 기준', '기준 연결키(자동)'];
  sheets.운동별기록[4] = ['학번', '활동일', '운동 식별값', '완료 세트', '운영연도', '자료 상태', '최초등록일시', '최종수정일시', '이름', '운동명', '세트당 반복 수', '목표 세트', '환산 횟수', '기록 여부', '목표 충족', '자료 종류', '비고'];
  sheets.일별집계[4] = ['학번', '이름', '활동일', '제출 운동 수', '기록일(1/0)', '충족 운동 수', '완료일(1/0)', '환산 총횟수', '일일 상태', '비고', '자료 종류'];
  sheets.주간요약[11] = ['학번', '이름', '학년', '반', '1학기 등급(실제)', '점수 변화(실제)', '기존 기록일(106일)', '12주 기록일(5일)', '12주 참여율', '12주 완료일', '주간 완료', '환산 총횟수', '합산 참여율(111일)', '비고'];
  for (const [day, date] of dates.entries()) for (const [index, id] of ids.entries()) sheets.운동기준[5 + day * 3 + index] = [date, id, titles[index], 10, 2, index === 1 ? '전체 10회 = 1세트' : '좌우 각각 10회 = 1세트', '필수', '10회 끝낸 세트만 인정', `${day}|${id}`];
  for (const [row, value] of [[23, 106], [24, 5], [25, 111], [26, 3], [27, 3], [32, 0.3], [33, 0.5], [34, 0.8]]) sheets.운동기준[row] = ['기준', value];
  let groupRecorded = 0, groupCompleted = 0;
  for (let student = 0; student < count; student++) {
    const studentNumber = String(10101 + student), name = `TEST ONLY ${student}`;
    let recorded = 0, completed = 0, totalReps = 0;
    for (const [day, date] of dates.entries()) {
      const sets = values(day), submitted = sets.filter(value => value !== null).length, achieved = sets.filter(value => value !== null && value >= 2).length;
      const reps = sets.reduce((sum, value) => sum + (value ?? 0) * 10, 0), complete = achieved === 3 ? 1 : 0;
      recorded += submitted > 0 ? 1 : 0; completed += complete; totalReps += reps;
      for (const [index, id] of ids.entries()) {
        const value = sets[index];
        sheets.운동별기록.push([studentNumber, date, id, value, 2026, '가상 입력', null, null, name, titles[index], 10, 2, value === null ? null : value * 10, value === null ? 0 : 1, value !== null && value >= 2 ? 1 : 0, '예시', 'TEST ONLY']);
      }
      sheets.일별집계.push([studentNumber, name, date, submitted, submitted ? 1 : 0, achieved, complete, reps, !submitted ? '미입력' : complete ? '완료' : reps ? '부분 수행' : '0세트 제출', 'TEST ONLY', '가상']);
    }
    sheets.주간요약.push([studentNumber, name, 1, 1, 3, -2, 17, recorded, recorded / 5, completed, completed >= 3 ? '완료' : '미완료', totalReps, (17 + recorded) / 111, 'TEST ONLY']);
    groupRecorded += recorded; groupCompleted += completed >= 3 ? 1 : 0;
  }
  sheets.주간요약[5] = ['1·2등급', 0, 0.3, 0, 0, null, 0];
  sheets.주간요약[6] = ['3등급', count, 0.5, groupRecorded, count * 5, groupRecorded / (count * 5), groupCompleted];
  sheets.주간요약[7] = ['4·5등급', 0, 0.8, 0, 0, null, 0];
  return { filename: 'TEST-ONLY-dumbbell.xlsx', sha256: 'a'.repeat(64), sheets, formulaCells: Object.fromEntries(Object.keys(sheets).map(name => [name, []])), dateEpoch: '1899-12-30T00:00:00' };
}

test('missing days are omitted; zero, partial blanks and excess sets retain their exact meaning', () => {
  const source = fixture(day => [[null, null, null], [0, 0, 0], [2, 2, 2], [3, 1, 2], [3, null, 0]][day]);
  const before = JSON.stringify(source), result = buildDumbbellData(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.records.length, 4);
  assert.deepEqual(result.records[0].value, { D12_CURL: 0, D12_SQUAT: 0, D12_ROW: 0 });
  assert.deepEqual(result.records[3].value, { D12_CURL: 3, D12_SQUAT: null, D12_ROW: 0 });
  assert.equal(result.summary.completedDays, 1, 'total repetitions cannot replace three separate exercise targets');
  assert.equal(result.summary.completedStudents, 0);
  assert.equal(result.students[0].exerciseRows.length, 15);
  assert.equal(result.students[0].dailyRows.length, 5);
  assert.deepEqual(result.students[0].weeklyRow, source.sheets.주간요약[12]);
  const record = result.records[0];
  assert.equal(record.sourceMetadata.sourceRow, 7);
  assert.deepEqual(record.sourceMetadata.exercises.map(item => item.sourceRow), [9, 10, 11]);
  assert.ok(record.sourceMetadata.isSynthetic);
});

test('three qualifying days complete the week; two days do not', () => {
  assert.equal(buildDumbbellData(fixture(day => day < 3 ? [2, 2, 2] : [null, null, null])).summary.completedStudents, 1);
  assert.equal(buildDumbbellData(fixture(day => day < 2 ? [10, 10, 10] : [null, null, null])).summary.completedStudents, 0);
});

test('duplicate or missing identities and exercise keys cannot silently disappear', () => {
  const duplicateStudent = fixture(); duplicateStudent.sheets.주간요약.push([...duplicateStudent.sheets.주간요약[12]]);
  assert.throws(() => buildDumbbellData(duplicateStudent), /학번 오류 또는 중복/);
  const duplicateExercise = fixture(); duplicateExercise.sheets.운동별기록.push([...duplicateExercise.sheets.운동별기록[5]]);
  assert.throws(() => buildDumbbellData(duplicateExercise), /종목 중복/);
  const missingExercise = fixture(); missingExercise.sheets.운동별기록.pop();
  assert.throws(() => buildDumbbellData(missingExercise), /원본 행 누락/);
  const foreign = fixture(); foreign.sheets.운동별기록[5][0] = '99999';
  assert.throws(() => buildDumbbellData(foreign), /학번·날짜·종목/);
  const missingDay = fixture(); missingDay.sheets.일별집계.pop();
  assert.throws(() => buildDumbbellData(missingDay), /일별 원본 행 누락/);
});

test('wrong dates, exercise rules, invalid sets and stale calculated results fail before any database work', () => {
  for (const value of [-1, 1.5, '2', true, Number.MAX_SAFE_INTEGER + 1]) {
    const source = fixture(); source.sheets.운동별기록[5][3] = value;
    assert.throws(() => buildDumbbellData(source), /세트 수 오류/);
  }
  const date = fixture(); date.sheets.운동별기록[5][1] = '2026-09-05';
  assert.throws(() => buildDumbbellData(date), /학번·날짜·종목/);
  const rule = fixture(); rule.sheets.운동기준[5][4] = 1;
  assert.throws(() => buildDumbbellData(rule), /운동기준.*불일치/);
  const daily = fixture(); daily.sheets.일별집계[5][4] = 1;
  assert.throws(() => buildDumbbellData(daily), /일별집계.*계산 캐시/);
  const weekly = fixture(); weekly.sheets.주간요약[12][9]--;
  assert.throws(() => buildDumbbellData(weekly), /주간요약.*계산 캐시/);
  const group = fixture(); group.sheets.주간요약[6][3]++;
  assert.throws(() => buildDumbbellData(group), /등급별 집계/);
});

test('formula text is retained without execution and cached values must agree with extracted cells', () => {
  const source = fixture();
  source.formulaCells.운동별기록.push({ cell: 'M6', formula: '=IF(ISBLANK(D6),"",D6*K6)', cached: null });
  assert.equal(buildDumbbellData(source).summary.formulaCells, 1);
  source.formulaCells.운동별기록[0].cached = 0;
  assert.throws(() => buildDumbbellData(source), /수식 캐시와 셀 값 불일치/);
});

test('import refuses an incomplete 194-student source before opening a transaction', async () => {
  await assert.rejects(importDumbbellData({ $transaction() { throw new Error('must not open'); } }, fixture()), /194/);
});

test('isolated PostgreSQL import is atomic, exact, conflict-safe and idempotent', { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async () => {
  const baseUrl = new URL(process.env.TEST_DATABASE_URL);
  assert.match(baseUrl.pathname, /_test$/, 'A dedicated database ending in _test is required');
  const schema = `dumbbell_${randomUUID().replaceAll('-', '')}`;
  const admin = new PrismaClient({ datasourceUrl: baseUrl.toString() });
  let db, created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
    baseUrl.searchParams.set('schema', schema);
    await promisify(execFile)(process.execPath, [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, DATABASE_URL: baseUrl.toString() }, timeout: 60000,
    });
    db = new PrismaClient({ datasourceUrl: baseUrl.toString() });
    const source = fixture(undefined, 194), prepared = buildDumbbellData(source);
    await db.user.createMany({ data: prepared.students.map(student => ({ role: 'student', studentNumber: student.studentNumber, name: student.name, grade: student.grade, classNumber: student.classNumber, targetType: 'required', passwordHash: 'TEST-ONLY-NOT-A-LOGIN-HASH' })) });
    const user = await db.user.findUnique({ where: { studentNumber: '10101' } });
    const original = await db.dailyRecord.create({ data: { challengeId: LEGACY_CHALLENGE_ID, userId: user.id, date: '2026-05-25', value: 321 } });
    const prior = await db.sourceDataset.create({ data: { hash: 'b'.repeat(64), filename: 'TEST-PRIOR', metadataJson: { retained: true } } });
    await db.studentSource.create({ data: { datasetId: prior.id, userId: user.id, rosterJson: ['TEST PRIOR'], fitnessJson: { semester1: { score: 30, grade: 3 } } } });
    const snapshot = async () => createHash('sha256').update(JSON.stringify(await db.user.findMany({ orderBy: { studentNumber: 'asc' } }))).digest('hex');
    const before = await snapshot();
    const dryRun = await importDumbbellData(db, source);
    assert.equal(dryRun.changed, false); assert.equal(dryRun.readyToApply, true);
    assert.equal(await db.sourceDataset.count(), 1); assert.equal(await db.dailyRecord.count(), 1);
    assert.equal(await db.challengeMembership.count(), 0, 'Read-only preview cannot enroll students');
    const conflict = await db.dailyRecord.create({ data: { challengeId: LEGACY_CHALLENGE_ID, userId: user.id, date: dates[0], value: { D12_CURL: 0, D12_SQUAT: null, D12_ROW: null } } });
    await assert.rejects(importDumbbellData(db, source, { apply: true }), /already contains records/);
    assert.equal(await db.sourceDataset.count(), 1);
    await db.dailyRecord.delete({ where: { id: conflict.id } });
    let writes = 0;
    const failing = { $transaction: (callback, options) => db.$transaction(tx => callback(new Proxy(tx, { get(target, key) {
      if (key === 'dailyRecord') return new Proxy(target.dailyRecord, { get(delegate, method) {
        if (method === 'createMany') return args => { if (++writes === 2) throw new Error('injected late batch failure'); return delegate.createMany(args); };
        const value = delegate[method]; return typeof value === 'function' ? value.bind(delegate) : value;
      } });
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } })), options) };
    await assert.rejects(importDumbbellData(failing, source, { apply: true }), /injected late batch failure/);
    assert.equal(await db.sourceDataset.count(), 1); assert.equal(await db.studentSource.count(), 1); assert.equal(await db.dailyRecord.count(), 1);
    const applied = await importDumbbellData(db, source, { apply: true });
    assert.equal(applied.changed, true); assert.equal(applied.sourceArchiveExact, true);
    assert.equal(await db.challengeMembership.count({ where: { challengeId: LEGACY_CHALLENGE_ID, status: 'active', mode: 'forced' } }), 194);
    assert.equal(await db.dailyRecord.count({ where: { sourceDatasetId: applied.datasetId, challengeId: LEGACY_CHALLENGE_ID } }), prepared.records.length);
    assert.equal(await db.dailyRecord.count(), 1 + prepared.records.length);
    const again = await importDumbbellData(db, source, { apply: true });
    assert.equal(again.alreadyImported, true); assert.equal(again.changed, false);
    assert.equal(await snapshot(), before, 'account data and password hashes must be untouched');
    assert.equal((await db.dailyRecord.findUnique({ where: { id: original.id } })).value, 321);
    assert.deepEqual((await db.studentSource.findFirst({ where: { datasetId: prior.id } })).fitnessJson, { semester1: { score: 30, grade: 3 } });
    const imported = await db.dailyRecord.findFirst({ where: { sourceDatasetId: applied.datasetId } });
    const changed = { D12_CURL: 0, D12_SQUAT: 0, D12_ROW: 0 };
    await db.dailyRecord.update({ where: { id: imported.id }, data: { value: changed } });
    await assert.rejects(importDumbbellData(db, source, { apply: true }), /records differ/);
    assert.deepEqual((await db.dailyRecord.findUnique({ where: { id: imported.id } })).value, changed);
  } finally {
    if (db) await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
});
