// In-memory stand-in for the challenge API (VITE_CHALLENGE_API=mock). Starts from
// docs/challenges/fixtures and enforces the contract's transitions and error codes the way
// the server does. State lives in this module, so a page reload resets it.
// window.__SELF_FIT_TODAY = 'YYYY-MM-DD' overrides the fixture's "today" to test phases.
//
// The fixtures are snapshots from different moments: challenges.json / challenge-detail.json
// show c2027-spring as a fresh draft, while members.json / student-challenges.json show it
// published with three members. The mock starts from the later snapshot (published) so the
// member and invitation fixtures are consistent; counts are always computed from memberships.
import { ApiError } from '../shared.jsx';
import listFixture from '../../../docs/challenges/fixtures/challenges.json';
import detailFixture from '../../../docs/challenges/fixtures/challenge-detail.json';
import errorFixture from '../../../docs/challenges/fixtures/errors.json';
import membersFixture from '../../../docs/challenges/fixtures/members.json';
import studentFixture from '../../../docs/challenges/fixtures/student-challenges.json';
import { addDays, isDate, normalizeWeek, shiftWeeks, validateChallenge } from './validate.js';
import { legacyWeeks } from './mock-legacy.js';
import { ME, TEACHER, roster } from './mock-people.js';

const FIXTURE_TODAY = listFixture.challenges[0].today;
const LEGACY = 'c2026-legacy';
const DERIVED = ['phase', 'today', 'weekCount', 'activityDates', 'weeks', 'counts'];
const strip = summary => Object.fromEntries(Object.entries(summary).filter(([key]) => !DERIVED.includes(key)));

const state = { challenges: new Map(), memberships: [], records: new Set() };
for (const summary of listFixture.challenges) {
  const detail = detailFixture.challenge.id === summary.id ? detailFixture.challenge : null;
  state.challenges.set(summary.id, { ...strip(summary), weeks: structuredClone(detail?.weeks || (summary.id === LEGACY ? legacyWeeks : [])) });
}
const studentEntries = [studentFixture.current, ...studentFixture.challenges, ...studentFixture.invitations].filter(Boolean);
for (const { challenge } of studentEntries) if (state.challenges.has(challenge.id)) state.challenges.get(challenge.id).lifecycle = challenge.lifecycle;
for (const member of membersFixture.members) {
  state.memberships.push({ id: member.id, challengeId: member.challengeId, userId: member.user.id, mode: member.mode, status: member.status, invitedById: member.invitedBy?.id ?? null, invitedAt: member.invitedAt, respondedAt: member.respondedAt });
}
// The legacy challenge: every mock student took part with records (so removal shows HAS_RECORDS),
// except two who declined an invitation; "me" matches student-challenges.json (forced/active).
for (const user of roster) {
  const declined = ['u-30310', 'u-20102'].includes(user.id);
  const self = studentEntries.find(entry => entry.challenge.id === LEGACY && user.id === ME)?.membership;
  state.memberships.push({ id: `m-legacy-${user.studentNumber}`, challengeId: LEGACY, userId: user.id, mode: self?.mode || (declined ? 'invited' : 'forced'), status: self?.status || (declined ? 'declined' : 'active'), invitedById: null, invitedAt: self?.invitedAt || '2026-05-01T00:00:00.000Z', respondedAt: declined ? '2026-05-02T00:00:00.000Z' : self?.respondedAt ?? null });
  if (!declined) state.records.add(`${LEGACY}:${user.id}`);
}

