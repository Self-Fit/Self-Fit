import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParticipation } from '../src/participation.js';
import { WEEKS, activityDates } from '../src/domain/index.js';

const near = (actual, expected) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);
const student = (id, overrides = {}) => ({ id, studentNumber: id, grade: 1, classNumber: 1, targetType: 'required', participating: true, records: [], ...overrides });
const numericRecord = (week, value) => ({ date: activityDates(week)[0], value });
function completedRecords(weeks = WEEKS.filter(week => !week.deferred)) {
  return weeks.flatMap(week => week.inputType === 'dumbbell'
    ? activityDates(week).slice(0, 3).map(date => ({ date, value: { D12_CURL: 2, D12_SQUAT: 2, D12_ROW: 2 } }))
    : week.inputType === 'walking' || week.inputType === 'check'
    ? activityDates(week).slice(0, 5).map(date => ({ date, value: week.inputType === 'walking' ? 5 : true }))
    : [numericRecord(week.week, week.weeklyTarget)]);
}

test('completion counts whole completed weeks, never mean exercise progress or excess exercise', () => {
  const result = buildParticipation([
    student('A', { records: [numericRecord(5, 50_000)] }),
    student('B', { records: [numericRecord(5, 499), numericRecord(8, 9.999)] }),
  ]);
  assert.equal(result.summary.participants, 2);
  assert.equal(result.summary.completedWeeks, 1);
  assert.equal(result.summary.possibleWeeks, 24);
  near(result.summary.completionRate, 100 / 24);
  const squat = result.weeks.find(week => week.week === 5), distance = result.weeks.find(week => week.week === 8);
  assert.equal(squat.completed, 1);
  near(squat.completionRate, 50);
  assert.equal(distance.completed, 0);
  near(distance.completionRate, 0);
});

test('overall and grade rates weight unequal classes by their actual participants', () => {
  const result = buildParticipation([
    student('A', { classNumber: 1, records: completedRecords() }),
    student('B', { classNumber: 2 }), student('C', { classNumber: 2 }), student('D', { classNumber: 2 }),
  ]);
  const first = result.classes.find(group => group.classNumber === 1), second = result.classes.find(group => group.classNumber === 2);
  assert.equal(first.participants, 1); assert.equal(second.participants, 3);
  near(first.completionRate, 100); near(second.completionRate, 0);
  near(result.summary.completionRate, 25);
  near(result.grades[0].completionRate, 25);
  assert.notEqual(result.summary.completionRate, (first.completionRate + second.completionRate) / 2);
  assert.equal(result.summary.completedWeeks, result.classes.reduce((sum, group) => sum + group.completedWeeks, 0));
  assert.equal(result.summary.possibleWeeks, result.classes.reduce((sum, group) => sum + group.possibleWeeks, 0));
});

test('only participating=true students affect counts, grouping and numerators', () => {
  const result = buildParticipation([
    student('A'),
    student('B', { grade: 3, classNumber: 9, targetType: 'optional', participating: false, records: completedRecords() }),
    student('C', { grade: 2, participating: undefined, records: completedRecords() }),
  ]);
  assert.equal(result.summary.participants, 1);
  assert.equal(result.summary.possibleWeeks, 12);
  assert.equal(result.summary.completedWeeks, 0);
  assert.deepEqual(result.grades.map(group => group.grade), [1]);
  assert.equal(result.classes.length, 1);
  assert.equal(result.targets.find(group => group.targetType === 'optional').participants, 0);
  assert.equal(result.targets.find(group => group.targetType === 'optional').completionRate, null);
  assert.ok(result.weeks.every(week => week.participants === 1));
});

test('week 12 now counts in both the completed numerator and unchanged twelve-week denominator', () => {
  const result = buildParticipation([student('A', { records: completedRecords() })]);
  assert.equal(result.summary.totalWeeks, 12);
  assert.equal(result.summary.possibleWeeks, 12);
  assert.equal(result.summary.completedWeeks, 12);
  assert.deepEqual(result.summary.pendingWeeks, []);
  near(result.summary.completionRate, 100);
  assert.ok(result.weeks.every(week => week.completed === 1 && week.completionRate === 100 && week.pending === false));
  for (const groups of [result.grades, result.classes, result.targets.filter(group => group.participants)]) {
    assert.ok(groups.every(group => group.possibleWeeks === group.participants * 12));
  }
  const incomplete = buildParticipation([student('B', { records: completedRecords().filter(record => record.date !== '2026-09-02') })]);
  assert.equal(incomplete.summary.completedWeeks, 11);
  near(incomplete.summary.completionRate, 1100 / 12);
  const dumbbell = incomplete.weeks.find(week => week.week === 12);
  assert.equal(dumbbell.pending, false);
  assert.equal(dumbbell.completed, 0);
  assert.equal(dumbbell.completionRate, 0);
});

