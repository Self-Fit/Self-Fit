import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { koreanDate } from '../src/domain/index.js';

const legacyId = 'challenge-2026-self-fit';
const ids = rows => rows.map(row => row.id).sort();
const fields = value => Object.keys(value).sort();

export async function runFitnessApiCases(t, { db, request, teacherCookie, aCookie }) {
  const fixture = JSON.parse(await readFile(new URL('../../docs/challenges/fixtures/fitness-history.json', import.meta.url), 'utf8'));
  const prefix = `fitness-${randomUUID().slice(0, 8)}`;
  const users = [], challengeIds = [];
  let source;
  const teacher = (route, options = {}) => request(route, { cookie: teacherCookie, ...options });
  const roster = suffix => teacher(`/teacher/students?search=${prefix}${suffix || ''}`);
  try {
    source = await db.sourceDataset.create({ data: {
      hash: createHash('sha256').update(prefix).digest('hex'), filename: 'TEST-FITNESS-SOURCE.xlsx', metadataJson: { testOnly: true },
    } });
    const definitions = [
      [1, 1, 'required', 1], [1, 1, 'optional', 2], [1, 2, 'optional', 3],
      [2, 1, 'required', 4], [2, 1, 'optional', 5], [3, 2, 'required', null], [3, 2, 'optional', 4],
    ];
    for (const [index, [grade, classNumber, targetType, fitnessGrade]] of definitions.entries()) {
      users.push(await db.user.create({ data: {
        role: 'student', studentNumber: `${prefix}-${index}`, name: `${prefix} 테스트 ${index}`,
        grade, classNumber, targetType, passwordHash: 'TEST-ONLY-UNUSABLE-HASH', mustChangePassword: false,
        fitnessGrade, fitnessGradeYear: fitnessGrade === null ? null : 2026,
        fitnessGradeSemester: fitnessGrade === null ? null : 2,
      } }));
    }
    const assessments = [
      { year: 2025, semester: 2, grade: 5, score: null },
      ...[...fixture.fitnessHistory].reverse(),
    ];
    for (const [index, assessment] of assessments.entries()) await db.studentFitnessAssessment.create({ data: {
      ...assessment, userId: users[2].id, sourceDatasetId: source.id, sourceSheet: 'TEST SOURCE SHEET', sourceRow: index + 2,
    } });
    const accountSnapshot = await db.user.findMany({ where: { id: { in: ids(users) } }, orderBy: { id: 'asc' } });

    await t.test('fitness roster filters stay separate from school grades and preserve unmeasured students', async () => {
      const all = await roster();
      assert.equal(all.status, 200);
      assert.equal(all.data.students.length, 7);
      const gradeFour = await roster('&fitnessGrade=4');
      assert.equal(gradeFour.status, 200);
      assert.deepEqual(ids(gradeFour.data.students), ids([users[3], users[6]]));
      assert.deepEqual(gradeFour.data.students.map(user => user.grade).sort(), [2, 3]);
      assert.deepEqual(ids((await roster('&grade=2&classNumber=1&fitnessGrade=5')).data.students), [users[4].id]);
      const unmeasured = await roster('&fitnessGrade=unmeasured');
      assert.deepEqual(ids(unmeasured.data.students), [users[5].id]);
      for (const key of ['fitnessGrade', 'fitnessGradeYear', 'fitnessGradeSemester']) assert.equal(unmeasured.data.students[0][key], null);
      for (const user of gradeFour.data.students) {
        assert.equal(user.fitnessGrade, 4);
        assert.equal(user.fitnessGradeYear, 2026);
        assert.equal(user.fitnessGradeSemester, 2);
      }
      for (const value of ['0', '6', '1.5', 'true', '4,5', 'null', '%20', '4&fitnessGrade=5']) {
        const invalid = await roster(`&fitnessGrade=${value}`);
        assert.equal(invalid.status, 400, value);
        assert.equal(invalid.data.error.code, 'INVALID_FILTER');
      }
      assert.equal((await request('/teacher/students?fitnessGrade=4', { cookie: aCookie })).status, 403);
    });

    await t.test('fitness detail exposes ordered semester assessments and keeps source provenance private', async () => {
      const result = await teacher(`/teacher/students/${users[2].id}?challengeId=${legacyId}`);
      assert.equal(result.status, 200);
      assert.equal(result.data.user.grade, 1);
      for (const key of ['fitnessGrade', 'fitnessGradeYear', 'fitnessGradeSemester']) assert.equal(result.data.user[key], fixture[key]);
      assert.deepEqual(result.data.fitnessHistory, [...fixture.fitnessHistory, { year: 2025, semester: 2, grade: 5, score: null }]);
      for (const row of result.data.fitnessHistory) assert.deepEqual(fields(row), fields(fixture.fitnessHistory[0]));
      for (const privateField of ['sourceDatasetId', 'sourceSheet', 'sourceRow', 'TEST-FITNESS-SOURCE.xlsx', 'TEST SOURCE SHEET']) {
        assert.ok(!JSON.stringify(result.data).includes(privateField));
      }
      const unknown = await teacher(`/teacher/students/${users[5].id}?challengeId=${legacyId}`);
      assert.deepEqual(unknown.data.fitnessHistory, []);
      const exported = await teacher(`/teacher/export?challengeId=${legacyId}&search=${prefix}&fitnessGrade=4`, { raw: true });
      assert.equal(exported.status, 200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(exported.data);
      const numbers = [];
      workbook.getWorksheet('참여자 요약').eachRow((row, index) => { if (index > 1) numbers.push(row.getCell(1).value); });
      assert.deepEqual(numbers.sort(), [users[3].studentNumber, users[6].studentNumber].sort());
    });

    await t.test('fitness grade selection covers the whole roster, intersects class filters and changes only confirmed memberships', async () => {
      const today = koreanDate(), endDate = new Date(Date.parse(`${today}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
      const created = await teacher('/teacher/challenges', { method: 'POST', body: {
        title: prefix, startDate: today, endDate, enrollmentDeadline: endDate,
        weeks: [{ title: '테스트 횟수', startDate: today, endDate, inputType: 'count', weeklyTarget: 10, dailyTarget: null, unit: '회', dailyUnit: '회', color: '#123456', description: '격리된 테스트예요.' }],
      } });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const challengeId = created.data.challenge.id;
      challengeIds.push(challengeId);
      assert.equal((await teacher(`/teacher/challenges/${challengeId}/publish`, { method: 'POST', body: {} })).status, 200);
      const url = `/teacher/challenges/${challengeId}/members`;
      const expected = [users[3], users[4], users[6]];
      const notificationCount = await db.notification.count();
      const preview = await teacher(`${url}/preview`, { method: 'POST', body: { filters: { fitnessGrades: [5, 4, 4] } } });
      assert.equal(preview.status, 200);
      assert.deepEqual(ids(preview.data.students), ids(expected));
      assert.ok(preview.data.students.every(user => user.membership === null && user.participating === false));
      assert.equal(await db.challengeMembership.count({ where: { challengeId } }), 0);
      assert.equal(await db.notification.count(), notificationCount);
      const restricted = await teacher(`${url}/preview`, { method: 'POST', body: { filters: { grade: 2, classNumber: 1, fitnessGrades: [4, 5] } } });
      assert.deepEqual(ids(restricted.data.students), ids([users[3], users[4]]));
      for (const filters of [{ fitnessGrades: [] }, { fitnessGrades: ['4'] }, { fitnessGrades: [null] }, { fitnessGrades: [0] }, { fitnessGrades: [6] }, { fitnessGrades: [4.5] }, { fitnessGrades: null }, { fitnessGrade: 4 }]) {
        const invalid = await teacher(`${url}/preview`, { method: 'POST', body: { filters } });
        assert.equal(invalid.status, 400);
        assert.equal(invalid.data.error.code, 'INVALID_SELECTION');
      }
      const enrolled = await teacher(url, { method: 'POST', body: { mode: 'forced', filters: { fitnessGrades: [4, 5] } } });
      assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data));
      assert.deepEqual(ids(enrolled.data.added.map(member => member.user)), ids(expected));
      assert.ok(enrolled.data.added.every(member => member.status === 'active' && member.mode === 'forced'));
      const repeated = await teacher(url, { method: 'POST', body: { mode: 'forced', filters: { grade: 2, classNumber: 1, fitnessGrades: [4, 5] } } });
      assert.equal(repeated.data.added.length, 0);
      assert.deepEqual(repeated.data.skipped.map(item => item.userId).sort(), ids([users[3], users[4]]));
      assert.ok(repeated.data.skipped.every(item => item.reason === 'already_active'));
      const gradeFour = await teacher(`${url}?fitnessGrade=4`);
      assert.deepEqual(ids(gradeFour.data.members.map(member => member.user)), ids([users[3], users[6]]));
      assert.deepEqual(gradeFour.data.stats, { active: 2, pending: 0, declined: 0, removed: 0, forced: 2, invited: 0 });
      const statusFiltered = await teacher(`${url}?fitnessGrade=4&status=pending`);
      assert.equal(statusFiltered.data.members.length, 0);
      assert.deepEqual(statusFiltered.data.stats, gradeFour.data.stats);
      assert.equal((await teacher(`${url}?grade=2&fitnessGrade=4`)).data.members.length, 1);
      await teacher(url, { method: 'POST', body: { mode: 'forced', studentIds: [users[5].id] } });
      const missing = await teacher(`${url}?fitnessGrade=unmeasured`);
      assert.deepEqual(ids(missing.data.members.map(member => member.user)), [users[5].id]);
      assert.equal(missing.data.stats.active, 1);
      assert.deepEqual(await db.user.findMany({ where: { id: { in: ids(users) } }, orderBy: { id: 'asc' } }), accountSnapshot);
    });

    await t.test('fitness database constraints retain history and reject invalid projections, periods, grades and provenance', async () => {
      const assessment = { userId: users[0].id, year: 2026, semester: 1, grade: 4, score: null, sourceDatasetId: source.id, sourceSheet: 'TEST SOURCE SHEET', sourceRow: 2 };
      for (const invalid of [{ year: 0 }, { semester: 3 }, { grade: 0 }, { grade: 6 }, { score: -1 }, { sourceRow: 0 }, { sourceSheet: '' }]) {
        await assert.rejects(db.studentFitnessAssessment.create({ data: { ...assessment, ...invalid } }));
      }
      for (const invalid of [{ fitnessGrade: 6 }, { fitnessGradeYear: null }, { fitnessGradeSemester: 1 }]) {
        await assert.rejects(db.user.update({ where: { id: users[0].id }, data: invalid }));
      }
      await assert.rejects(db.studentFitnessAssessment.create({ data: { ...assessment, userId: users[2].id, semester: 2 } }), { code: 'P2002' });
      assert.equal(await db.studentFitnessAssessment.count(), assessments.length);
      const denied = await teacher(`/teacher/students/${users[2].id}`, { method: 'DELETE' });
      assert.equal(denied.status, 409);
      assert.equal(denied.data.error.code, 'HAS_SOURCE_DATA');
      await assert.rejects(db.user.delete({ where: { id: users[2].id } }), { code: 'P2003' });
      await assert.rejects(db.sourceDataset.delete({ where: { id: source.id } }), { code: 'P2003' });
      assert.deepEqual(await db.user.findMany({ where: { id: { in: ids(users) } }, orderBy: { id: 'asc' } }), accountSnapshot);
    });
  } finally {
    const userId = { in: ids(users) };
    await db.notification.deleteMany({ where: { userId } });
    await db.challengeMembership.deleteMany({ where: { challengeId: { in: challengeIds } } });
    await db.challenge.deleteMany({ where: { id: { in: challengeIds } } });
    await db.studentFitnessAssessment.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: { in: ids(users) } } });
    if (source) await db.sourceDataset.delete({ where: { id: source.id } });
  }
}
