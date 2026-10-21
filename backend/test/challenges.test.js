import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEGACY_WEEKS, activityDates, canWriteDate, challengePhase, dailyStatus,
  getWeekForDate, reminderDecision, shiftWeeks, summarizeProgram, summarizeWeek,
  validateValue, validateWeeks,
} from '../src/domain/index.js';

const fixture = JSON.parse(readFileSync(new URL('../../docs/challenges/fixtures/challenge-detail.json', import.meta.url), 'utf8')).challenge;
const input = () => structuredClone(fixture);
const invalidAt = (challenge, path) => {
  const result = validateWeeks(challenge);
  assert.equal(result.valid, false, `expected invalid ${path}`);
  assert.ok(result.details.some(detail => detail.path === path), `${path}: ${JSON.stringify(result.details)}`);
  assert.ok(result.details.every(detail => Object.keys(detail).sort().join() === 'message,path' && typeof detail.message === 'string'));
};

test('the shared challenge fixture validates, retains exact activity dates, and validation never mutates defaults', () => {
  const challenge = input();
  assert.deepEqual(validateWeeks(challenge), { valid: true, details: [] });
  assert.deepEqual(activityDates(challenge.weeks), fixture.activityDates);
  delete challenge.endDate;
  delete challenge.enrollmentDeadline;
  delete challenge.description;
  challenge.weeks[0].dailyTarget = 'ignored by walking rules';
  const before = structuredClone(challenge);
  assert.deepEqual(validateWeeks(challenge), { valid: true, details: [] });
  assert.deepEqual(challenge, before);
  assert.equal(validateWeeks({ ...fixture, title: '가'.repeat(60), description: '나'.repeat(500) }).valid, true);
});

test('challenge title, description, dates and deadline reject malformed, missing and out-of-range values', () => {
  for (const value of [undefined, null, [], 'challenge']) assert.equal(validateWeeks(value).valid, false);
  for (const [key, values] of Object.entries({
    title: ['', ' ', 'a'.repeat(61), null, 123],
    description: ['a'.repeat(501), null, 123],
    startDate: ['2027-02-29', '2027-3-02', '', null, 20270302, '2027-03-02T00:00:00Z'],
    endDate: ['2027-02-29', '2027-03-01', null],
    enrollmentDeadline: ['2027-03-21', '2027-02-30', null, '0000-12-31'],
  })) for (const value of values) invalidAt({ ...input(), [key]: value }, key);
  assert.equal(validateWeeks({ ...input(), enrollmentDeadline: '2027-03-20' }).valid, true);
  assert.equal(validateWeeks({ ...input(), enrollmentDeadline: '2020-01-01' }).valid, true);
});

test('challenge periods count both endpoints and enforce a maximum of 365 days across leap years', () => {
  const challenge = { ...input(), startDate: '2027-01-01', endDate: '2027-12-31' };
  assert.equal(validateWeeks(challenge).valid, true);
  invalidAt({ ...challenge, endDate: '2028-01-01' }, 'endDate');
  const leap = { ...input(), startDate: '2028-01-01', endDate: '2028-12-30', enrollmentDeadline: '2027-12-31', weeks: shiftWeeks(fixture.weeks, fixture.startDate, '2028-03-02') };
  assert.equal(validateWeeks(leap).valid, true);
  invalidAt({ ...leap, endDate: '2028-12-31' }, 'endDate');
});

test('one through twenty ordered weeks are accepted and empty, oversized or malformed lists fail', () => {
  for (const weeks of [undefined, null, {}, [], Array(21).fill(fixture.weeks[0])]) invalidAt({ ...input(), weeks }, 'weeks');
  invalidAt({ ...input(), weeks: [null] }, 'weeks[0]');
  const weeks = Array.from({ length: 20 }, (_, index) => {
    const day = `2027-03-${String(index + 1).padStart(2, '0')}`;
    return { ...fixture.weeks[0], week: index + 1, startDate: day, endDate: day };
  });
  assert.equal(validateWeeks({ ...input(), startDate: '2027-03-01', weeks }).valid, true);
  assert.equal(validateWeeks({ ...input(), weeks: [fixture.weeks[0]] }).valid, true);
});

