import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fitnessComparison, fitnessGradeLabel } from '../src/fitness-grades.js';
import { buildMemberSelection, createSelectionPreview, matchesMemberFilters, validFitnessSelection } from '../src/challenges/member-selection.js';

const fixture = name => readFile(new URL(`../../docs/challenges/fixtures/${name}.json`, import.meta.url), 'utf8').then(JSON.parse);
const user = { fitnessGrade: 3, fitnessGradeYear: 2026, fitnessGradeSemester: 2 };

test('current fitness grade uses the account; previous grade is the preceding semester, not another import', async () => {
  const data = await fixture('fitness-history');
  const extra = [{ year: 2025, semester: 2, grade: 5, score: 20 }, { year: 2027, semester: 1, grade: 1, score: 90 }];
  const comparison = fitnessComparison(user, [...extra, ...data.fitnessHistory].reverse());
  assert.deepEqual(comparison.current, { year: 2026, semester: 2, grade: 3 });
  assert.deepEqual(comparison.previous, { year: 2026, semester: 1, grade: 4, score: 38 });
  assert.equal(fitnessComparison({ ...user, fitnessGrade: 2 }, data.fitnessHistory).current.grade, 2);
  assert.equal(fitnessComparison(user, data.fitnessHistory.slice(0, 1)).previous, null);
});

test('missing current second-semester grade stays missing while first-semester history remains visible', () => {
  const history = [{ year: 2026, semester: 1, grade: 4, score: null }, { year: 2025, semester: 2, grade: 5, score: 20 }];
  assert.deepEqual(fitnessComparison({ fitnessGrade: null, fitnessGradeYear: null, fitnessGradeSemester: null }, history), { current: null, previous: history[0] });
  assert.deepEqual(fitnessComparison({}, []), { current: null, previous: null });
  assert.equal(fitnessGradeLabel(null), '미등록');
  assert.equal(fitnessGradeLabel(0), '미등록');
  assert.equal(fitnessGradeLabel(5), '5등급');
});

test('bulk selection matches the contract, deduplicates grades, and omits empty grade restrictions', async () => {
  const expected = await fixture('fitness-members-request');
  assert.deepEqual(buildMemberSelection('filters', { grade: '', classNumber: '', fitnessGrades: [5, 4, 5] }, []), { filters: expected.filters });
  assert.deepEqual(buildMemberSelection('filters', { grade: '2', classNumber: '3', fitnessGrades: [] }, []), { filters: { grade: 2, classNumber: 3 } });
  assert.deepEqual(buildMemberSelection('filters', { grade: '', classNumber: '', fitnessGrades: [] }, []), { filters: {} });
  assert.deepEqual(buildMemberSelection('ids', { fitnessGrades: [4, 5] }, ['one', 'two', 'one']), { studentIds: ['one', 'two'] });
});

test('fitness grades form a union intersected with school year/class; missing grades are excluded only by a grade restriction', () => {
  const students = [
    { id: 'four', grade: 2, classNumber: 1, fitnessGrade: 4 },
    { id: 'five', grade: 2, classNumber: 1, fitnessGrade: 5 },
    { id: 'three', grade: 2, classNumber: 1, fitnessGrade: 3 },
    { id: 'other-year', grade: 1, classNumber: 1, fitnessGrade: 4 },
    { id: 'other-class', grade: 2, classNumber: 2, fitnessGrade: 4 },
    { id: 'missing', grade: 2, classNumber: 1, fitnessGrade: null },
  ];
  const ids = filters => students.filter(student => matchesMemberFilters(student, filters)).map(student => student.id);
  assert.deepEqual(ids({ grade: 2, classNumber: 1, fitnessGrades: [4, 5] }), ['four', 'five']);
  assert.deepEqual(ids({ fitnessGrade: '4', grade: '2' }), ['four', 'other-class']);
  assert.deepEqual(ids({ fitnessGrade: 'unmeasured' }), ['missing']);
  assert.equal(ids({}).length, students.length);
});

test('mock fitness selectors enforce the contract integer array boundaries', () => {
  for (const fitnessGrades of [[], null, '4,5', [0], [6], [4.5], ['4'], [null]]) assert.equal(validFitnessSelection({ fitnessGrades }), false);
  assert.equal(validFitnessSelection({}), true);
  assert.equal(validFitnessSelection({ fitnessGrades: [1, 2, 3, 4, 5, 4] }), true);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('a slower preview cannot replace the newer selection, even after selecting A again', async () => {
  const requests = createSelectionPreview();
  const old = deferred(), middle = deferred(), recent = deferred();
  const first = requests.load('A', () => old.promise);
  requests.invalidate();
  const second = requests.load('B', () => middle.promise);
  requests.invalidate();
  const third = requests.load('A', () => recent.promise);
  recent.resolve({ students: ['new A'] });
  assert.deepEqual(await third, { key: 'A', data: { students: ['new A'] } });
  middle.resolve({ students: ['B'] }); old.resolve({ students: ['old A'] });
  assert.equal(await second, null);
  assert.equal(await first, null);
});

test('changing selection or closing the dialog invalidates pending successes and errors', async () => {
  const requests = createSelectionPreview();
  const pending = deferred();
  const first = requests.load('all', () => pending.promise);
  requests.invalidate();
  pending.reject(new Error('stale error'));
  assert.equal(await first, null);
  const error = new Error('current request failed');
  assert.deepEqual(await requests.load('grade4', () => Promise.reject(error)), { key: 'grade4', error });
  assert.deepEqual(await requests.load('grade4', () => Promise.resolve({ students: [] })), { key: 'grade4', data: { students: [] } });
});
