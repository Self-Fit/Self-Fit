import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { acceptOnlyInvitation, listMembers, membershipDto, membershipSelf, previewMembers, selectStudents } from '../src/memberships.js';
import { koreanDate } from '../src/domain/index.js';

const fixture = JSON.parse(await readFile(new URL('../../docs/challenges/fixtures/members.json', import.meta.url), 'utf8'));
const addedFixture = JSON.parse(await readFile(new URL('../../docs/challenges/fixtures/members-add-response.json', import.meta.url), 'utf8'));
const selfFixture = { mode: 'invited', status: 'pending', invitedAt: '2026-10-20T01:00:00Z', respondedAt: null };
const keys = value => Object.keys(value).sort();

test('membership DTOs match fixtures, scope participating, support a null inviter and never expose account secrets', () => {
  for (const expected of [...fixture.members, ...addedFixture.added]) {
    const input = {
      ...structuredClone(expected), userId: expected.user.id, invitedById: expected.invitedBy?.id,
      user: { ...expected.user, participating: true, passwordHash: 'private-test-field', weekendReminder: true },
    };
    const actual = membershipDto(input);
    assert.deepEqual(actual, expected);
    assert.deepEqual(keys(actual), keys(fixture.members[0]));
    assert.deepEqual(keys(membershipSelf(input)), keys(selfFixture));
    assert.ok(!Object.hasOwn(actual.user, 'passwordHash'));
  }
  assert.equal(membershipSelf(null), null);
});

test('student selection rejects ambiguous, malformed, unsupported and oversized selectors before any database read', async () => {
  const invalid = [
    null, [], {}, { studentIds: [], filters: {} }, { studentIds: [] },
    { studentIds: null }, { studentIds: [''] }, { studentIds: ['  '] }, { studentIds: [1] },
    { studentIds: [{ id: 'student' }] }, { studentIds: ['student'], participating: true },
    { filters: null }, { filters: [] }, { filters: { grade: true } }, { filters: { grade: '' } },
    { filters: { grade: 0 } }, { filters: { classNumber: 1.5 } }, { filters: { targetType: '' } },
    { filters: { targetType: 'everyone' } }, { filters: { search: 'any' } }, { filters: { participating: true } },
    { studentIds: ['a'.repeat(100_000)] },
  ];
  for (const selection of invalid) await assert.rejects(selectStudents({}, selection), { status: 400, code: 'INVALID_SELECTION' });
});

test('explicit selectors preserve missing and teacher candidates, deduplicate IDs, and never trust supplied user fields', async () => {
  let query;
  const student = { id: 's', role: 'student', studentNumber: '10101', name: '테스트 학생' };
  const teacher = { id: 't', role: 'teacher', studentNumber: 'teacher', name: '테스트 교사' };
  const db = { user: { findMany: async input => { query = input; return [teacher, student]; } } };
  const selected = await selectStudents(db, { studentIds: ['s', 't', 'missing', 's'] });
  assert.deepEqual(query.where, { id: { in: ['s', 't', 'missing'] } });
  assert.deepEqual(selected, [student, teacher, { id: 'missing', role: null, studentNumber: null, name: null }]);
});

test('filter selection is restricted to students and accepts an explicit empty filter for the whole roster', async () => {
  const reads = [];
  const db = { user: { findMany: async input => { reads.push(input); return []; } } };
  await selectStudents(db, { filters: {} });
  await selectStudents(db, { filters: { grade: '2', classNumber: 3, targetType: 'required' } });
  assert.deepEqual(reads.map(query => query.where), [{ role: 'student' }, { role: 'student', grade: 2, classNumber: 3, targetType: 'required' }]);
});

test('preview is read-only, excludes invalid candidates and reports challenge-specific membership without global user mutation', async () => {
  const student = { ...fixture.members[0].user, participating: true };
  const before = structuredClone(student);
  const db = {
    challenge: { findUnique: async () => ({ id: 'challenge' }) },
    user: { findMany: async () => [student, { id: 'teacher', role: 'teacher' }] },
    challengeMembership: { findMany: async () => [{ ...selfFixture, userId: student.id }] },
  };
  const result = await previewMembers(db, 'challenge', { studentIds: [student.id, 'teacher', 'missing'] });
  assert.equal(result.students.length, 1);
  assert.equal(result.students[0].participating, false);
  assert.deepEqual(result.students[0].membership, selfFixture);
  assert.deepEqual(student, before);
});

test('member listing filters rows but cohort statistics retain all statuses and exclude removed modes', async () => {
  let listQuery, statsQuery;
  const db = {
    challenge: { findUnique: async () => ({ id: 'challenge' }) },
    challengeMembership: {
      findMany: async query => { listQuery = query; return []; },
      groupBy: async query => {
        statsQuery = query;
        return [
          { status: 'active', mode: 'forced', _count: { _all: 2 } },
          { status: 'pending', mode: 'invited', _count: { _all: 3 } },
          { status: 'declined', mode: 'invited', _count: { _all: 1 } },
          { status: 'removed', mode: 'forced', _count: { _all: 5 } },
        ];
      },
    },
  };
  const result = await listMembers(db, 'challenge', { status: 'removed', mode: 'forced', grade: '2', search: '테스트' });
  assert.deepEqual(listQuery.where.status, { in: ['removed'] });
  assert.equal(listQuery.where.mode, 'forced');
  assert.deepEqual(statsQuery.where, { challengeId: 'challenge', user: {
    role: 'student', grade: 2, OR: [{ name: { contains: '테스트', mode: 'insensitive' } }, { studentNumber: { contains: '테스트', mode: 'insensitive' } }],
  } });
  assert.deepEqual(result.stats, { active: 2, pending: 3, declined: 1, removed: 5, forced: 2, invited: 4 });
  assert.deepEqual(keys(result), keys(fixture));
});

test('compatibility enrollment distinguishes no eligible invitation from multiple invitations without choosing one', async () => {
  let rows = [];
  const tx = { challengeMembership: { findMany: async query => {
    assert.deepEqual(query.where, { userId: 'student', mode: 'invited', status: 'pending', challenge: { lifecycle: 'published', enrollmentDeadline: { gte: koreanDate() } } });
    return rows;
  } } };
  const db = { $transaction: operation => operation(tx) };
  await assert.rejects(acceptOnlyInvitation(db, 'student'), { status: 403, code: 'ENROLLMENT_CLOSED' });
  rows = [{ challengeId: 'challenge-a' }, { challengeId: 'challenge-b' }];
  await assert.rejects(acceptOnlyInvitation(db, 'student'), error => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'INVITATION_SELECTION_REQUIRED');
    assert.deepEqual(error.details, { challengeIds: ['challenge-a', 'challenge-b'] });
    return true;
  });
});