test('weeks must have valid dates inside their challenge, without overlaps or reversed order; rest gaps are allowed', () => {
  const changes = [
    [0, 'startDate', '2027-02-28'], [2, 'endDate', '2027-03-21'],
    [0, 'endDate', '2027-03-01'], [0, 'startDate', '2027-02-30'],
    [1, 'startDate', '2027-03-08'], [1, 'endDate', 'bad'],
  ];
  for (const [index, key, value] of changes) {
    const challenge = input(); challenge.weeks[index][key] = value;
    invalidAt(challenge, `weeks[${index}].${key}`);
  }
  const reordered = input(); [reordered.weeks[0], reordered.weeks[1]] = [reordered.weeks[1], reordered.weeks[0]];
  invalidAt(reordered, 'weeks[1].startDate');
  const gap = input(); gap.weeks[1].startDate = '2027-03-11';
  assert.equal(validateWeeks(gap).valid, true);
});

test('each week validates title, description, input type, RGB color and units', () => {
  for (const [key, values] of Object.entries({
    title: ['', ' ', 'x'.repeat(61), false], description: ['x'.repeat(501), 1],
    inputType: ['swimming', null, ''], color: ['red', '#abc', '#GG0000', '#12345678', '123456', null],
    unit: ['', '보', null], dailyUnit: [123, false],
  })) for (const value of values) {
    const challenge = input(); challenge.weeks[0][key] = value;
    invalidAt(challenge, `weeks[0].${key}`);
  }
  const valid = input(); valid.weeks[0].color = '#abC123'; valid.weeks[0].dailyUnit = null;
  assert.equal(validateWeeks(valid).valid, true);
  for (const unit of ['', ' ', null]) {
    const challenge = input(); challenge.weeks[1].unit = unit;
    invalidAt(challenge, 'weeks[1].unit');
  }
});

test('walking, check and dumbbell targets count whole days from one through seven', () => {
  for (const inputType of ['walking', 'check', 'dumbbell']) {
    for (const value of [0, 8, 1.5, '3', null, Infinity, NaN]) {
      const challenge = input(); Object.assign(challenge.weeks[2], { inputType, weeklyTarget: value });
      invalidAt(challenge, 'weeks[2].weeklyTarget');
    }
    for (const value of [1, 7]) {
      const challenge = input(); Object.assign(challenge.weeks[2], { inputType, weeklyTarget: value });
      assert.equal(validateWeeks(challenge).valid, true);
    }
  }
  for (const dailyTarget of [null, 0.5, 2.5]) {
    const challenge = input(); Object.assign(challenge.weeks[0], { inputType: 'check', dailyTarget });
    assert.equal(validateWeeks(challenge).valid, true);
  }
  // Students read the daily target ("오늘 5분 플랭크 했나요?"), so it is positive or empty.
  for (const dailyTarget of [NaN, Infinity, '2', false, 0, -1.5]) {
    const challenge = input(); Object.assign(challenge.weeks[0], { inputType: 'check', dailyTarget });
    invalidAt(challenge, 'weeks[0].dailyTarget');
  }
});

test('count targets require integers and distance targets require finite positive numbers', () => {
  for (const weeklyTarget of [0, -1, 1.5, Infinity, '10', Number.MAX_SAFE_INTEGER + 1]) {
    const challenge = input(); challenge.weeks[1].weeklyTarget = weeklyTarget;
    invalidAt(challenge, 'weeks[1].weeklyTarget');
  }
  for (const dailyTarget of [0.5, Infinity, '10', Number.MAX_SAFE_INTEGER + 1, 0, -1]) {
    const challenge = input(); challenge.weeks[1].dailyTarget = dailyTarget;
    invalidAt(challenge, 'weeks[1].dailyTarget');
  }
  for (const dailyTarget of [null, 1]) {
    const challenge = input(); challenge.weeks[1].dailyTarget = dailyTarget;
    assert.equal(validateWeeks(challenge).valid, true);
  }
  for (const key of ['weeklyTarget', 'dailyTarget']) for (const value of [0, -1, NaN, Infinity, '1']) {
    const challenge = input(); Object.assign(challenge.weeks[1], { inputType: 'distance', weeklyTarget: 1.5, dailyTarget: 0.25, unit: 'km', [key]: value });
    invalidAt(challenge, `weeks[1].${key}`);
  }
  const challenge = input(); Object.assign(challenge.weeks[1], { inputType: 'distance', weeklyTarget: 0.1, dailyTarget: null, unit: 'km' });
  assert.equal(validateWeeks(challenge).valid, true);
});