test('empty populations report unavailable rates without NaN or Infinity and retain empty target groups', () => {
  const result = buildParticipation([]);
  assert.equal(result.summary.participants, 0);
  assert.equal(result.summary.completedWeeks, 0);
  assert.equal(result.summary.possibleWeeks, 0);
  assert.equal(result.summary.completionRate, null);
  assert.deepEqual(result.grades, []); assert.deepEqual(result.classes, []);
  assert.deepEqual(result.weeks.map(week => week.week), WEEKS.map(week => week.week));
  assert.deepEqual(result.weeks.map(week => week.name), WEEKS.map(week => week.title));
  assert.ok(result.weeks.every(week => week.participants === 0 && week.completed === 0 && week.completionRate === null));
  assert.deepEqual(result.targets.map(group => group.targetType), ['required', 'optional']);
  assert.ok(result.targets.every(group => group.participants === 0 && group.possibleWeeks === 0 && group.completionRate === null));
  const checkFinite = value => { if (typeof value === 'number') assert.ok(Number.isFinite(value)); else if (value && typeof value === 'object') Object.values(value).forEach(checkFinite); };
  checkFinite(result);
});

test('group identities include both grade and class and sort numeric labels numerically', () => {
  const result = buildParticipation([
    student('A', { grade: 2, classNumber: 1, targetType: 'optional', records: completedRecords([WEEKS[4]]) }),
    student('B', { grade: 1, classNumber: 10 }), student('C', { grade: 1, classNumber: 2 }),
    student('D', { grade: 1, classNumber: 1 }),
    student('E', { grade: null, classNumber: null, targetType: 'optional' }),
  ]);
  assert.deepEqual(result.grades.map(group => group.grade), [1, 2, null]);
  assert.deepEqual(result.classes.filter(group => group.grade !== null).map(group => [group.grade, group.classNumber]), [[1, 1], [1, 2], [1, 10], [2, 1]]);
  assert.equal(result.classes.at(-1).grade, null);
  assert.equal(result.classes.find(group => group.grade === 1 && group.classNumber === 1).completedWeeks, 0);
  assert.equal(result.classes.find(group => group.grade === 2 && group.classNumber === 1).completedWeeks, 1);
  assert.match(result.grades.find(group => group.grade === null).label, /미지정/);
  assert.match(result.classes.find(group => group.grade === null && group.classNumber === null).label, /미지정/);
  assert.equal(result.targets.find(group => group.targetType === 'optional').participants, 2);
  assert.equal(result.targets.find(group => group.targetType === 'required').participants, 3);
  assert.equal(result.grades.reduce((sum, group) => sum + group.participants, 0), 5);
  assert.equal(result.classes.reduce((sum, group) => sum + group.participants, 0), 5);
});

test('explicit zero, false and lowest walking band do not count as completed weeks', () => {
  const result = buildParticipation([
    student('A', { records: activityDates(1).map(date => ({ date, value: 0 })) }),
    student('B', { records: activityDates(2).map(date => ({ date, value: false })) }),
    student('C', { records: [numericRecord(5, 0), numericRecord(8, 0)] }),
  ]);
  assert.equal(result.summary.participants, 3);
  assert.equal(result.summary.completedWeeks, 0);
  assert.equal(result.summary.possibleWeeks, 36);
  near(result.summary.completionRate, 0);
});

test('pending correction metadata does not affect completion until the effective record is replaced', () => {
  const record = { ...numericRecord(5, 499), corrections: [{ status: 'pending', requestedValue: 500 }] };
  const before = buildParticipation([student('A', { records: [record] })]);
  const after = buildParticipation([student('A', { records: [{ ...record, value: 500, corrections: [{ status: 'approved', requestedValue: 500 }] }] })]);
  assert.equal(before.summary.completedWeeks, 0);
  assert.equal(after.summary.completedWeeks, 1);
  near(after.summary.completionRate, 100 / 12);
});
