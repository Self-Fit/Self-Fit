import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { activityDates, LEGACY_WEEKS, summarizeProgram } from '../src/domain/index.js';

const legacyId = 'challenge-2026-self-fit';
const keys = object => Object.keys(object).sort();
const asInput = challenge => challenge.weeks.map(({ id, week, ...row }) => row);
const makeInput = () => ({
  title: 'API 검증용 챌린지', description: '격리 테스트에서만 사용해요.',
  startDate: '2026-06-08',
  weeks: [
    { title: '횟수 운동', startDate: '2026-06-08', endDate: '2026-06-14', inputType: 'count', weeklyTarget: 500, dailyTarget: null, dailyUnit: '회', unit: '회', color: '#123456', description: '합계 500회예요.' },
    { title: '걷기 운동', startDate: '2026-06-22', endDate: '2026-06-28', inputType: 'walking', weeklyTarget: 5, dailyTarget: 10000, dailyUnit: '보', unit: '일', color: '#654321', description: '일주일에 5일 걸어요.' },
  ],
});

export async function runChallengeApiCases(t, { db, request, teacherCookie, a, b, aCookie, bCookie, origin, temp }) {
  const detailFixture = JSON.parse(await readFile(new URL('../../docs/challenges/fixtures/challenge-detail.json', import.meta.url), 'utf8')).challenge;
  const summaryFixture = JSON.parse(await readFile(new URL('../../docs/challenges/fixtures/challenges.json', import.meta.url), 'utf8')).challenges[0];
  const created = new Set();
  const teacher = (route, options = {}) => request(route, { cookie: teacherCookie, ...options });
  const create = async input => {
    const response = await teacher('/teacher/challenges', { method: 'POST', body: input });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    created.add(response.data.challenge.id);
    return response.data.challenge;
  };
  const duplicate = async (id, body) => {
    const response = await teacher(`/teacher/challenges/${id}/duplicate`, { method: 'POST', body });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    created.add(response.data.challenge.id);
    return response.data.challenge;
  };
  try {
    await t.test('challenge migration preserves legacy 12 weeks, 82 dates, student totals, participation and XLSX semantics', async () => {
      const legacy = await db.challenge.findUnique({ where: { id: legacyId }, include: { weeks: { orderBy: { week: 'asc' } } } });
      assert.ok(legacy);
      assert.equal(legacy.lifecycle, 'published');
      assert.equal(legacy.weeks.length, 12);
      assert.equal(activityDates(legacy.weeks).length, 82);
      assert.deepEqual(activityDates(legacy.weeks), activityDates(LEGACY_WEEKS));
      for (const user of [a, b]) {
        const records = await db.dailyRecord.findMany({ where: { userId: user.id, challengeId: legacyId } });
        assert.deepEqual(summarizeProgram(legacy.weeks, records), summarizeProgram(LEGACY_WEEKS, records));
        const response = await teacher(`/teacher/students/${user.id}?challengeId=${legacyId}`);
        assert.equal(response.status, 200);
        assert.equal(response.data.challenge.id, legacyId);
        assert.deepEqual(response.data.summary, summarizeProgram(LEGACY_WEEKS, records));
      }
      const program = await request('/program', { cookie: aCookie });
      assert.equal(program.status, 200);
      assert.equal(program.data.challengeId, legacyId);
      assert.equal(program.data.activityDates.length, 82);
      const dashboard = await request('/student/dashboard', { cookie: aCookie });
      assert.equal(dashboard.status, 200);
      assert.equal(dashboard.data.program.challengeId, legacyId);
      const analytics = await teacher(`/teacher/participation?challengeId=${legacyId}`);
      assert.equal(analytics.status, 200);
      assert.equal(analytics.data.challenge.id, legacyId);
      assert.deepEqual(analytics.data.summary, {
        participants: 1, completedWeeks: 0, possibleWeeks: 12,
        completionRate: 0, totalWeeks: 12, pendingWeeks: [],
      });
      const exported = await teacher(`/teacher/export?challengeId=${legacyId}&studentIds=${a.id}`, { raw: true });
      assert.equal(exported.status, 200);
      assert.match(exported.headers.get('content-type'), /spreadsheetml/);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(exported.data);
      assert.equal(workbook.worksheets.length, 5);
      const summary = workbook.getWorksheet('참여자 요약').getRow(2);
      assert.equal(summary.getCell(1).value, a.studentNumber);
      assert.equal(summary.getCell(7).value, 0);
      assert.equal(summary.getCell(8).value, 12);
      assert.equal(summary.getCell(10).value, 0);
      assert.equal(workbook.getWorksheet('주차별 현황').rowCount, 13);
      assert.equal(workbook.getWorksheet('날짜별 기록').rowCount, 83);
      const daily = [];
      workbook.getWorksheet('날짜별 기록').eachRow(row => daily.push(row.values.slice(1)));
      assert.equal(daily.find(row => row[2] === '2026-06-08')[6], 275);
    });

    await t.test('challenge endpoints enforce teacher access and report structured validation errors', async () => {
      assert.equal((await request('/teacher/challenges')).status, 401);
      assert.equal((await request('/teacher/challenges', { cookie: aCookie })).status, 403);
      assert.equal((await request('/teacher/challenges', { cookie: bCookie, method: 'POST', body: makeInput() })).status, 403);
      assert.equal((await teacher('/teacher/challenges/not-a-challenge')).data.error.code, 'CHALLENGE_NOT_FOUND');
      const invalid = makeInput();
      invalid.weeks[1].startDate = invalid.weeks[0].endDate;
      const response = await teacher('/teacher/challenges', { method: 'POST', body: invalid });
      assert.equal(response.status, 400);
      assert.equal(response.data.error.code, 'INVALID_CHALLENGE');
      assert.ok(response.data.error.details.some(detail => detail.path.includes('weeks')));
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.equal((await teacher('/teacher/challenges?lifecycle=unknown')).status, 400);
    });

    await t.test('draft CRUD matches fixtures, has no participation, preserves gaps on reuse and permits draft-source deletion', async () => {
      t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-07T01:00:00Z') });
      try {
        let challenge = await create(makeInput());
        assert.deepEqual(keys(challenge), keys(detailFixture));
        assert.deepEqual(keys(challenge.weeks[0]), keys(detailFixture.weeks[1]));
        assert.equal(challenge.lifecycle, 'draft');
        assert.equal(challenge.phase, 'draft');
        assert.equal(challenge.endDate, '2026-06-28');
        assert.equal(challenge.enrollmentDeadline, '2026-06-07');
        assert.equal(challenge.weeks[1].dailyTarget, null);
        assert.deepEqual(challenge.counts, { active: 0, pending: 0, declined: 0, forced: 0, invited: 0 });
        const list = await teacher('/teacher/challenges?lifecycle=draft');
        assert.equal(list.status, 200);
        assert.ok(list.data.challenges.every(row => row.lifecycle === 'draft'));
        assert.deepEqual(keys(list.data.challenges.find(row => row.id === challenge.id)), keys(summaryFixture));
        const empty = await teacher(`/teacher/overview?challengeId=${challenge.id}`);
        assert.equal(empty.status, 200);
        assert.equal(empty.data.challenge.id, challenge.id);
        assert.equal(empty.data.stats.participants, 0);
        assert.equal(empty.data.stats.denominator, 0);
        assert.ok(empty.data.students.every(user => !user.participating && user.records.length === 0 && user.summary.completedWeeks === 0));
        const analytics = await teacher(`/teacher/participation?challengeId=${challenge.id}`);
        assert.equal(analytics.data.summary.participants, 0);
        assert.equal(analytics.data.summary.totalWeeks, 2);
        assert.equal(analytics.data.summary.completionRate, null);
        const changed = await teacher(`/teacher/challenges/${challenge.id}`, { method: 'PATCH', body: { title: '수정한 검증용 챌린지', description: '설명을 수정해요.' } });
        assert.equal(changed.status, 200);
        challenge = changed.data.challenge;
        const copy = await duplicate(challenge.id, { startDate: '2026-07-06' });
        assert.equal(copy.sourceChallengeId, challenge.id);
        assert.equal(copy.lifecycle, 'draft');
        assert.equal(copy.title, `${challenge.title} (복사)`);
        assert.equal(copy.enrollmentDeadline, '2026-07-05');
        assert.equal(copy.endDate, '2026-07-26');
        assert.deepEqual(copy.weeks.map(week => [week.startDate, week.endDate]), [['2026-07-06', '2026-07-12'], ['2026-07-20', '2026-07-26']]);
        assert.equal(copy.activityDates.length, challenge.activityDates.length);
        assert.equal(await db.challengeMembership.count({ where: { challengeId: copy.id } }), 0);
        assert.equal(await db.dailyRecord.count({ where: { challengeId: copy.id } }), 0);
        assert.equal((await teacher(`/teacher/challenges/${challenge.id}`, { method: 'DELETE' })).status, 200);
        assert.equal((await teacher(`/teacher/challenges/${challenge.id}`)).status, 404);
        assert.equal((await teacher(`/teacher/challenges/${copy.id}`)).data.challenge.sourceChallengeId, null);
      } finally { t.mock.timers.reset(); }
    });

    await t.test('publishing is atomic, scoped records never leak, started cosmetic edits work and archive is irreversible', async () => {
      t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-07T01:00:00Z') });
      try {
        const challenge = await create(makeInput());
        assert.equal((await teacher(`/teacher/challenges/${challenge.id}/archive`, { method: 'POST', body: {} })).data.error.code, 'CHALLENGE_NOT_PUBLISHED');
        const published = await Promise.all([1, 2].map(() => teacher(`/teacher/challenges/${challenge.id}/publish`, { method: 'POST', body: {} })));
        assert.deepEqual(published.map(response => response.status).sort(), [200, 409]);
        assert.ok(['ALREADY_PUBLISHED', 'CONFLICT'].includes(published.find(response => response.status === 409).data.error.code));
        assert.equal(published.find(response => response.status === 200).data.challenge.phase, 'upcoming');
        await db.challengeMembership.createMany({ data: [
          { challengeId: challenge.id, userId: a.id, mode: 'forced', status: 'active' },
          { challengeId: challenge.id, userId: b.id, mode: 'invited', status: 'declined' },
        ] });
        assert.deepEqual((await teacher(`/teacher/challenges/${challenge.id}`)).data.challenge.counts, { active: 1, pending: 0, declined: 1, forced: 1, invited: 1 });
        assert.equal((await request('/program', { cookie: teacherCookie })).data.challengeId, legacyId, 'the teacher\'s current challenge is the one in progress, not the latest to start');
        assert.equal((await teacher('/teacher/challenges')).data.currentId, legacyId);
        assert.equal((await request('/program', { cookie: aCookie })).data.challengeId, legacyId, 'an active legacy challenge outranks an upcoming challenge');

        t.mock.timers.setTime(new Date('2026-06-08T01:00:00Z').getTime());
        const student = await request('/student/dashboard', { cookie: aCookie });
        assert.equal(student.status, 200);
        assert.equal(student.data.program.challengeId, challenge.id);
        assert.equal(student.data.records.length, 0);
        const saved = await request('/student/records/2026-06-08', { cookie: aCookie, method: 'PUT', body: { value: 10 } });
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        const records = await db.dailyRecord.findMany({ where: { userId: a.id, date: '2026-06-08' } });
        assert.equal(records.find(row => row.challengeId === legacyId).value, 275);
        assert.equal(records.find(row => row.challengeId === challenge.id).value, 10);
        const scoped = await teacher(`/teacher/students/${a.id}?challengeId=${challenge.id}`);
        assert.equal(scoped.data.records.length, 1);
        assert.equal(scoped.data.records[0].value, 10);
        assert.equal(scoped.data.summary.weeks[0].total, 10);

        const current = (await teacher(`/teacher/challenges/${challenge.id}`)).data.challenge;
        const weeks = asInput(current);
        weeks[0].title = '바꾼 운동 제목';
        weeks[0].description = '바꾼 설명이에요.';
        weeks[0].color = '#ABCDEF';
        const cosmetic = await teacher(`/teacher/challenges/${challenge.id}`, { method: 'PATCH', body: { title: '시작 후 제목 수정', description: '설명 수정', weeks } });
        assert.equal(cosmetic.status, 200, JSON.stringify(cosmetic.data));
        assert.equal(cosmetic.data.challenge.weeks[0].id, current.weeks[0].id);
        assert.equal(cosmetic.data.challenge.weeks[0].color, '#ABCDEF');
        const structuralWeeks = asInput(cosmetic.data.challenge);
        structuralWeeks[0].weeklyTarget = 501;
        for (const body of [{ weeks: structuralWeeks }, { endDate: '2026-06-29' }, { enrollmentDeadline: '2026-06-09' }]) {
          const locked = await teacher(`/teacher/challenges/${challenge.id}`, { method: 'PATCH', body });
          assert.equal(locked.status, 409);
          assert.equal(locked.data.error.code, 'CHALLENGE_LOCKED');
        }
        assert.equal((await teacher(`/teacher/challenges/${challenge.id}`, { method: 'DELETE' })).data.error.code, 'CHALLENGE_NOT_DRAFT');
        const archived = await teacher(`/teacher/challenges/${challenge.id}/archive`, { method: 'POST', body: {} });
        assert.equal(archived.status, 200);
        assert.equal(archived.data.challenge.lifecycle, 'archived');
        assert.equal(archived.data.challenge.phase, 'archived');
        assert.equal((await teacher(`/teacher/challenges/${challenge.id}`, { method: 'PATCH', body: { title: '보관 후 수정 시도' } })).data.error.code, 'CHALLENGE_ARCHIVED');
        assert.equal((await teacher(`/teacher/challenges/${challenge.id}/publish`, { method: 'POST', body: {} })).status, 409);
        assert.equal((await teacher(`/teacher/challenges/${challenge.id}`, { method: 'DELETE' })).data.error.code, 'CHALLENGE_NOT_DRAFT');
        assert.equal((await request('/student/dashboard', { cookie: aCookie })).data.program.challengeId, legacyId);
        const copy = await duplicate(challenge.id, { startDate: '2026-07-06', title: '보관한 양식을 재사용해요' });
        assert.deepEqual(copy.counts, { active: 0, pending: 0, declined: 0, forced: 0, invited: 0 });
        assert.equal(await db.dailyRecord.count({ where: { challengeId: copy.id } }), 0);
      } finally { t.mock.timers.reset(); }
    });

    await t.test('archiving during an accepted multipart upload rejects commit and removes staged and stored files', async () => {
      const sessionIds = [];
      let student, upload, responsePromise;
      const staging = path.join(temp, '.staging');
      const beforeFiles = (await readdir(temp)).sort();
      const beforeStaging = (await readdir(staging)).sort();
      const mintTestSession = async userId => {
        const token = randomBytes(32).toString('base64url');
        const id = createHash('sha256').update(token).digest('hex');
        await db.session.create({ data: { id, userId, expiresAt: new Date('2027-03-03T15:00:00Z') } });
        sessionIds.push(id);
        return `self_fit_session=${token}`;
      };
      t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-03-02T01:00:00Z') });
      try {
        const staff = await db.user.findFirst({ where: { role: 'teacher' } });
        const staffCookie = await mintTestSession(staff.id);
        student = await db.user.create({ data: {
          role: 'student', studentNumber: `test-upload-${randomUUID()}`, name: 'TEST UPLOAD ARCHIVE RACE',
          grade: 1, classNumber: 1, targetType: 'required',
          passwordHash: a.passwordHash, mustChangePassword: false,
        } });
        const studentCookie = await mintTestSession(student.id);
        const input = {
          title: '2027 첨부 보관 경합 검증', startDate: '2027-03-02',
          weeks: [{ title: '횟수 운동', startDate: '2027-03-02', endDate: '2027-03-08', inputType: 'count', weeklyTarget: 500, dailyTarget: null, unit: '회', dailyUnit: '회', color: '#123456', description: '격리 검증이에요.' }],
        };
        const result = await request('/teacher/challenges', { cookie: staffCookie, method: 'POST', body: input });
        assert.equal(result.status, 201, JSON.stringify(result.data));
        const challenge = result.data.challenge;
        created.add(challenge.id);
        const published = await request(`/teacher/challenges/${challenge.id}/publish`, { cookie: staffCookie, method: 'POST', body: {} });
        assert.equal(published.status, 200);
        await db.challengeMembership.create({ data: { challengeId: challenge.id, userId: student.id, mode: 'forced', status: 'active', invitedById: staff.id } });
        const saved = await request('/student/records/2027-03-02', { cookie: studentCookie, method: 'PUT', body: { value: 10 } });
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        const recordId = saved.data.record.id;
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=', 'base64');
        upload = httpRequest(`${origin}/student/challenges/${challenge.id}/records/2027-03-02/attachments`, {
          method: 'POST', headers: { Cookie: studentCookie, 'Content-Type': 'multipart/form-data; boundary=archive-race' },
        });
        responsePromise = new Promise((resolve, reject) => {
          upload.on('response', response => {
            let data = '';
            response.on('data', chunk => { data += chunk; });
            response.on('end', () => {
              try { resolve({ status: response.statusCode, data: JSON.parse(data) }); }
              catch (error) { reject(error); }
            });
            response.on('error', reject);
          });
          upload.on('error', reject);
        });
        responsePromise.catch(() => {});
        upload.write('--archive-race\r\nContent-Disposition: form-data; name="file"; filename="archive-race.png"\r\nContent-Type: image/png\r\n\r\n');
        upload.write(png);
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if ((await readdir(staging)).some(name => !beforeStaging.includes(name))) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal((await readdir(staging)).filter(name => !beforeStaging.includes(name)).length, 1);
        const archived = await request(`/teacher/challenges/${challenge.id}/archive`, { cookie: staffCookie, method: 'POST', body: {} });
        assert.equal(archived.status, 200);
        upload.end('\r\n--archive-race--\r\n');
        const response = await responsePromise;
        assert.equal(response.status, 409, JSON.stringify(response));
        assert.equal(response.data.error.code, 'CHALLENGE_ARCHIVED');
        assert.equal(await db.attachment.count({ where: { recordId } }), 0);
        assert.equal((await db.dailyRecord.findUnique({ where: { id: recordId } })).value, 10);
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const files = (await readdir(temp)).sort(), staged = (await readdir(staging)).sort();
          if (JSON.stringify(files) === JSON.stringify(beforeFiles) && JSON.stringify(staged) === JSON.stringify(beforeStaging)) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.deepEqual((await readdir(temp)).sort(), beforeFiles);
        assert.deepEqual((await readdir(staging)).sort(), beforeStaging);
      } finally {
        if (upload && !upload.destroyed) upload.destroy(new Error('test cleanup'));
        if (responsePromise) await responsePromise.catch(() => {});
        t.mock.timers.reset();
        await db.session.deleteMany({ where: { id: { in: sessionIds } } });
        if (student) {
          const files = await db.attachment.findMany({ where: { record: { userId: student.id } } });
          await db.attachment.deleteMany({ where: { record: { userId: student.id } } });
          await Promise.all(files.map(file => unlink(path.join(temp, file.storageKey)).catch(() => {})));
          await db.dailyRecord.deleteMany({ where: { userId: student.id } });
          await db.user.delete({ where: { id: student.id } });
        }
      }
    });
  } finally {
    const challengeId = { in: [...created] };
    await db.dailyRecord.deleteMany({ where: { challengeId } });
    await db.challengeMembership.deleteMany({ where: { challengeId } });
    await db.challenge.deleteMany({ where: { id: { in: [...created] } } });
  }
}