const today = () => (typeof window !== 'undefined' && isDate(window.__SELF_FIT_TODAY) ? window.__SELF_FIT_TODAY : FIXTURE_TODAY);
const wait = () => new Promise(resolve => setTimeout(resolve, 120));
const newId = prefix => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const now = () => new Date().toISOString();
const messages = {
  CHALLENGE_NOT_FOUND: '챌린지를 찾을 수 없습니다.',
  CHALLENGE_ARCHIVED: '보관된 챌린지는 수정할 수 없습니다.',
  ALREADY_PUBLISHED: '이미 게시된 챌린지입니다.',
  CHALLENGE_NOT_PUBLISHED: '게시된 챌린지만 보관할 수 있습니다.',
  CHALLENGE_NOT_DRAFT: '초안만 삭제할 수 있습니다.',
  INVALID_SELECTION: '학생 목록이나 조건 중 하나만 보내 주세요.',
  NO_INVITATION: '대기 중인 초대가 없습니다.',
};
// Status comes from the endpoint's row in the contract (NOT_MEMBER is 404 on DELETE members, 403 for students).
function fail(code, status, details) {
  const fixture = errorFixture[code]?.body?.error;
  throw new ApiError(fixture?.message || messages[code] || '요청을 처리하지 못했어요.', status, code, details);
}
function invalid(details) { fail('INVALID_CHALLENGE', 400, details); }

export function phaseOf(challenge, date = today()) {
  if (challenge.lifecycle !== 'published') return challenge.lifecycle;
  if (date < challenge.startDate) return 'upcoming';
  if (date > challenge.endDate) return 'ended';
  return challenge.weeks.some(week => week.startDate <= date && date <= week.endDate) ? 'active' : 'rest';
}
function activityDates(weeks) {
  const dates = [];
  for (const week of weeks) for (let date = week.startDate; date <= week.endDate; date = addDays(date, 1)) dates.push(date);
  return dates;
}
const membersOf = challengeId => state.memberships.filter(member => member.challengeId === challengeId);
/** Counts every status; `cohort` (grade/class/targetType/search) narrows it, status/mode never do (contract). */
function stats(challengeId, cohort = () => true) {
  const result = { active: 0, pending: 0, declined: 0, removed: 0, forced: 0, invited: 0 };
  for (const member of membersOf(challengeId).filter(cohort)) {
    result[member.status] += 1;
    if (member.status !== 'removed') result[member.mode] += 1;
  }
  return result;
}
function summary(challenge) {
  const { weeks, ...rest } = challenge;
  const { removed: _removed, ...counts } = stats(challenge.id);
  return structuredClone({ ...rest, phase: phaseOf(challenge), today: today(), weekCount: weeks.length, counts });
}
const detail = challenge => ({ ...summary(challenge), weeks: structuredClone(challenge.weeks), activityDates: activityDates(challenge.weeks) });
function find(id) {
  const challenge = state.challenges.get(id);
  if (!challenge) fail('CHALLENGE_NOT_FOUND', 404);
  return challenge;
}
const numbered = weeks => weeks.map((week, index) => ({ id: week.id || newId('w'), week: index + 1, ...normalizeWeek(week) }));

export async function listChallenges({ lifecycle = 'all' } = {}) {
  await wait();
  const items = [...state.challenges.values()].filter(challenge => lifecycle === 'all' || challenge.lifecycle === lifecycle);
  return { challenges: items.sort((a, b) => b.startDate.localeCompare(a.startDate)).map(summary) };
}

export async function getChallenge(id) {
  await wait();
  return { challenge: detail(find(id)) };
}

export async function createChallenge(body = {}) {
  await wait();
  const weeks = Array.isArray(body.weeks) ? body.weeks : [];
  const input = { ...body, weeks, endDate: body.endDate || weeks.at(-1)?.endDate, enrollmentDeadline: body.enrollmentDeadline || (isDate(body.startDate) ? addDays(body.startDate, -1) : undefined) };
  const errors = validateChallenge(input);
  if (errors.length) invalid(errors);
  const time = now();
  const challenge = {
    id: newId('c'), title: input.title.trim(), description: input.description || '', year: Number(input.startDate.slice(0, 4)),
    lifecycle: 'draft', startDate: input.startDate, endDate: input.endDate, enrollmentDeadline: input.enrollmentDeadline,
    sourceChallengeId: null, createdAt: time, updatedAt: time, weeks: numbered(weeks),
  };
  state.challenges.set(challenge.id, challenge);
  return { challenge: detail(challenge) };
}

