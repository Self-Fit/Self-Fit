// In-memory stand-in for the challenge API (VITE_CHALLENGE_API=mock). Starts from
// docs/challenges/fixtures and enforces the contract's transitions and error codes the way
// the server does. State lives in this module, so a page reload resets it.
// window.__SELF_FIT_TODAY = 'YYYY-MM-DD' overrides the fixture's "today" to test phases.
import { ApiError } from '../shared.jsx';
import listFixture from '../../../docs/challenges/fixtures/challenges.json';
import detailFixture from '../../../docs/challenges/fixtures/challenge-detail.json';
import errorFixture from '../../../docs/challenges/fixtures/errors.json';
import { addDays, isDate, normalizeWeek, shiftWeeks, validateChallenge } from './validate.js';
import { legacyWeeks } from './mock-legacy.js';

const FIXTURE_TODAY = listFixture.challenges[0].today;
const DERIVED = ['phase', 'today', 'weekCount', 'activityDates', 'weeks', 'counts'];
const strip = summary => Object.fromEntries(Object.entries(summary).filter(([key]) => !DERIVED.includes(key)));

const state = { challenges: new Map() };
for (const summary of listFixture.challenges) {
  const detail = detailFixture.challenge.id === summary.id ? detailFixture.challenge : null;
  state.challenges.set(summary.id, { ...strip(summary), counts: { ...summary.counts }, weeks: structuredClone(detail?.weeks || (summary.id === 'c2026-legacy' ? legacyWeeks : [])) });
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
};
function fail(code, status, details) {
  const fixture = errorFixture[code]?.body?.error;
  throw new ApiError(fixture?.message || messages[code] || '요청을 처리하지 못했어요.', errorFixture[code]?.status || status, code, details);
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
function summary(challenge) {
  const { weeks, ...rest } = challenge;
  return structuredClone({ ...rest, phase: phaseOf(challenge), today: today(), weekCount: weeks.length });
}
const detail = challenge => ({ ...summary(challenge), weeks: structuredClone(challenge.weeks), activityDates: activityDates(challenge.weeks) });
function find(id) {
  const challenge = state.challenges.get(id);
  if (!challenge) fail('CHALLENGE_NOT_FOUND', 404);
  return challenge;
}
const numbered = weeks => weeks.map((week, index) => ({ id: week.id || newId('w'), week: index + 1, ...normalizeWeek(week) }));
const zeroCounts = () => ({ active: 0, pending: 0, declined: 0, forced: 0, invited: 0 });

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
    sourceChallengeId: null, counts: zeroCounts(), createdAt: time, updatedAt: time, weeks: numbered(weeks),
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
    counts: zeroCounts(), createdAt: time, updatedAt: time, weeks: numbered(weeks),
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
