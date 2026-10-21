import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { challengeCounts, challengeDto, createChallenge, resolveCurrentChallenge } from '../src/challenges.js';
import { koreanDate } from '../src/domain/index.js';

const fixture = JSON.parse(await readFile(new URL('../../docs/challenges/fixtures/challenge-detail.json', import.meta.url), 'utf8')).challenge;
const listFixture = JSON.parse(await readFile(new URL('../../docs/challenges/fixtures/challenges.json', import.meta.url), 'utf8')).challenges[0];
const keys = value => Object.keys(value).sort();
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const noMembers = { groupBy: async () => [] };

test('challenge DTOs match shared detail, summary and week fixture keys without exposing persistence fields', () => {
  const input = structuredClone(fixture);
  input.createdById = 'not-public';
  input.weeks.forEach(week => { week.challengeId = input.id; week.exercises ??= null; week.deferred = false; });
  const detail = challengeDto(input, fixture.today);
  assert.deepEqual(keys(detail), keys(fixture));
  assert.deepEqual(keys(challengeDto(input, fixture.today, { detail: false })), keys(listFixture));
  for (const [index, week] of detail.weeks.entries()) assert.deepEqual(keys(week), keys(fixture.weeks[index]));
  assert.deepEqual(detail, fixture);
});

test('membership group counts include declined invitations while excluding removed memberships', async () => {
  let query;
  const db = { challengeMembership: { groupBy: async input => {
    query = input;
    return [
      { challengeId: 'a', status: 'active', mode: 'forced', _count: { _all: 3 } },
      { challengeId: 'a', status: 'active', mode: 'invited', _count: { _all: 2 } },
      { challengeId: 'a', status: 'pending', mode: 'invited', _count: { _all: 4 } },
      { challengeId: 'a', status: 'declined', mode: 'invited', _count: { _all: 1 } },
    ];
  } } };
  const actual = await challengeCounts(db, ['a', 'b']);
  assert.deepEqual(query, { by: ['challengeId', 'status', 'mode'], where: { challengeId: { in: ['a', 'b'] }, status: { not: 'removed' } }, _count: { _all: true } });
  assert.deepEqual(actual.get('a'), { active: 5, pending: 4, declined: 1, forced: 3, invited: 7 });
  assert.deepEqual(actual.get('b'), { active: 0, pending: 0, declined: 0, forced: 0, invited: 0 });
  assert.equal((await challengeCounts({}, [])).size, 0);
});

test('current student challenge prioritizes active, upcoming, rest, then latest ended deterministically', async () => {
  const today = koreanDate();
  const challenge = (id, start, end, ranges) => ({
    id, lifecycle: 'published', startDate: shift(today, start), endDate: shift(today, end),
    weeks: ranges.map(([from, to], index) => ({ week: index + 1, startDate: shift(today, from), endDate: shift(today, to) })),
  });
  const activeA = challenge('a', -3, 5, [[-3, 5]]);
  const activeB = challenge('b', -3, 5, [[-3, 5]]);
  const upcomingNear = challenge('near', 1, 5, [[1, 5]]);
  const upcomingFar = challenge('far', 7, 12, [[7, 12]]);
  const rest = challenge('rest', -10, 10, [[-10, -5], [5, 10]]);
  const endedRecent = challenge('recent', -20, -1, [[-20, -1]]);
  const endedOlder = challenge('older', -25, -7, [[-25, -7]]);
  let rows = [endedOlder, endedRecent, rest, upcomingFar, upcomingNear, activeB, activeA];
  const db = {
    challenge: { findMany: async query => {
      assert.deepEqual(query.where, { lifecycle: 'published', memberships: { some: { userId: 'student', status: 'active' } } });
      return structuredClone(rows);
    } },
    challengeMembership: noMembers,
  };
  const resolve = () => resolveCurrentChallenge(db, { id: 'student', role: 'student' });
  assert.equal((await resolve()).id, 'a');
  rows = rows.filter(row => !row.id.match(/^[ab]$/));
  assert.equal((await resolve()).id, 'near');
  rows = rows.filter(row => !['near', 'far'].includes(row.id));
  assert.equal((await resolve()).id, 'rest');
  rows = rows.filter(row => row.id !== 'rest');
  assert.equal((await resolve()).id, 'recent');
  rows = [];
  assert.equal(await resolve(), null);
});

