import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createReminderEvents, deliverPendingPush } from '../src/notifications.js';

const keys = object => Object.keys(object).sort();
const memberKey = (challengeId, userId) => ({ challengeId_userId: { challengeId, userId } });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=', 'base64');
const fixture = async name => JSON.parse(await readFile(new URL(`../../docs/challenges/fixtures/${name}.json`, import.meta.url), 'utf8'));

/** Only the caller's isolated _test schema and synthetic, explicitly tracked rows are used. */
export async function runMembershipApiCases(t, { db, request, a, temp }) {
  const memberFixture = await fixture('members');
  const addedFixture = await fixture('members-add-response');
  const studentFixture = await fixture('student-challenges');
  const createdChallenges = new Set(), createdUsers = new Set(), sessionIds = [];
  const staff = await db.user.findFirst({ where: { role: 'teacher' } });
  assert.ok(staff);
  const clock = instant => t.mock.timers.setTime(new Date(instant).getTime());
  const beforeStart = () => clock('2027-03-01T01:00:00Z');
  const mintSession = async userId => {
    const token = randomBytes(32).toString('base64url');
    const id = createHash('sha256').update(token).digest('hex');
    await db.session.create({ data: { id, userId, expiresAt: new Date('2028-01-01T00:00:00Z') } });
    sessionIds.push(id);
    return `self_fit_session=${token}`;
  };
  const staffCookie = await mintSession(staff.id);
  const teacher = (route, options = {}) => request(route, { cookie: staffCookie, ...options });
  const error = (response, status, code) => {
    assert.equal(response.status, status, JSON.stringify(response.data));
    assert.equal(response.data.error.code, code);
    assert.equal(typeof response.data.error.message, 'string');
  };
  const makeStudent = async (label, options = {}) => {
    const row = await db.user.create({ data: {
      role: 'student', studentNumber: `member-${randomUUID()}`, name: `MEMBER TEST ${label}`,
      grade: 91, classNumber: 1, targetType: 'optional',
      passwordHash: a.passwordHash, mustChangePassword: false, weekendReminder: true, ...options,
    } });
    createdUsers.add(row.id);
    return { ...row, cookie: await mintSession(row.id) };
  };
  const makeChallenge = async ({ title = '참여 API 검증', startDate = '2027-03-02', endDate = '2027-03-08', enrollmentDeadline = '2027-03-01', publish = true } = {}) => {
    const response = await teacher('/teacher/challenges', { method: 'POST', body: {
      title, startDate, endDate, enrollmentDeadline,
      weeks: [{ title: '횟수 운동', startDate, endDate, inputType: 'count', weeklyTarget: 100, dailyTarget: null, unit: '회', dailyUnit: '회', color: '#123456', description: '격리 API 검증에서만 사용해요.' }],
    } });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    const challenge = response.data.challenge;
    createdChallenges.add(challenge.id);
    if (!publish) return challenge;
    const published = await teacher(`/teacher/challenges/${challenge.id}/publish`, { method: 'POST', body: {} });
    assert.equal(published.status, 200, JSON.stringify(published.data));
    return published.data.challenge;
  };
  const add = (challenge, students, mode = 'invited') => teacher(`/teacher/challenges/${challenge.id}/members`, { method: 'POST', body: { mode, studentIds: students.map(student => typeof student === 'string' ? student : student.id) } });
  const decide = (challenge, student, action) => request(`/student/challenges/${challenge.id}/${action}`, { cookie: student.cookie, method: 'POST', body: {} });
  const member = (challenge, student) => db.challengeMembership.findUnique({ where: memberKey(challenge.id, student.id) });
  const events = (challenge, student, type) => db.notification.findMany({ where: { userId: student.id, type, data: { path: ['challengeId'], equals: challenge.id } }, orderBy: { eventKey: 'asc' } });
  const members = challenge => teacher(`/teacher/challenges/${challenge.id}/members`);
  const stats = challenge => teacher(`/teacher/participation?challengeId=${challenge.id}`);
  const privacy = data => {
    const text = JSON.stringify(data);
    for (const key of ['passwordHash', 'temporaryPassword', 'password', 'session', 'token']) assert.ok(!text.includes(`"${key}":`), `unexpected private key ${key}`);
  };
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-03-01T01:00:00Z') });
  try {
    await t.test('membership preview filters the school roster without writing and rejects invalid selections or roles', async () => {
      beforeStart();
      const challenge = await makeChallenge();
      const required = await makeStudent('PREVIEW REQUIRED', { grade: 91, classNumber: 11, targetType: 'required' });
      const optional = await makeStudent('PREVIEW OPTIONAL', { grade: 91, classNumber: 11 });
      const outside = await makeStudent('PREVIEW OUTSIDE', { grade: 91, classNumber: 12 });
      const snapshot = async () => ({ memberships: await db.challengeMembership.findMany({ orderBy: { id: 'asc' } }), notifications: await db.notification.findMany({ orderBy: { id: 'asc' } }), users: await db.user.findMany({ orderBy: { id: 'asc' } }) });
      const before = await snapshot();
      const preview = await teacher(`/teacher/challenges/${challenge.id}/members/preview`, { method: 'POST', body: { filters: { grade: 91, classNumber: 11, targetType: 'required' } } });
      assert.equal(preview.status, 200, JSON.stringify(preview.data));
      assert.deepEqual(preview.data.students.map(user => user.id), [required.id]);
      assert.equal(preview.data.students[0].membership, null);
      assert.deepEqual(keys(preview.data.students[0]), [...keys(memberFixture.members[0].user), 'membership'].sort());
      const selected = await teacher(`/teacher/challenges/${challenge.id}/members/preview`, { method: 'POST', body: { studentIds: [optional.id, required.id, optional.id, staff.id, randomUUID()] } });
      assert.equal(selected.status, 200);
      assert.deepEqual(new Set(selected.data.students.map(user => user.id)), new Set([required.id, optional.id]));
      assert.equal(selected.data.students.length, 2);
      privacy(selected.data);
      for (const body of [{}, { studentIds: [required.id], filters: {} }, { studentIds: 'wrong' }, { studentIds: [null] }, { filters: { grade: 0 } }, { filters: { classNumber: 'bad' } }, { filters: { targetType: 'other' } }, { studentIds: ['a'.repeat(100001)] }]) {
        error(await teacher(`/teacher/challenges/${challenge.id}/members/preview`, { method: 'POST', body }), 400, 'INVALID_SELECTION');
      }
      assert.equal((await request(`/teacher/challenges/${challenge.id}/members/preview`, { cookie: required.cookie, method: 'POST', body: { studentIds: [outside.id] } })).status, 403);
      assert.equal((await request(`/teacher/challenges/${challenge.id}/members`)).status, 401);
      assert.deepEqual(await snapshot(), before);
      const byFilter = await teacher(`/teacher/challenges/${challenge.id}/members`, { method: 'POST', body: { mode: 'forced', filters: { grade: 91, classNumber: 11, targetType: 'required' } } });
      assert.equal(byFilter.status, 201);
      assert.deepEqual(byFilter.data.added.map(row => row.user.id), [required.id]);
      const repeatedPreview = await teacher(`/teacher/challenges/${challenge.id}/members/preview`, { method: 'POST', body: { studentIds: [required.id] } });
      assert.deepEqual(keys(repeatedPreview.data.students[0].membership), keys(studentFixture.current.membership));
      assert.equal(repeatedPreview.data.students[0].membership.status, 'active');
    });

    await t.test('forced enrollment is immediately active, deduplicates accounts and notifications, and preserves fixture keys', async () => {
      beforeStart();
      const challenge = await makeChallenge();
      const student = await makeStudent('FORCED');
      const missingId = randomUUID();
      const response = await add(challenge, [student, student, staff.id, missingId], 'forced');
      assert.equal(response.status, 201, JSON.stringify(response.data));
      assert.deepEqual(keys(response.data), keys(addedFixture));
      assert.equal(response.data.added.length, 1);
      assert.deepEqual(keys(response.data.added[0]), keys(addedFixture.added[0]));
      assert.deepEqual(keys(response.data.added[0].user), keys(addedFixture.added[0].user));
      assert.deepEqual(keys(response.data.added[0].invitedBy), keys(addedFixture.added[0].invitedBy));
      assert.equal(response.data.added[0].mode, 'forced');
      assert.equal(response.data.added[0].status, 'active');
      assert.equal(response.data.added[0].user.participating, true);
      assert.equal(response.data.added[0].invitedBy.id, staff.id);
      assert.equal(response.data.skipped.find(row => row.userId === staff.id).reason, 'not_student');
      const missing = response.data.skipped.find(row => row.userId === missingId);
      assert.deepEqual(keys(missing), keys(addedFixture.skipped[0]));
      assert.deepEqual(missing, { userId: missingId, studentNumber: null, name: null, reason: 'not_found' });
      const again = await add(challenge, [student], 'invited');
      assert.equal(again.status, 201);
      assert.deepEqual(again.data.added, []);
      assert.equal(again.data.skipped[0].reason, 'already_active');
      const notices = await events(challenge, student, 'enrollment');
      assert.equal(notices.length, 1);
      assert.equal(notices[0].eventKey, `enrollment:${response.data.added[0].id}`);
      assert.deepEqual(notices[0].data, { challengeId: challenge.id, membershipId: response.data.added[0].id });
      const listed = await members(challenge);
      assert.deepEqual(keys(listed.data), keys(memberFixture));
      assert.deepEqual(keys(listed.data.members[0]), keys(memberFixture.members[0]));
      assert.deepEqual(keys(listed.data.stats), keys(memberFixture.stats));
      assert.equal(listed.data.stats.active, 1);
      assert.equal(listed.data.stats.forced, 1);
      error(await decide(challenge, student, 'decline'), 404, 'NO_INVITATION');
      privacy(response.data);
      privacy(listed.data);
    });

    await t.test('invitation, decline, reinvite, forced conversion, removal and reactivation obey the membership state machine', async () => {
      beforeStart();
      const challenge = await makeChallenge({ title: '초대 상태 전환 검증' });
      const student = await makeStudent('STATES');
      const first = await add(challenge, [student]);
      assert.equal(first.status, 201);
      const id = first.data.added[0].id, invitedAt = first.data.added[0].invitedAt;
      assert.equal(first.data.added[0].status, 'pending');
      assert.equal(first.data.added[0].user.participating, false);
      assert.equal((await add(challenge, [student])).data.skipped[0].reason, 'already_pending');
      const invitation = (await events(challenge, student, 'invitation'))[0];
      assert.equal(invitation.eventKey, `invitation:${id}:${invitedAt}`);
      assert.equal(invitation.title, '새 챌린지에 초대됐어요');
      assert.ok(invitation.body.includes(challenge.title));
      assert.ok(invitation.body.includes(challenge.enrollmentDeadline));
      assert.deepEqual(invitation.data, { challengeId: challenge.id, membershipId: id });
      const list = await request('/student/challenges', { cookie: student.cookie });
      assert.equal(list.status, 200);
      assert.deepEqual(keys(list.data), keys(studentFixture));
      assert.equal(list.data.current, null);
      const entry = list.data.invitations.find(item => item.challenge.id === challenge.id);
      assert.ok(entry);
      assert.deepEqual(keys(entry), keys(studentFixture.invitations[0]));
      assert.deepEqual(keys(entry.challenge), keys(studentFixture.invitations[0].challenge));
      assert.deepEqual(keys(entry.membership), keys(studentFixture.invitations[0].membership));
      assert.equal((await decide(challenge, student, 'decline')).data.membership.status, 'declined');
      error(await decide(challenge, student, 'accept'), 404, 'NO_INVITATION');
      assert.equal((await stats(challenge)).data.summary.participants, 0);
      clock('2027-03-01T01:00:01Z');
      const reinvited = await add(challenge, [student]);
      assert.equal(reinvited.data.added[0].id, id);
      assert.equal(reinvited.data.added[0].status, 'pending');
      assert.notEqual(reinvited.data.added[0].invitedAt, invitedAt);
      assert.equal(reinvited.data.added[0].respondedAt, null);
      assert.equal((await events(challenge, student, 'invitation')).length, 2);
      const forced = await add(challenge, [student], 'forced');
      assert.equal(forced.data.added[0].id, id);
      assert.equal(forced.data.added[0].mode, 'forced');
      assert.equal(forced.data.added[0].status, 'active');
      assert.equal((await events(challenge, student, 'enrollment')).length, 1);
      assert.equal((await teacher(`/teacher/challenges/${challenge.id}/members/${student.id}`, { method: 'DELETE' })).status, 200);
      assert.equal((await member(challenge, student)).status, 'removed');
      assert.equal((await members(challenge)).data.members.length, 0);
      assert.equal((await stats(challenge)).data.summary.participants, 0);
      const removed = await teacher(`/teacher/challenges/${challenge.id}/members?status=removed`);
      assert.equal(removed.data.members[0].id, id);
      clock('2027-03-01T01:00:02Z');
      assert.equal((await add(challenge, [student])).data.added[0].status, 'pending');
      assert.equal((await events(challenge, student, 'invitation')).length, 3);
      assert.equal((await decide(challenge, student, 'decline')).status, 200);
      assert.equal((await add(challenge, [student], 'forced')).data.added[0].status, 'active');
      assert.equal((await events(challenge, student, 'enrollment')).length, 1, 'one enrollment event per membership identity');
      const acceptedList = await request('/student/challenges', { cookie: student.cookie });
      assert.equal(acceptedList.data.current.challenge.id, challenge.id);
      assert.deepEqual(keys(acceptedList.data.current), keys(studentFixture.current));
      privacy(acceptedList.data);
    });

    await t.test('membership list filters and denominators exclude pending, declined and removed students', async () => {
      beforeStart();
      const challenge = await makeChallenge();
      const active = await makeStudent('FILTER ACTIVE', { classNumber: 21, targetType: 'required' });
      const pending = await makeStudent('FILTER PENDING', { classNumber: 22 });
      const declined = await makeStudent('FILTER DECLINED', { classNumber: 22 });
      const removed = await makeStudent('FILTER REMOVED', { classNumber: 23 });
      await add(challenge, [active], 'forced');
      await add(challenge, [pending, declined, removed]);
      await decide(challenge, declined, 'decline');
      await teacher(`/teacher/challenges/${challenge.id}/members/${removed.id}`, { method: 'DELETE' });
      const listed = await members(challenge);
      assert.deepEqual(new Set(listed.data.members.map(row => row.user.id)), new Set([active.id, pending.id, declined.id]));
      assert.equal(listed.data.stats.active, 1);
      assert.equal(listed.data.stats.pending, 1);
      assert.equal(listed.data.stats.declined, 1);
      assert.equal(listed.data.stats.removed, 1);
      assert.equal(listed.data.members.find(row => row.user.id === declined.id).user.participating, false);
      for (const [query, expected] of [
        ['status=pending', [pending.id]], ['status=declined', [declined.id]], ['status=removed', [removed.id]],
        ['mode=forced', [active.id]], ['grade=91&classNumber=21&targetType=required', [active.id]],
        [`search=${encodeURIComponent(pending.name)}`, [pending.id]],
      ]) {
        const response = await teacher(`/teacher/challenges/${challenge.id}/members?${query}`);
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.deepEqual(response.data.members.map(row => row.user.id).sort(), expected.sort());
        if (query.startsWith('status=') || query.startsWith('mode=')) assert.deepEqual(response.data.stats, listed.data.stats, 'status/mode only filter rows; cohort statistics retain all states');
      }
      for (const query of ['status=unknown', 'mode=unknown', 'grade=0', 'targetType=unknown']) assert.equal((await teacher(`/teacher/challenges/${challenge.id}/members?${query}`)).status, 400);
      let analytics = await stats(challenge);
      assert.equal(analytics.data.summary.participants, 1);
      assert.equal(analytics.data.summary.possibleWeeks, 1);
      assert.equal(analytics.data.summary.completionRate, 0);
      clock('2027-03-02T01:00:00Z');
      const saved = await request(`/student/challenges/${challenge.id}/records/2027-03-02`, { cookie: active.cookie, method: 'PUT', body: { value: 100 } });
      assert.equal(saved.status, 200);
      analytics = await stats(challenge);
      assert.equal(analytics.data.summary.participants, 1);
      assert.equal(analytics.data.summary.completedWeeks, 1);
      assert.equal(analytics.data.summary.completionRate, 100);
      error(await teacher(`/teacher/challenges/${challenge.id}/members/${active.id}`, { method: 'DELETE' }), 409, 'HAS_RECORDS');
      assert.equal((await member(challenge, active)).status, 'active');
      error(await teacher(`/teacher/challenges/${challenge.id}/members/${randomUUID()}`, { method: 'DELETE' }), 404, 'NOT_MEMBER');
    });

    await t.test('acceptance is inclusive at Korea midnight, late invitations close, and forced enrollment uses endDate', async () => {
      beforeStart();
      const challenge = await makeChallenge();
      const onTime = await makeStudent('DEADLINE ON TIME'), late = await makeStudent('DEADLINE LATE');
      const forced = await makeStudent('DEADLINE FORCED'), tooLate = await makeStudent('DEADLINE AFTER END');
      await add(challenge, [onTime, late]);
      clock('2027-03-01T14:59:59.999Z');
      const accepted = await decide(challenge, onTime, 'accept');
      assert.equal(accepted.status, 200);
      assert.deepEqual(keys(accepted.data.membership), keys(studentFixture.current.membership));
      assert.equal(accepted.data.membership.status, 'active');
      assert.equal(accepted.data.membership.respondedAt, '2027-03-01T14:59:59.999Z');
      assert.equal((await request('/student/challenges', { cookie: late.cookie })).data.invitations.length, 1);
      clock('2027-03-01T15:00:00Z');
      error(await decide(challenge, late, 'accept'), 409, 'INVITATION_CLOSED');
      error(await add(challenge, [tooLate]), 409, 'ENROLLMENT_CLOSED');
      assert.equal((await request('/student/challenges', { cookie: late.cookie })).data.invitations.length, 0);
      assert.equal((await member(challenge, late)).status, 'pending');
      assert.equal((await decide(challenge, late, 'decline')).status, 200, 'a late pending invitation can still be declined');
      clock('2027-03-08T14:59:59.999Z');
      assert.equal((await add(challenge, [forced], 'forced')).status, 201);
      clock('2027-03-08T15:00:00Z');
      error(await add(challenge, [tooLate], 'forced'), 409, 'ENROLLMENT_CLOSED');
      assert.equal(await member(challenge, tooLate), null);
      assert.equal((await events(challenge, tooLate, 'enrollment')).length, 0);
    });

    await t.test('draft and archived challenges reject registration, student ownership, and private record access', async () => {
      beforeStart();
      const draft = await makeChallenge({ publish: false }), challenge = await makeChallenge();
      const owner = await makeStudent('OWNER'), outsider = await makeStudent('OUTSIDER');
      error(await add(draft, [owner], 'forced'), 409, 'CHALLENGE_NOT_PUBLISHED');
      error(await request(`/student/challenges/${draft.id}`, { cookie: owner.cookie }), 404, 'CHALLENGE_NOT_FOUND');
      assert.equal((await request(`/student/challenges/${challenge.id}`, { cookie: outsider.cookie })).status, 200);
      await add(challenge, [owner]);
      for (const suffix of ['/dashboard', '/records', '/records/2027-03-02']) {
        error(await request(`/student/challenges/${challenge.id}${suffix}`, { cookie: outsider.cookie }), 403, 'NOT_MEMBER');
        error(await request(`/student/challenges/${challenge.id}${suffix}`, { cookie: owner.cookie }), 403, 'NOT_MEMBER');
      }
      for (const student of [owner, outsider]) {
        error(await request(`/student/challenges/${challenge.id}/records/2027-03-02`, { cookie: student.cookie, method: 'PUT', body: { value: 100 } }), 403, 'NOT_MEMBER');
        error(await request(`/student/challenges/${challenge.id}/records/2027-03-02/corrections`, { cookie: student.cookie, method: 'POST', body: { value: 100, version: 1, reason: '접근 검증' } }), 403, 'NOT_MEMBER');
        error(await request(`/student/challenges/${challenge.id}/records/2027-03-02/attachments`, { cookie: student.cookie, method: 'POST' }), 403, 'NOT_MEMBER');
      }
      error(await decide(challenge, outsider, 'accept'), 404, 'NO_INVITATION');
      assert.equal((await member(challenge, owner)).status, 'pending');
      assert.equal((await request(`/teacher/challenges/${challenge.id}/members`, { cookie: owner.cookie })).status, 403);
      assert.equal((await request('/student/challenges', { cookie: staffCookie })).status, 403);
      assert.equal((await decide(challenge, owner, 'accept')).status, 200);
      const list = await request('/student/challenges', { cookie: owner.cookie });
      assert.equal(list.data.current.challenge.id, challenge.id);
      assert.deepEqual(keys(list.data.challenges[0]), keys(studentFixture.challenges[0]));
      const archived = await teacher(`/teacher/challenges/${challenge.id}/archive`, { method: 'POST', body: {} });
      assert.equal(archived.status, 200);
      error(await add(challenge, [outsider], 'forced'), 409, 'CHALLENGE_NOT_PUBLISHED');
      error(await request(`/student/challenges/${challenge.id}`, { cookie: owner.cookie }), 404, 'CHALLENGE_NOT_FOUND');
      assert.equal((await request('/student/challenges', { cookie: owner.cookie })).data.current, null);
    });

    await t.test('overlapping challenges isolate daily records, corrections, attachments and legacy current selection', async () => {
      beforeStart();
      const first = await makeChallenge({ title: '같은 날짜 첫 챌린지' });
      const second = await makeChallenge({ title: '같은 날짜 두번째 챌린지' });
      const student = await makeStudent('OVERLAP'), outsider = await makeStudent('OVERLAP OUTSIDER');
      await add(first, [student]);
      await add(second, [student]);
      assert.equal((await decide(first, student, 'accept')).status, 200);
      assert.equal((await decide(second, student, 'accept')).status, 200);
      clock('2027-03-02T01:00:00Z');
      const put = (challenge, value, version) => request(`/student/challenges/${challenge.id}/records/2027-03-02`, { cookie: student.cookie, method: 'PUT', body: { value, ...(version === undefined ? {} : { version }) } });
      const firstRecord = await put(first, 100), secondRecord = await put(second, 25);
      assert.equal(firstRecord.status, 200, JSON.stringify(firstRecord.data));
      assert.equal(secondRecord.status, 200, JSON.stringify(secondRecord.data));
      assert.notEqual(firstRecord.data.record.id, secondRecord.data.record.id);
      assert.equal(firstRecord.data.summary.completedWeeks, 1);
      assert.equal(secondRecord.data.summary.completedWeeks, 0);
      error(await put(first, 90, 2), 409, 'STALE_RECORD');
      for (const [challenge, expected] of [[first, 100], [second, 25]]) {
        const read = await request(`/student/challenges/${challenge.id}/records`, { cookie: student.cookie });
        assert.equal(read.status, 200);
        assert.equal(read.data.records.length, 1);
        assert.equal(read.data.records[0].value, expected);
        const dashboard = await request(`/student/challenges/${challenge.id}/dashboard`, { cookie: student.cookie });
        assert.deepEqual(keys(dashboard.data), ['challenge', 'membership', 'records', 'summary', 'unreadCount', 'user']);
        assert.equal(dashboard.data.challenge.id, challenge.id);
        assert.equal(dashboard.data.membership.status, 'active');
      }
      const legacy = await request('/student/dashboard', { cookie: student.cookie });
      assert.ok([first.id, second.id].includes(legacy.data.program.challengeId));
      assert.equal(legacy.data.program.status, 'active');
      assert.equal((await request('/program', { cookie: student.cookie })).data.challengeId, legacy.data.program.challengeId);
      const upload = new FormData(); upload.append('file', new Blob([png]), 'membership.png');
      const file = await request(`/student/challenges/${first.id}/records/2027-03-02/attachments`, { cookie: student.cookie, method: 'POST', body: upload });
      assert.equal(file.status, 201, JSON.stringify(file.data));
      const fileId = file.data.attachment.id;
      assert.equal((await request(`/attachments/${fileId}`, { cookie: outsider.cookie, raw: true })).status, 403);
      assert.equal((await request(`/attachments/${fileId}`, { cookie: student.cookie, raw: true })).status, 200);
      error(await request(`/student/challenges/${second.id}/records/2027-03-02/attachments/${fileId}`, { cookie: student.cookie, method: 'DELETE' }), 404, 'NOT_FOUND');
      assert.equal((await request(`/student/challenges/${first.id}/records/2027-03-02/attachments/${fileId}`, { cookie: student.cookie, method: 'DELETE' })).status, 200);
      assert.equal(await db.attachment.findUnique({ where: { id: fileId } }), null);
      clock('2027-03-03T01:00:00Z');
      const correction = await request(`/student/challenges/${second.id}/records/2027-03-02/corrections`, { cookie: student.cookie, method: 'POST', body: { value: 45, version: 1, reason: '독립된 챌린지 기록 정정이에요.' } });
      assert.equal(correction.status, 201, JSON.stringify(correction.data));
      assert.equal(correction.data.correction.challengeId, second.id);
      error(await request(`/student/challenges/${second.id}/records/2027-03-02/corrections`, { cookie: outsider.cookie, method: 'POST', body: { value: 999, version: 1, reason: '접근 거부 검증' } }), 403, 'NOT_MEMBER');
      const approved = await teacher(`/teacher/corrections/${correction.data.correction.id}/approve`, { method: 'POST', body: {} });
      assert.equal(approved.status, 200);
      assert.equal(approved.data.record.value, 45);
      assert.equal((await db.dailyRecord.findUnique({ where: { id: firstRecord.data.record.id } })).value, 100);
      const correctionList = await request('/student/corrections', { cookie: student.cookie });
      assert.equal(correctionList.data.corrections[0].challengeId, second.id);
      assert.equal((await teacher(`/teacher/corrections?challengeId=${first.id}`)).data.corrections.length, 0);
      assert.equal((await teacher(`/teacher/corrections?challengeId=${second.id}&status=all`)).data.corrections.length, 1);
    });

    await t.test('simultaneous accept and decline produce exactly one decision, and forced/invited registration converges safely', async () => {
      beforeStart();
      const challenge = await makeChallenge();
      const student = await makeStudent('DECISION RACE'), enrollee = await makeStudent('ENROLLMENT RACE');
      await add(challenge, [student]);
      const decisions = await Promise.all([decide(challenge, student, 'accept'), decide(challenge, student, 'decline')]);
      assert.deepEqual(decisions.map(response => response.status).sort(), [200, 404]);
      assert.equal(decisions.find(response => response.status === 404).data.error.code, 'NO_INVITATION');
      const saved = await member(challenge, student);
      assert.ok(['active', 'declined'].includes(saved.status));
      assert.equal(saved.status, decisions.find(response => response.status === 200).data.membership.status);
      assert.ok(saved.respondedAt);
      assert.equal((await events(challenge, student, 'invitation')).length, 1);
      const enrollments = await Promise.all([add(challenge, [enrollee], 'forced'), add(challenge, [enrollee])]);
      assert.ok(enrollments.every(response => response.status === 201), JSON.stringify(enrollments));
      assert.equal((await member(challenge, enrollee)).status, 'active');
      assert.equal((await member(challenge, enrollee)).mode, 'forced');
      assert.equal((await events(challenge, enrollee, 'enrollment')).length, 1);
      assert.ok((await events(challenge, enrollee, 'invitation')).length <= 1);
    });

    await t.test('multi-student registration rolls back both memberships and notifications on a later database failure', async () => {
      beforeStart();
      const challenge = await makeChallenge();
      const first = await makeStudent('ATOMIC FIRST'), blocked = await makeStudent('ATOMIC BLOCKED');
      const triggerName = `test_membership_failure_${randomUUID().replaceAll('-', '')}`;
      await db.$executeRawUnsafe(`CREATE FUNCTION "${triggerName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId" = '${blocked.id}' AND NEW."challengeId" = '${challenge.id}' THEN RAISE EXCEPTION 'test-only membership failure' USING ERRCODE = '23514'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "ChallengeMembership" FOR EACH ROW EXECUTE FUNCTION "${triggerName}"()`);
      try {
        const result = await add(challenge, [first, blocked], 'forced');
        assert.equal(result.status, 500);
        assert.equal(await db.challengeMembership.count({ where: { challengeId: challenge.id } }), 0);
        assert.equal(await db.notification.count({ where: { userId: { in: [first.id, blocked.id] } } }), 0);
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER "${triggerName}" ON "ChallengeMembership"`);
        await db.$executeRawUnsafe(`DROP FUNCTION "${triggerName}"()`);
      }
    });

    await t.test('legacy enrollment accepts an eligible pending invitation and otherwise preserves ENROLLMENT_CLOSED', async () => {
      beforeStart();
      const challenge = await makeChallenge();
      const student = await makeStudent('LEGACY ENROLL');
      await add(challenge, [student]);
      const accepted = await request('/student/enroll', { cookie: student.cookie, method: 'POST', body: {} });
      assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
      assert.deepEqual(keys(accepted.data), ['user']);
      assert.equal(accepted.data.user.participating, true);
      assert.equal((await member(challenge, student)).status, 'active');
      assert.equal((await request('/student/dashboard', { cookie: student.cookie })).data.program.challengeId, challenge.id);
      error(await request('/student/enroll', { cookie: student.cookie, method: 'POST', body: {} }), 403, 'ENROLLMENT_CLOSED');
    });

    await t.test('legacy enrollment requires a choice when multiple eligible invitations exist', async () => {
      beforeStart();
      const first = await makeChallenge(), second = await makeChallenge();
      const student = await makeStudent('LEGACY MULTIPLE');
      await add(first, [student]); await add(second, [student]);
      const response = await request('/student/enroll', { cookie: student.cookie, method: 'POST', body: {} });
      error(response, 409, 'INVITATION_SELECTION_REQUIRED');
      assert.deepEqual(new Set(response.data.error.details.challengeIds), new Set([first.id, second.id]));
      assert.equal((await member(first, student)).status, 'pending');
      assert.equal((await member(second, student)).status, 'pending');
      assert.equal((await decide(first, student, 'accept')).status, 200);
      assert.equal((await member(first, student)).status, 'active');
      assert.equal((await member(second, student)).status, 'pending');
      const remaining = await request('/student/enroll', { cookie: student.cookie, method: 'POST', body: {} });
      assert.equal(remaining.status, 200);
      assert.equal(remaining.data.user.participating, true);
      assert.equal((await member(second, student)).status, 'active');
    });

    await t.test('challenge reminders use active memberships only, while invitation and enrollment push bypass exercise gates', async () => {
      beforeStart();
      const challenge = await makeChallenge({ title: '알림 범위 검증' });
      const active = await makeStudent('PUSH ACTIVE'), pending = await makeStudent('PUSH PENDING');
      await db.pushSubscription.createMany({ data: [active, pending].map(student => ({ userId: student.id, endpoint: `https://fcm.googleapis.com/test-only-${student.id}`, p256dh: 'synthetic', auth: 'synthetic' })) });
      await add(challenge, [active], 'forced');
      await add(challenge, [pending]);
      const enrollment = (await events(challenge, active, 'enrollment'))[0];
      const invitation = (await events(challenge, pending, 'invitation'))[0];
      // Restrict dispatch to this subtest; do not consume pending events from other API cases.
      const eventIds = [enrollment.id, invitation.id];
      const scopedNotifications = new Proxy(db.notification, { get(target, key) {
        if (key === 'findMany') return args => target.findMany({ ...args, where: { AND: [args.where, { id: { in: eventIds } }] } });
        return target[key];
      } });
      const scopedChallenges = new Proxy(db.challenge, { get(target, key) {
        if (key === 'findMany') return args => target.findMany({ ...args, where: { AND: [args.where, { id: challenge.id }] } });
        return target[key];
      } });
      const scopedDb = new Proxy(db, { get(target, key) { return key === 'notification' ? scopedNotifications : key === 'challenge' ? scopedChallenges : target[key]; } });
      const sent = [];
      const transport = async (_subscription, payload) => { sent.push(JSON.parse(payload)); return { statusCode: 201 }; };
      // It is 10:00 KST before the activity period, so a reminder would be ineligible.
      await deliverPendingPush(scopedDb, transport);
      assert.deepEqual(new Set(sent.map(event => event.id)), new Set(eventIds));
      for (const message of sent) {
        assert.equal(message.url, '/mobile/challenges');
        assert.equal(message.data.challengeId, challenge.id);
        assert.equal(message.data.membershipId, message.id === enrollment.id ? enrollment.data.membershipId : invitation.data.membershipId);
      }
      clock('2027-03-02T11:00:00Z');
      assert.equal((await createReminderEvents(scopedDb, new Date())).created, 1);
      assert.equal((await createReminderEvents(scopedDb, new Date())).created, 0);
      const reminders = await db.notification.findMany({ where: { userId: { in: [active.id, pending.id] }, type: 'reminder' } });
      assert.equal(reminders.length, 1);
      assert.equal(reminders[0].userId, active.id);
      assert.equal(reminders[0].eventKey, `reminder:${challenge.id}:${active.id}:2027-03-02`);
      const feed = await request('/student/notifications', { cookie: pending.cookie });
      assert.equal(feed.status, 200);
      assert.deepEqual(feed.data.notifications.find(event => event.id === invitation.id).data, invitation.data);
      privacy(feed.data);
    });

    await t.test('closed invitations stay visible until the end, the roster follows a chosen challenge, accounts have no participation flag, and legacy routes are deprecated', async () => {
      beforeStart();
      const challenge = await makeChallenge();
      const invited = await makeStudent('CLOSED INVITATION'), enrolled = await makeStudent('ROSTER ACTIVE');
      await add(challenge, [invited]);
      await add(challenge, [enrolled], 'forced');
      const listed = async () => (await request('/student/challenges', { cookie: invited.cookie })).data;
      assert.deepEqual((await listed()).closedInvitations, []);
      clock('2027-03-01T15:00:00Z');
      const closed = await listed();
      assert.equal(closed.invitations.length, 0);
      assert.deepEqual(closed.closedInvitations.map(item => [item.challenge.id, item.membership.status]), [[challenge.id, 'pending']]);
      assert.deepEqual(keys(closed.closedInvitations[0]), keys(studentFixture.invitations[0]));
      assert.deepEqual(keys(closed.closedInvitations[0].challenge), keys(studentFixture.invitations[0].challenge));
      error(await decide(challenge, invited, 'accept'), 409, 'INVITATION_CLOSED');
      privacy(closed);
      clock('2027-03-08T15:00:00Z');
      assert.deepEqual((await listed()).closedInvitations, [], 'closed invitations disappear once the challenge has ended');

      const roster = await teacher(`/teacher/students?challengeId=${challenge.id}&grade=91`);
      assert.equal(roster.status, 200, JSON.stringify(roster.data));
      const flag = id => roster.data.students.find(user => user.id === id)?.participating;
      assert.equal(flag(enrolled.id), true);
      assert.equal(flag(invited.id), false);
      const active = await teacher(`/teacher/students?challengeId=${challenge.id}&grade=91&participating=true`);
      assert.ok(active.data.students.some(user => user.id === enrolled.id));
      assert.ok(!active.data.students.some(user => user.id === invited.id));
      assert.equal(typeof (await teacher('/teacher/students?grade=91')).data.students.find(user => user.id === enrolled.id).participating, 'boolean', 'without challengeId the current challenge decides');
      error(await teacher('/teacher/students?challengeId=missing-challenge'), 404, 'CHALLENGE_NOT_FOUND');

      const created = await teacher('/teacher/students', { method: 'POST', body: { studentNumber: `member-${randomUUID()}`, name: 'MEMBER TEST REQUIRED', grade: 91, classNumber: 2, targetType: 'required' } });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      createdUsers.add(created.data.user.id);
      assert.equal(created.data.user.participating, null, 'account-level users have no participation flag (null = no challenge context)');
      assert.equal(await db.challengeMembership.count({ where: { userId: created.data.user.id } }), 0, 'a new required student is not enrolled anywhere until a teacher adds them');
      assert.equal((await teacher(`/teacher/students/${invited.id}`, { method: 'PATCH', body: { targetType: 'required' } })).data.user.participating, null);

      const deprecated = response => response.headers.get('deprecation');
      assert.equal(deprecated(await request('/student/dashboard', { cookie: enrolled.cookie })), 'true');
      assert.equal(deprecated(await request('/student/records', { cookie: enrolled.cookie })), 'true');
      assert.equal(deprecated(await request('/program', { cookie: enrolled.cookie })), 'true');
      assert.equal(deprecated(await request('/student/enroll', { cookie: invited.cookie, method: 'POST', body: {} })), 'true');
      assert.equal(deprecated(await request(`/student/challenges/${challenge.id}/dashboard`, { cookie: enrolled.cookie })), null);
      assert.equal(deprecated(await request('/student/challenges', { cookie: enrolled.cookie })), null);
    });
  } finally {
    t.mock.timers.reset();
    const challengeId = { in: [...createdChallenges] }, userId = { in: [...createdUsers] };
    const record = { challengeId };
    const files = await db.attachment.findMany({ where: { record } });
    await db.attachment.deleteMany({ where: { record } });
    await Promise.all(files.map(file => unlink(path.join(temp, file.storageKey)).catch(error => { if (error.code !== 'ENOENT') throw error; })));
    await db.recordRevision.deleteMany({ where: { record } });
    await db.correction.deleteMany({ where: { record } });
    await db.dailyRecord.deleteMany({ where: { challengeId } });
    await db.notification.deleteMany({ where: { userId } });
    await db.challengeMembership.deleteMany({ where: { challengeId } });
    await db.challenge.deleteMany({ where: { id: challengeId } });
    await db.session.deleteMany({ where: { id: { in: sessionIds } } });
    await db.user.deleteMany({ where: { id: userId } });
  }
}