test('dumbbell exercises enforce one to five unique challenge-wide IDs and positive repetition/set integers', () => {
  const exercise = fixture.weeks[2].exercises[0];
  for (const exercises of [undefined, null, [], Array(6).fill(exercise)]) {
    const challenge = input(); challenge.weeks[2].exercises = exercises;
    invalidAt(challenge, 'weeks[2].exercises');
  }
  for (const id of ['', 'A', 'aA', 'A-B', 'A'.repeat(21), 12]) {
    const challenge = input(); challenge.weeks[2].exercises[0].id = id;
    invalidAt(challenge, 'weeks[2].exercises[0].id');
  }
  for (const key of ['repetitions', 'targetSets']) for (const value of [0, -1, 1.5, '2', null, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const challenge = input(); challenge.weeks[2].exercises[0][key] = value;
    invalidAt(challenge, `weeks[2].exercises[0].${key}`);
  }
  const duplicate = input(); duplicate.weeks[2].exercises[1].id = 'CURL';
  invalidAt(duplicate, 'weeks[2].exercises[1].id');
  const across = input(); Object.assign(across.weeks[0], { inputType: 'dumbbell', exercises: [structuredClone(exercise)] });
  invalidAt(across, 'weeks[2].exercises[0].id');
  const five = input(); five.weeks[2].exercises = Array.from({ length: 5 }, (_, index) => ({ ...exercise, id: `E_${index}` }));
  assert.equal(validateWeeks(five).valid, true);
  five.weeks[2].exercises = [{ ...exercise, id: 'A'.repeat(20) }];
  assert.equal(validateWeeks(five).valid, true);
});

test('phase respects lifecycle, Korean midnight, inclusive boundaries, rest gaps and ends', () => {
  const challenge = { ...input(), lifecycle: 'published' }; challenge.weeks[1].startDate = '2027-03-11';
  for (const [date, expected] of [
    ['2027-03-01', 'upcoming'], ['2027-03-02', 'active'], ['2027-03-08', 'active'],
    ['2027-03-09', 'rest'], ['2027-03-10', 'rest'], ['2027-03-11', 'active'],
    ['2027-03-20', 'active'], ['2027-03-21', 'ended'],
    ['2027-03-01T14:59:59.999Z', 'upcoming'], ['2027-03-01T15:00:00Z', 'active'],
  ]) assert.equal(challengePhase(challenge, date), expected);
  for (const lifecycle of ['draft', 'archived']) for (const date of ['2020-01-01', '2030-01-01']) {
    assert.equal(challengePhase({ ...challenge, lifecycle }, date), lifecycle);
  }
  assert.throws(() => challengePhase({ ...challenge, lifecycle: 'invalid' }, '2027-03-02'), RangeError);
  assert.throws(() => challengePhase(challenge, '2027-02-30'), RangeError);
});

test('shiftWeeks keeps every original gap across year/leap boundaries and permits endDate recalculation without aliasing', () => {
  const before = structuredClone(LEGACY_WEEKS);
  const shifted = shiftWeeks(LEGACY_WEEKS, '2026-05-04', '2028-02-27');
  const diff = date => Date.parse(`${date}T00:00:00Z`);
  assert.equal(shifted[0].startDate, '2028-02-27');
  assert.equal(shifted[0].endDate, '2028-03-04');
  for (let index = 0; index < shifted.length; index++) {
    assert.equal(diff(shifted[index].startDate) - diff(shifted[0].startDate), diff(LEGACY_WEEKS[index].startDate) - diff(LEGACY_WEEKS[0].startDate));
    assert.equal(diff(shifted[index].endDate) - diff(shifted[index].startDate), diff(LEGACY_WEEKS[index].endDate) - diff(LEGACY_WEEKS[index].startDate));
  }
  assert.equal(activityDates(shifted).at(-1), shifted.at(-1).endDate);
  assert.equal(activityDates(shifted).length, 82);
  assert.equal(validateWeeks({ title: '복사', startDate: '2028-02-27', weeks: shifted }).valid, true);
  shifted[11].exercises[0].title = 'changed copy';
  assert.deepEqual(LEGACY_WEEKS, before);
  assert.throws(() => shiftWeeks(LEGACY_WEEKS, 'bad', '2027-01-01'), RangeError);
  assert.throws(() => shiftWeeks(LEGACY_WEEKS, '2026-05-04', '9999-12-31'), RangeError);
});

test('all domain lookups and progress use the supplied challenge with no numeric legacy fallback', () => {
  const weeks = fixture.weeks;
  assert.equal(getWeekForDate(weeks, '2027-03-02'), weeks[0]);
  assert.equal(getWeekForDate(weeks, LEGACY_WEEKS[0].startDate), null);
  assert.equal(canWriteDate(weeks, '2027-03-02', '2027-03-02'), true);
  assert.equal(canWriteDate(weeks, LEGACY_WEEKS[0].startDate, LEGACY_WEEKS[0].startDate), false);
  assert.equal(activityDates(weeks, 3).length, 5);
  assert.equal(activityDates(weeks, weeks[0]).length, 7);
  assert.throws(() => activityDates(weeks, 12), RangeError);
  assert.throws(() => summarizeWeek(1, []), TypeError);
  assert.equal(validateValue(1, 5).code, 'invalid_week');
  assert.equal(dailyStatus(1, 5, LEGACY_WEEKS[0].startDate, '2030-01-01'), 'inactive');
  const summary = summarizeProgram(weeks, [{ date: '2027-03-09', value: 1000 }]);
  assert.equal(summary.totalWeeks, 3);
  assert.equal(summary.completedWeeks, 1);
  assert.equal(summary.progress, 1 / 3);
  assert.equal(summarizeProgram([], []).progress, 0);
  assert.equal(reminderDecision(weeks, { participating: true }, [], '2027-03-02').reason, 'missing');
});

test('custom dumbbell IDs and targets drive validation, summaries, statuses and reminders independently of legacy constants', () => {
  const week = { ...fixture.weeks[2], dailyTarget: 2, exercises: [
    { id: 'PRESS', title: '프레스', repetitions: 5, targetSets: 1, sideRule: '' },
    { id: 'LUNGE', title: '런지', repetitions: 12, targetSets: 4, sideRule: '' },
  ] };
  const value = { PRESS: 1, LUNGE: 4 };
  assert.equal(validateValue(week, value).valid, true);
  assert.equal(validateValue(week, { PRESS: 0, LUNGE: null }).valid, true);
  assert.equal(validateValue(week, { PRESS: null, LUNGE: null }).code, 'missing_value');
  assert.equal(validateValue(week, { ...value, D12_CURL: 2 }).code, 'invalid_dumbbell');
  assert.equal(validateValue(week, { PRESS: 1 }).code, 'invalid_dumbbell');
  assert.equal(dailyStatus(week, value, week.startDate, week.endDate), 'achieved');
  assert.equal(dailyStatus(week, { PRESS: 20, LUNGE: 3 }, week.startDate, week.endDate), 'below_target');
  const records = activityDates([week]).slice(0, 3).map(date => ({ date, value }));
  assert.equal(summarizeWeek(week, records).complete, true);
  assert.equal(reminderDecision([week], { participating: true }, records, records[0].date).reason, 'daily_target_met');
  assert.equal(reminderDecision([week], { participating: true }, records, records[2].date).reason, 'week_complete');
  for (const exercises of [undefined, [], [{ ...week.exercises[0], targetSets: 0 }]]) {
    const invalid = { ...week, exercises };
    assert.equal(validateValue(invalid, value).valid, false);
    assert.equal(validateValue(invalid, null).valid, false);
    assert.equal(dailyStatus(invalid, null, week.startDate, week.endDate), 'invalid');
    assert.throws(() => summarizeWeek(invalid, []), TypeError);
  }
});


test('day-based reminders use actual exercise attainment when the optional daily target is null', () => {
  const participant = { participating: true, weekendReminder: true };
  const walking = fixture.weeks[0];
  assert.equal(walking.dailyTarget, null);
  assert.equal(reminderDecision([walking], participant, [{ date: walking.startDate, value: 5 }], walking.startDate).reason, 'daily_target_met');
  assert.equal(reminderDecision([walking], participant, [{ date: walking.startDate, value: 0 }], walking.startDate).reason, 'daily_target_unmet');
  const dumbbell = { ...fixture.weeks[2], dailyTarget: null };
  const value = Object.fromEntries(dumbbell.exercises.map(exercise => [exercise.id, exercise.targetSets]));
  assert.equal(reminderDecision([dumbbell], participant, [{ date: dumbbell.startDate, value }], dumbbell.startDate).reason, 'daily_target_met');
});

test('invalid boundary defaults and nullable descriptions yield validation details instead of throwing', () => {
  const challenge = input(); delete challenge.enrollmentDeadline; challenge.startDate = '0000-01-01';
  invalidAt(challenge, 'enrollmentDeadline');
  challenge.weeks[0].description = null;
  invalidAt(challenge, 'weeks[0].description');
});