test('current teacher challenge considers every published challenge and supports an explicit draft', async () => {
  const draft = { ...structuredClone(fixture), lifecycle: 'draft' };
  const db = {
    challenge: {
      findMany: async query => {
        assert.deepEqual(query.where, { lifecycle: 'published' });
        return [];
      },
      findUnique: async query => query.where.id === draft.id ? draft : null,
    },
    challengeMembership: noMembers,
  };
  assert.equal(await resolveCurrentChallenge(db, { role: 'teacher' }), null);
  assert.equal((await resolveCurrentChallenge(db, { role: 'teacher' }, draft.id)).id, draft.id);
  await assert.rejects(resolveCurrentChallenge(db, { role: 'teacher' }, 'missing'), { status: 404, code: 'CHALLENGE_NOT_FOUND' });
});

test('teacher current challenge prefers one in progress, then the next to start, then the latest ended', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-03-10T03:00:00Z') });
  try {
    const make = (id, startDate, endDate, weeks) => ({ id, lifecycle: 'published', startDate, endDate,
      weeks: weeks.map(([start, end], index) => ({ week: index + 1, startDate: start, endDate: end })) });
    const active = make('active', '2027-03-01', '2027-03-31', [['2027-03-08', '2027-03-14']]);
    const rest = make('rest', '2027-02-01', '2027-04-30', [['2027-02-01', '2027-02-07'], ['2027-04-01', '2027-04-07']]);
    const soon = make('soon', '2027-04-01', '2027-04-07', [['2027-04-01', '2027-04-07']]);
    const later = make('later', '2027-09-01', '2027-09-07', [['2027-09-01', '2027-09-07']]);
    const ended = make('ended', '2026-05-04', '2026-09-04', [['2026-05-04', '2026-05-10']]);
    const older = make('older', '2025-05-04', '2025-09-04', [['2025-05-04', '2025-05-10']]);
    const pick = async rows => (await resolveCurrentChallenge({ challenge: { findMany: async () => rows }, challengeMembership: noMembers }, { role: 'teacher' }))?.id;
    assert.equal(await pick([later, soon, ended, rest, active]), 'active', 'a running week beats a later start date');
    assert.equal(await pick([later, soon, ended, rest]), 'rest', 'a challenge between weeks is still in progress');
    assert.equal(await pick([later, soon, ended]), 'soon', 'then the next challenge to start');
    assert.equal(await pick([older, ended]), 'ended', 'then the most recently ended');
  } finally { t.mock.timers.reset(); }
});

test('an explicit student challenge never bypasses published active membership access', async () => {
  let status = 'pending';
  const challenge = { ...structuredClone(fixture), lifecycle: 'published' };
  const db = {
    challenge: { findUnique: async () => challenge },
    challengeMembership: { ...noMembers, findUnique: async () => ({ status }) },
  };
  await assert.rejects(resolveCurrentChallenge(db, { id: 'student', role: 'student' }, challenge.id), { status: 404, code: 'CHALLENGE_NOT_FOUND' });
  status = 'active';
  assert.equal((await resolveCurrentChallenge(db, { id: 'student', role: 'student' }, challenge.id)).id, challenge.id);
  challenge.lifecycle = 'draft';
  await assert.rejects(resolveCurrentChallenge(db, { id: 'student', role: 'student' }, challenge.id), { status: 404, code: 'CHALLENGE_NOT_FOUND' });
});

test('challenge creation rejects unsupported lifecycle writes and invalid null fields before database writes', async () => {
  await assert.rejects(createChallenge({}, { ...fixture, lifecycle: 'published' }, 'teacher'), { status: 400, code: 'INVALID_CHALLENGE' });
  const input = {
    title: fixture.title, startDate: fixture.startDate, description: null,
    weeks: fixture.weeks.map(({ id, week, ...row }) => row),
  };
  await assert.rejects(createChallenge({}, input, 'teacher'), { status: 400, code: 'INVALID_CHALLENGE' });
});

test('raw PostgreSQL serialization failures retry and exhausted conflicts return 409 instead of 500', async () => {
  const input = {
    title: fixture.title, startDate: fixture.startDate,
    weeks: fixture.weeks.map(({ id, week, ...row }) => row),
  };
  let attempts = 0;
  const serialization = Object.assign(new Error('test serialization failure'), { code: 'P2010', meta: { code: '40001' } });
  const db = { $transaction: async () => {
    attempts += 1;
    if (attempts === 1) throw serialization;
    return { id: 'retried' };
  } };
  assert.deepEqual(await createChallenge(db, input, 'teacher'), { id: 'retried' });
  assert.equal(attempts, 2);
  attempts = 0;
  db.$transaction = async () => { attempts += 1; throw serialization; };
  await assert.rejects(createChallenge(db, input, 'teacher'), { status: 409, code: 'CONFLICT' });
  assert.equal(attempts, 3);
});