export async function duplicateChallenge(id, { title, startDate } = {}) {
  await wait();
  const source = find(id);
  if (!isDate(startDate)) invalid([{ path: 'startDate', message: '시작일을 입력해 주세요.' }]);
  const weeks = shiftWeeks(source.weeks, source.startDate, startDate).map(({ id: _id, ...week }) => week);
  const input = { title: title?.trim() || `${source.title} (복사)`, description: source.description, startDate, endDate: weeks.at(-1)?.endDate || startDate, enrollmentDeadline: addDays(startDate, -1), weeks };
  const errors = validateChallenge(input);
  if (errors.length) invalid(errors);
  const time = now();
  const challenge = {
    id: newId('c'), title: input.title, description: input.description, year: Number(startDate.slice(0, 4)), lifecycle: 'draft',
    startDate, endDate: input.endDate, enrollmentDeadline: input.enrollmentDeadline, sourceChallengeId: source.id,
    createdAt: time, updatedAt: time, weeks: numbered(weeks),
  };
  state.challenges.set(challenge.id, challenge);
  return { challenge: detail(challenge) };
}

const WEEK_FIELDS = ['startDate', 'endDate', 'inputType', 'weeklyTarget', 'dailyTarget', 'unit', 'dailyUnit', 'exercises'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** After the start only titles, descriptions and week colours may change (README §4.1; the server's cosmetic fields). */
function touchesLockedFields(challenge, body) {
  if (['startDate', 'endDate', 'enrollmentDeadline'].some(key => key in body && body[key] !== challenge[key])) return true;
  if (!('weeks' in body)) return false;
  if (!Array.isArray(body.weeks) || body.weeks.length !== challenge.weeks.length) return true;
  return body.weeks.some((week, index) => {
    const next = normalizeWeek(week), current = normalizeWeek(challenge.weeks[index]);
    return WEEK_FIELDS.some(key => !same(next[key], current[key]));
  });
}

export async function updateChallenge(id, body = {}) {
  await wait();
  const challenge = find(id);
  if (challenge.lifecycle === 'archived') fail('CHALLENGE_ARCHIVED', 409);
  const phase = phaseOf(challenge);
  if (challenge.lifecycle === 'published' && phase !== 'upcoming' && touchesLockedFields(challenge, body)) fail('CHALLENGE_LOCKED', 409);
  const next = { ...challenge, ...Object.fromEntries(['title', 'description', 'startDate', 'endDate', 'enrollmentDeadline'].filter(key => key in body).map(key => [key, body[key]])) };
  if ('weeks' in body) next.weeks = Array.isArray(body.weeks) ? body.weeks : [];
  const errors = validateChallenge(next);
  if (errors.length) invalid(errors);
  const saved = {
    ...next, title: next.title.trim(), description: next.description || '', year: Number(next.startDate.slice(0, 4)), updatedAt: now(),
    weeks: 'weeks' in body ? next.weeks.map((week, index) => ({ ...numbered([week])[0], id: challenge.weeks[index]?.id || newId('w'), week: index + 1 })) : challenge.weeks,
  };
  state.challenges.set(id, saved);
  return { challenge: detail(saved) };
}

export async function publishChallenge(id) {
  await wait();
  const challenge = find(id);
  if (challenge.lifecycle !== 'draft') fail('ALREADY_PUBLISHED', 409);
  const errors = validateChallenge(challenge);
  if (errors.length) invalid(errors);
  const saved = { ...challenge, lifecycle: 'published', updatedAt: now() };
  state.challenges.set(id, saved);
  return { challenge: detail(saved) };
}

export async function archiveChallenge(id) {
  await wait();
  const challenge = find(id);
  if (challenge.lifecycle !== 'published') fail('CHALLENGE_NOT_PUBLISHED', 409);
  const saved = { ...challenge, lifecycle: 'archived', updatedAt: now() };
  state.challenges.set(id, saved);
  return { challenge: detail(saved) };
}

export async function deleteChallenge(id) {
  await wait();
  const challenge = find(id);
  if (challenge.lifecycle !== 'draft') fail('CHALLENGE_NOT_DRAFT', 409);
  state.challenges.delete(id);
  return { ok: true };
}

// ---- Members (teacher) ----------------------------------------------------------------
const userOf = id => roster.find(user => user.id === id);
const self = member => ({ mode: member.mode, status: member.status, invitedAt: member.invitedAt, respondedAt: member.respondedAt });
// Membership.user.participating means "active in this challenge" (contract, PR #2).
const memberDto = member => structuredClone({ id: member.id, challengeId: member.challengeId, user: { ...userOf(member.userId), participating: member.status === 'active' }, ...self(member), invitedBy: member.invitedById === TEACHER.id ? TEACHER : member.invitedById ? { id: member.invitedById, name: '교사' } : null });
const membershipOf = (challengeId, userId) => state.memberships.find(member => member.challengeId === challengeId && member.userId === userId);
const list = value => Array.isArray(value) ? value : String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
function matches(user, filters = {}) {
  if (filters.grade !== undefined && filters.grade !== '' && String(user.grade) !== String(filters.grade)) return false;
  if (filters.classNumber !== undefined && filters.classNumber !== '' && String(user.classNumber) !== String(filters.classNumber)) return false;
  if (filters.targetType && user.targetType !== filters.targetType) return false;
  return true;
}
function selection({ studentIds, filters } = {}) {
  const byIds = Array.isArray(studentIds) && studentIds.length > 0, byFilters = !!filters && typeof filters === 'object' && !Array.isArray(filters);
  if (byIds === byFilters) fail('INVALID_SELECTION', 400);
  return byIds ? { ids: [...new Set(studentIds)] } : { users: roster.filter(user => matches(user, filters)) };
}

export async function listMembers(id, filters = {}) {
  await wait();
  find(id);
  const statuses = list(filters.status || 'active,pending,declined'), modes = list(filters.mode);
  const search = String(filters.search || '').trim().toLowerCase();
  const cohort = member => { const user = userOf(member.userId); return !!user && matches(user, filters) && (!search || user.name.toLowerCase().includes(search) || user.studentNumber.toLowerCase().includes(search)); };
  const members = membersOf(id).filter(member => cohort(member) && statuses.includes(member.status) && (!modes.length || modes.includes(member.mode)));
  return { members: members.map(memberDto).sort((a, b) => a.user.studentNumber.localeCompare(b.user.studentNumber)), stats: stats(id, cohort) };
}

export async function previewMembers(id, body = {}) {
  await wait();
  find(id);
  const picked = selection(body);
  const users = picked.users || picked.ids.map(userOf).filter(Boolean);
  return { students: structuredClone(users.map(user => { const member = membershipOf(id, user.id); return { ...user, participating: member?.status === 'active', membership: member ? self(member) : null }; })) };
}

export async function addMembers(id, body = {}) {
  await wait();
  const challenge = find(id);
  if (challenge.lifecycle !== 'published') fail('CHALLENGE_NOT_PUBLISHED', 409);
  if (!['forced', 'invited'].includes(body.mode)) fail('INVALID_SELECTION', 400);
  const date = today();
  if (body.mode === 'invited' ? date > challenge.enrollmentDeadline : date > challenge.endDate) fail('ENROLLMENT_CLOSED', 409);
  const picked = selection(body);
  const targets = picked.users ? picked.users.map(user => user.id) : picked.ids;
  const added = [], skipped = [];
  const skip = (userId, reason) => { const user = userOf(userId); skipped.push({ userId, studentNumber: user?.studentNumber ?? null, name: user?.name ?? null, reason }); };
  for (const userId of targets) {
    if (userId === TEACHER.id) { skip(userId, 'not_student'); continue; }
    if (!userOf(userId)) { skip(userId, 'not_found'); continue; }
    const time = now(), forced = body.mode === 'forced';
    let member = membershipOf(id, userId);
    if (member?.status === 'active') { skip(userId, 'already_active'); continue; }
    if (member?.status === 'pending' && !forced) { skip(userId, 'already_pending'); continue; }
    if (!member) { member = { id: newId('m'), challengeId: id, userId }; state.memberships.push(member); }
    // removed and declined restart like a new membership; pending + forced converts in place.
    const converting = member.status === 'pending' && forced;
    Object.assign(member, { mode: body.mode, status: forced ? 'active' : 'pending', invitedById: TEACHER.id, ...(converting ? {} : { invitedAt: time }), respondedAt: null });
    added.push(memberDto(member));
  }
  return { added, skipped };
}

export async function removeMember(id, userId) {
  await wait();
  find(id);
  const member = membershipOf(id, userId);
  if (!member || member.status === 'removed') fail('NOT_MEMBER', 404);
  if (state.records.has(`${id}:${userId}`)) fail('HAS_RECORDS', 409);
  member.status = 'removed';
  return { ok: true };
}

/** Roster for the member picker (the real client calls the existing GET /teacher/students). */
export async function listStudents() {
  await wait();
  return { students: structuredClone(roster) };
}

// ---- Student --------------------------------------------------------------------------
const PHASE_ORDER = ['active', 'upcoming', 'rest'];
function mine() {
  return state.memberships.filter(member => member.userId === ME && ['active', 'pending'].includes(member.status))
    .map(member => ({ member, challenge: state.challenges.get(member.challengeId) }))
    .filter(entry => entry.challenge?.lifecycle === 'published');
}
const entry = ({ member, challenge }) => ({ challenge: summary(challenge), membership: self(member) });

export async function listMyChallenges() {
  await wait();
  const date = today(), entries = mine().sort((a, b) => b.challenge.startDate.localeCompare(a.challenge.startDate));
  const open = item => item.member.mode === 'invited' && item.member.status === 'pending' && date <= item.challenge.enrollmentDeadline;
  const active = entries.filter(item => item.member.status === 'active');
  const current = PHASE_ORDER.map(phase => active.find(item => phaseOf(item.challenge) === phase)).find(Boolean)
    || active.filter(item => phaseOf(item.challenge) === 'ended').sort((a, b) => b.challenge.endDate.localeCompare(a.challenge.endDate))[0];
  return {
    current: current ? entry(current) : null,
    // Same as the server: confirmed memberships only. An expired invitation simply disappears.
    challenges: active.map(entry),
    invitations: entries.filter(open).map(entry),
    closedInvitations: entries.filter(item => item.member.mode === 'invited' && item.member.status === 'pending' && date > item.challenge.enrollmentDeadline && date <= item.challenge.endDate).map(entry),
  };
}

function pendingInvitation(id) {
  const member = membershipOf(id, ME);
  const challenge = state.challenges.get(id);
  if (!member || member.status !== 'pending' || challenge?.lifecycle !== 'published') fail('NO_INVITATION', 404);
  return { member, challenge };
}

export async function acceptInvitation(id) {
  await wait();
  const { member, challenge } = pendingInvitation(id);
  if (today() > challenge.enrollmentDeadline) fail('INVITATION_CLOSED', 409);
  Object.assign(member, { status: 'active', respondedAt: now() });
  return { membership: self(member) };
}

export async function declineInvitation(id) {
  await wait();
  const { member } = pendingInvitation(id);
  Object.assign(member, { status: 'declined', respondedAt: now() });
  return { membership: self(member) };
}

export async function getStudentChallenge(id) {
  await wait();
  const challenge = state.challenges.get(id);
  if (!challenge || challenge.lifecycle !== 'published') fail('CHALLENGE_NOT_FOUND', 404);
  return { challenge: detail(challenge) };
}

export async function getChallengeDashboard(id) {
  await wait();
  const { challenge } = await getStudentChallenge(id);
  const member = membershipOf(id, ME);
  if (member?.status !== 'active') fail('NOT_MEMBER', 403);
  const weeks = challenge.weeks.map(week => ({ week: week.week, weekdayTotal: 0, weekendTotal: 0, total: 0, weekdayAchieved: 0, weekendAchieved: 0, makeupDays: 0, complete: false, progress: 0, status: 'missing', recordedDays: 0 }));
  return { user: structuredClone(userOf(ME)), challenge, membership: self(member), summary: { weeks, completedWeeks: 0, totalWeeks: weeks.length, pendingWeeks: [], complete: false, progress: 0, status: 'missing' }, records: [], unreadCount: 0 };
}
