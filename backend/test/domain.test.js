import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUMBBELL_EXERCISES, WEEKS, activityDates, canWriteDate, dailyStatus, getWeekForDate, koreanDate,
  reminderDecision, summarizeProgram, summarizeWeek, validateValue,
} from '../src/domain/index.js';

const record = (date, value, extra = {}) => ({ date, value, ...extra });
const participant = { participating: true, weekendReminder: true, reminderDates: [] };
const recordsFromValues = (week, values) => values.map((value, index) => record(activityDates(week)[index], value));
const dumbbell = (curl, squat = curl, row = curl) => ({ D12_CURL: curl, D12_SQUAT: squat, D12_ROW: row });

test('the schedule contains exactly 82 distinct activity dates in the agreed 12 weeks', () => {
  const dates = activityDates();
  assert.equal(WEEKS.length, 12);
  assert.equal(dates.length, 82);
  assert.equal(new Set(dates).size, 82);
  assert.equal(dates[0], '2026-05-04');
  assert.equal(dates.at(-1), '2026-09-04');
  for (const week of WEEKS) {
    assert.equal(activityDates(week).length, week.week === 12 ? 5 : 7);
    assert.equal(new Date(`${week.startDate}T00:00:00Z`).getUTCDay(), 1);
    assert.equal(getWeekForDate(week.startDate), week);
    assert.equal(getWeekForDate(week.endDate), week);
  }
});

test('trip, vacation, and final weekend never become activity dates', () => {
  for (const date of ['2026-05-03', '2026-05-11', '2026-05-14', '2026-05-17',
    '2026-07-13', '2026-07-15', '2026-08-10', '2026-08-16', '2026-09-05', '2026-09-06']) {
    assert.equal(getWeekForDate(date), null, date);
    assert.equal(canWriteDate(date, date), false, date);
  }
  // No automatic public-holiday exemption was requested.
  assert.equal(getWeekForDate('2026-05-05').week, 1);
});

test('Korean dates cross midnight at 15:00 UTC regardless of host time zone', () => {
  assert.equal(koreanDate('2026-05-03T14:59:59.999Z'), '2026-05-03');
  assert.equal(koreanDate('2026-05-03T15:00:00.000Z'), '2026-05-04');
  assert.equal(koreanDate(new Date('2026-05-04T23:59:59+09:00')), '2026-05-04');
  assert.equal(koreanDate(Date.parse('2026-05-04T15:00:00Z')), '2026-05-05');
  assert.equal(koreanDate('2026-05-04'), '2026-05-04');
});

test('invalid dates and timezone-less timestamps are rejected, not normalized', () => {
  for (const date of ['2026-02-30', '2026-06-31', '2026-6-01', '', null, 20260504]) {
    assert.equal(getWeekForDate(date), null);
  }
  assert.throws(() => koreanDate('2026-05-04T12:00:00'), RangeError);
  assert.throws(() => koreanDate('2026-02-30T12:00:00Z'), RangeError);
  assert.throws(() => koreanDate(new Date('invalid')), RangeError);
  assert.throws(() => koreanDate(null), TypeError);
});

test('direct writes only allow the current Korean activity date and need no prior completion', () => {
  assert.equal(canWriteDate('2026-05-04', '2026-05-03T14:59:59.999Z'), false);
  assert.equal(canWriteDate('2026-05-04', '2026-05-03T15:00:00.000Z'), true);
  assert.equal(canWriteDate('2026-05-04', '2026-05-04T15:00:00.000Z'), false);
  assert.equal(canWriteDate('2026-05-18', '2026-05-18'), true);
  assert.equal(canWriteDate('2026-05-04', '2026-10-20'), false);
  assert.equal(canWriteDate('2026-05-05', '2026-05-04'), false);
  assert.equal(canWriteDate('2026-08-31', '2026-08-31'), true);
  assert.equal(canWriteDate('2026-09-04', '2026-09-03T15:00:00Z'), true);
  assert.equal(canWriteDate('2026-06-08', 'invalid'), false);
});

test('weekly metadata retains the existing colors and separates daily from weekly units', () => {
  assert.equal(WEEKS[0].color, '#E07A2E');
  assert.equal(WEEKS[4].color, '#D9486A');
  assert.equal(WEEKS[11].color, '#5A6372');
  assert.equal(WEEKS[0].unit, '일');
  assert.equal(WEEKS[0].dailyTarget, 10000);
  assert.equal(WEEKS[0].dailyUnit, '보');
  assert.equal(WEEKS[5].dailyTarget, 20);
  assert.equal(WEEKS[5].dailyUnit, '층');
  for (const weekNumber of [5, 7, 8, 9]) {
    assert.equal(WEEKS[weekNumber - 1].dailyTarget, null);
  }
  assert.throws(() => { WEEKS[0].weeklyTarget = 1; }, TypeError);
});

test('walking accepts exactly six numeric bands without accepting an exact step count', () => {
  for (let band = 0; band <= 5; band++) assert.equal(validateValue(1, band).valid, true);
  for (const invalid of [-1, 6, 10000, 2.5, '5', true, NaN]) {
    assert.equal(validateValue(1, invalid).valid, false);
  }
});

test('checks require booleans, retaining false as a real submitted value', () => {
  for (const week of [2, 4, 6, 11]) {
    assert.equal(validateValue(week, true).valid, true);
    assert.equal(validateValue(week, false).valid, true);
    for (const invalid of [0, 1, '', 'false', null, undefined]) {
      assert.equal(validateValue(week, invalid).valid, false);
    }
  }
});

test('count values require nonnegative safe integers and preserve target overshoot', () => {
  for (const week of [3, 5, 7, 9, 10]) {
    for (const value of [0, 1, 10000]) assert.equal(validateValue(week, value).valid, true);
    for (const invalid of [-1, 0.1, Infinity, NaN, '200', true, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(validateValue(week, invalid).valid, false);
    }
  }
});

test('distances permit finite nonnegative decimals without imposing an unapproved scale', () => {
  for (const value of [0, 0.1, 0.1234567, 12.8]) assert.equal(validateValue(8, value).valid, true);
  for (const value of [-0.1, Infinity, -Infinity, NaN, '1.5', false]) {
    assert.equal(validateValue(8, value).valid, false);
  }
  assert.equal(validateValue(8, null).code, 'missing_value');
  assert.equal(validateValue(0, 1).code, 'invalid_week');
});

test('the lowest walking band is a submitted below-target record, never zero or missing', () => {
  assert.equal(dailyStatus(1, 0, '2026-05-04', '2026-05-04'), 'below_target');
  assert.equal(dailyStatus(1, null, '2026-05-04', '2026-05-04'), 'missing');
  assert.equal(dailyStatus(1, 5, '2026-05-04', '2026-05-04'), 'achieved');
  const summary = summarizeWeek(1, [record('2026-05-04', 0)]);
  assert.equal(summary.recordedDays, 1);
  assert.equal(summary.total, 0); // achieved days, not exact steps
  assert.equal(summary.unit, '일');
});

test('explicit check failure and numeric zero are distinct from no submission', () => {
  assert.equal(dailyStatus(4, false, '2026-06-01', '2026-06-01'), 'below_target');
  assert.equal(dailyStatus(4, undefined, '2026-06-01', '2026-06-01'), 'missing');
  assert.equal(dailyStatus(5, 0, '2026-06-08', '2026-06-08'), 'zero');
  assert.equal(dailyStatus(8, 0, '2026-06-29', '2026-06-29'), 'zero');
  assert.equal(summarizeWeek(4, [record('2026-06-01', false)]).recordedDays, 1);
  assert.equal(summarizeWeek(5, [record('2026-06-08', 0)]).recordedDays, 1);
  assert.equal(summarizeWeek(5, [record('2026-06-08', null)]).recordedDays, 0);
});

test('future, inactive, invalid, and missing days have separate display states', () => {
  assert.equal(dailyStatus(5, null, '2026-06-09', '2026-06-08'), 'future');
  assert.equal(dailyStatus(5, null, '2026-05-11', '2026-06-08'), 'inactive');
  assert.equal(dailyStatus(4, true, '2026-06-08', '2026-06-08'), 'inactive');
  assert.equal(dailyStatus(5, -1, '2026-06-08', '2026-06-08'), 'invalid');
  assert.equal(dailyStatus(12, null, '2026-08-31', '2026-09-04'), 'missing');
});

test('weekly-only numeric missions do not invent a daily pass or fail threshold', () => {
  for (const week of [5, 7, 8, 9]) {
    assert.equal(dailyStatus(week, 1, WEEKS[week - 1].startDate, '2026-10-20'), 'recorded');
    const summary = summarizeWeek(week, [record(WEEKS[week - 1].startDate, 1)]);
    assert.equal(summary.weekdayAchieved, null);
    assert.equal(summary.makeupDays, null);
  }
});

test('squats 350 weekday plus 150 weekend complete 500 with separate totals', () => {
  const summary = summarizeWeek(5, [record('2026-06-08', 350), record('2026-06-13', 150)]);
  assert.equal(summary.weekdayTotal, 350);
  assert.equal(summary.weekendTotal, 150);
  assert.equal(summary.total, 500);
  assert.equal(summary.complete, true);
  assert.equal(summary.progress, 1);
});

test('rope 150 Friday plus 50 Saturday contributes 200 without rewriting daily failure', () => {
  const records = [record('2026-05-25', 800), record('2026-05-29', 150), record('2026-05-30', 50)];
  const summary = summarizeWeek(3, records);
  assert.equal(summary.total, 1000);
  assert.equal(summary.complete, true);
  assert.equal(summary.weekdayTotal, 950);
  assert.equal(summary.weekendTotal, 50);
  assert.equal(dailyStatus(3, 150, '2026-05-29', '2026-05-31'), 'below_target');
  assert.equal(dailyStatus(3, 50, '2026-05-30', '2026-05-31'), 'below_target');
});

test('three stretching weekdays plus both weekend dates complete five days', () => {
  const records = recordsFromValues(2, [true, true, true, false, null, true, true]);
  const summary = summarizeWeek(2, records);
  assert.equal(summary.weekdayAchieved, 3);
  assert.equal(summary.weekendAchieved, 2);
  assert.equal(summary.makeupDays, 2);
  assert.equal(summary.creditedDays, 5);
  assert.equal(summary.complete, true);
  assert.equal(records[3].value, false);
  assert.equal(records[4].value, null);
});

test('two stretching weekdays plus both weekend dates cannot manufacture a fifth day', () => {
  const summary = summarizeWeek(2, recordsFromValues(2, [true, true, null, null, null, true, true]));
  assert.equal(summary.total, 4);
  assert.equal(summary.makeupDays, 2);
  assert.equal(summary.complete, false);
  assert.equal(summary.progress, 0.8);
});

test('extra completed weekend days remain in raw totals but are not unnecessary makeup', () => {
  const summary = summarizeWeek(2, recordsFromValues(2, [true, true, true, true, true, true, true]));
  assert.equal(summary.weekdayTotal, 5);
  assert.equal(summary.weekendTotal, 2);
  assert.equal(summary.total, 7);
  assert.equal(summary.makeupDays, 0);
  assert.equal(summary.creditedDays, 5);
  assert.equal(summary.progress, 1);
  assert.equal(summary.excess, 2);
  const fourWeekdays = summarizeWeek(2, recordsFromValues(2, [true, true, true, true, null, true, true]));
  assert.equal(fourWeekdays.makeupDays, 1);
});

test('walking cannot combine below-target bands across days into a completed day', () => {
  const summary = summarizeWeek(1, recordsFromValues(1, [5, 5, 5, 4, 4, 4, 4]));
  assert.equal(summary.weekdayAchieved, 3);
  assert.equal(summary.weekendAchieved, 0);
  assert.equal(summary.total, 3);
  assert.equal(summary.complete, false);
});

test('same-day changes replace the prior total instead of adding both totals', () => {
  const summary = summarizeWeek(5, [record('2026-06-08', 100), record('2026-06-08', 130)]);
  assert.equal(summary.total, 130);
  assert.equal(summary.recordedDays, 1);
  const checks = summarizeWeek(2, [record('2026-05-23', true), record('2026-05-23', true)]);
  assert.equal(checks.weekendAchieved, 1);
});

test('distance summation preserves decimal totals and target boundary without binary artifacts', () => {
  const small = summarizeWeek(8, recordsFromValues(8, [0.1, 0.2]));
  assert.equal(small.total, 0.3);
  assert.equal(small.remaining, 9.7);
  const boundary = summarizeWeek(8, recordsFromValues(8, [3.3, 3.3, 3.3, 0.1]));
  assert.equal(boundary.total, 10);
  assert.equal(boundary.complete, true);
  const scientific = summarizeWeek(8, recordsFromValues(8, [1e-7, 2e-7]));
  assert.equal(scientific.total, 3e-7);
});

test('subtarget and excess distances stay exact enough for remaining/excess displays', () => {
  const remaining = summarizeWeek(8, recordsFromValues(8, [9.9]));
  assert.equal(remaining.complete, false);
  assert.equal(remaining.remaining, 0.1);
  const over = summarizeWeek(8, recordsFromValues(8, [9.9, 0.2]));
  assert.equal(over.total, 10.1);
  assert.equal(over.excess, 0.1);
  assert.equal(over.progress, 1);
});

test('numeric weekly targets can be reached in one day without minimum activity-day count', () => {
  for (const week of [3, 5, 7, 8, 9, 10]) {
    const definition = WEEKS[week - 1];
    assert.equal(summarizeWeek(week, [record(definition.startDate, definition.weeklyTarget)]).complete, true);
  }
});

test('no attachments and failed uploads cannot cancel saved exercise completion', () => {
  const plain = record('2026-06-08', 500);
  const uploadFailure = { ...plain, attachments: [{ status: 'failed' }] };
  assert.deepEqual(summarizeWeek(5, [plain]), summarizeWeek(5, [uploadFailure]));
  assert.equal(summarizeWeek(5, [uploadFailure]).complete, true);
});

test('pending corrections do not count requested values; approved effective values recalculate', () => {
  const pending = record('2026-06-08', 450, { correction: { status: 'pending', proposedValue: 500 } });
  assert.equal(summarizeWeek(5, [pending]).complete, false);
  const approved = { ...pending, value: 500, correction: { status: 'approved', oldValue: 450 } };
  assert.equal(summarizeWeek(5, [approved]).complete, true);
  assert.equal(summarizeProgram([pending]).completedWeeks, 0);
  assert.equal(summarizeProgram([approved]).completedWeeks, 1);
});

test('out-of-week records are ignored while invalid present values fail visibly', () => {
  assert.equal(summarizeWeek(5, [record('2026-06-01', 500), record('2026-06-08', 100)]).total, 100);
  assert.throws(() => summarizeWeek(5, [record('2026-06-08', -1)]), TypeError);
  assert.throws(() => summarizeWeek(5, [record('2026-06-08', Number.MAX_SAFE_INTEGER), record('2026-06-09', 1)]), RangeError);
});

test('dumbbell metadata fixes all three daily exercises and three qualifying days', () => {
  const week = WEEKS[11];
  assert.equal(week.deferred, false);
  assert.equal(week.inputType, 'dumbbell');
  assert.equal(week.unit, '일');
  assert.equal(week.weeklyTarget, 3);
  assert.equal(week.dailyTarget, 3);
  assert.equal(week.dailyUnit, '종목');
  assert.equal(week.exercises, DUMBBELL_EXERCISES);
  assert.deepEqual(DUMBBELL_EXERCISES.map(({ id }) => id), ['D12_CURL', 'D12_SQUAT', 'D12_ROW']);
  assert.ok(DUMBBELL_EXERCISES.every(({ repetitions, targetSets }) => repetitions === 10 && targetSets === 2));
  assert.equal(DUMBBELL_EXERCISES[0].sideRule, '좌우 각각 10회 = 1세트');
  assert.equal(DUMBBELL_EXERCISES[1].sideRule, '전체 10회 = 1세트');
  assert.throws(() => { DUMBBELL_EXERCISES[0].targetSets = 1; }, TypeError);
  assert.throws(() => DUMBBELL_EXERCISES.push({}), TypeError);
});

test('dumbbell values preserve partial blanks, explicit zero and overshoot with exactly three keys', () => {
  for (const value of [dumbbell(0), dumbbell(null, 0, null), dumbbell(2, null, 3), dumbbell(3), dumbbell(Number.MAX_SAFE_INTEGER)]) {
    const before = structuredClone(value);
    assert.equal(validateValue(12, value).valid, true);
    assert.deepEqual(value, before);
  }
  for (const value of [null, undefined, dumbbell(null)]) assert.equal(validateValue(12, value).code, 'missing_value');
  for (const value of [0, false, [], {}, { D12_CURL: 2, D12_SQUAT: 2 }, { ...dumbbell(2), extra: 1 }, { press: 1 }, new Date()]) {
    assert.equal(validateValue(12, value).code, 'invalid_dumbbell');
  }
  for (const value of [-1, 1.5, '2', true, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateValue(12, { ...dumbbell(2), D12_SQUAT: value }).code, 'invalid_sets');
  }
});

test('dumbbell missing, all-zero, partially submitted and achieved days remain distinct', () => {
  const status = value => dailyStatus(12, value, '2026-08-31', '2026-09-04');
  assert.equal(status(null), 'missing');
  assert.equal(status(dumbbell(null)), 'missing');
  assert.equal(status(dumbbell(0)), 'zero');
  assert.equal(status(dumbbell(null, 0, null)), 'below_target');
  assert.equal(status(dumbbell(2, 2, null)), 'below_target');
  assert.equal(status(dumbbell(3, 3, 1)), 'below_target');
  assert.equal(status(dumbbell(2)), 'achieved');
  assert.equal(status(dumbbell(3)), 'achieved');
  assert.equal(status({ ...dumbbell(2), invalid: 0 }), 'invalid');
  assert.equal(dailyStatus(12, dumbbell(2), '2026-09-01', '2026-08-31'), 'future');
  const summary = summarizeWeek(12, recordsFromValues(12, [dumbbell(null), dumbbell(0), dumbbell(2, null, null)]));
  assert.equal(summary.recordedDays, 2);
  assert.equal(summary.missingDays, 3);
  assert.equal(summary.total, 0);
});

test('dumbbell completion requires all three exercises on each of three separate days', () => {
  const records = recordsFromValues(12, [dumbbell(3), dumbbell(2), dumbbell(2, 2, 1), dumbbell(0), dumbbell(null)]);
  const before = summarizeWeek(12, records);
  assert.equal(before.total, 2);
  assert.equal(before.weekdayTotal, 2);
  assert.equal(before.weekendTotal, 0);
  assert.equal(before.weekdayAchieved, 2);
  assert.equal(before.weekendAchieved, 0);
  assert.equal(before.complete, false);
  assert.equal(before.remaining, 1);
  assert.equal(before.progress, 2 / 3);
  const after = summarizeWeek(12, [...records, record('2026-09-02', dumbbell(2))]);
  assert.equal(after.recordedDays, 4);
  assert.equal(after.total, 3);
  assert.equal(after.complete, true);
  assert.equal(after.progress, 1);
  assert.equal(after.makeupDays, 0);
  assert.equal(after.creditedDays, 3);
});

test('excess dumbbell sets never compensate another exercise or a different day', () => {
  const high = Number.MAX_SAFE_INTEGER;
  const separated = recordsFromValues(12, [dumbbell(high, null, null), dumbbell(null, high, null), dumbbell(null, null, high)]);
  assert.equal(summarizeWeek(12, separated).total, 0);
  const oneDay = summarizeWeek(12, recordsFromValues(12, [dumbbell(high)]));
  assert.equal(oneDay.total, 1);
  assert.equal(oneDay.remaining, 2);
  const full = summarizeWeek(12, [...recordsFromValues(12, Array(5).fill(dumbbell(high))), record('2026-09-05', dumbbell(high))]);
  assert.equal(full.total, 5);
  assert.equal(full.excess, 2);
  assert.equal(full.recordedDays, 5);
  assert.equal(full.complete, true);
  assert.equal(full.progress, 1);
  assert.throws(() => summarizeWeek(12, [record('2026-08-31', dumbbell(2, -1, 2))]), TypeError);
});

test('eleven completed weeks remain 11/12 until dumbbell reaches three qualifying days', () => {
  const records = WEEKS.filter((week) => week.week < 12).flatMap((week) => {
    const values = Array(5).fill(week.inputType === 'walking' ? 5 : week.inputType === 'check' ? true : week.weeklyTarget / 5);
    return recordsFromValues(week, values);
  });
  const summary = summarizeProgram(records);
  assert.equal(summary.completedWeeks, 11);
  assert.equal(summary.totalWeeks, 12);
  assert.equal(summary.progress, 11 / 12);
  assert.equal(summary.complete, false);
  assert.equal(summary.status, 'incomplete');
  assert.deepEqual(summary.pendingWeeks, []);
  assert.equal('totalExercise' in summary, false);
  const full = summarizeProgram([...records, ...recordsFromValues(12, Array(3).fill(dumbbell(2)))]);
  assert.equal(full.completedWeeks, 12);
  assert.equal(full.progress, 1);
  assert.equal(full.complete, true);
  assert.equal(full.status, 'complete');
});

test('reminders require an actual participant and an active settled date', () => {
  assert.equal(reminderDecision({ participating: false }, [], '2026-06-08').reason, 'not_participant');
  assert.equal(reminderDecision({ targetType: 'required' }, [], '2026-06-08').send, false);
  for (const date of ['2026-05-11', '2026-07-13', '2026-08-16', '2026-09-05', '2026-10-20']) {
    assert.equal(reminderDecision(participant, [], date).send, false);
  }
  assert.equal(reminderDecision(participant, [], '2026-08-31').reason, 'missing');
});

test('dumbbell reminders use current-day three-exercise attainment and stop after three complete days', () => {
  assert.equal(reminderDecision(participant, recordsFromValues(12, [dumbbell(null)]), '2026-08-31').reason, 'missing');
  assert.equal(reminderDecision(participant, recordsFromValues(12, [dumbbell(0)]), '2026-08-31').reason, 'daily_target_unmet');
  assert.equal(reminderDecision(participant, recordsFromValues(12, [dumbbell(2, null, 3)]), '2026-08-31').reason, 'daily_target_unmet');
  const records = recordsFromValues(12, [dumbbell(3), dumbbell(2), dumbbell(2)]);
  const firstDay = reminderDecision(participant, records, '2026-08-31');
  assert.equal(firstDay.reason, 'daily_target_met');
  assert.equal(firstDay.send, false);
  assert.equal(firstDay.remaining, 2);
  assert.equal(reminderDecision(participant, records, '2026-09-03').reason, 'week_complete');
  assert.equal(reminderDecision(participant, records, '2026-09-05').reason, 'inactive');
});

test('weekly completion takes priority over missing today or daily goal failure', () => {
  const records = [record('2026-05-25', 1000)];
  assert.equal(reminderDecision(participant, records, '2026-05-26').reason, 'week_complete');
  assert.equal(reminderDecision(participant, [...records, record('2026-05-26', 150)], '2026-05-26').send, false);
});

test('weekly-only targets remind about remaining weekly quantity even after todays submission', () => {
  const decision = reminderDecision(participant, [record('2026-06-08', 100)], '2026-06-08');
  assert.equal(decision.send, true);
  assert.equal(decision.reason, 'weekly_target_unmet');
  assert.equal(decision.remaining, 400);
});

test('missing and explicit shortfall both qualify once, while daily attainment does not', () => {
  assert.equal(reminderDecision(participant, [], '2026-06-01').reason, 'missing');
  assert.equal(reminderDecision(participant, [record('2026-06-01', false)], '2026-06-01').reason, 'daily_target_unmet');
  assert.equal(reminderDecision(participant, [record('2026-05-25', 150)], '2026-05-25').reason, 'daily_target_unmet');
  assert.equal(reminderDecision(participant, [record('2026-05-25', 200)], '2026-05-25').send, false);
  assert.equal(reminderDecision(participant, [record('2026-05-04', 0)], '2026-05-04').reason, 'daily_target_unmet');
});

test('weekend reminders default off and respect the opt-in setting', () => {
  assert.equal(reminderDecision({ participating: true }, [], '2026-05-23').reason, 'weekend_disabled');
  assert.equal(reminderDecision(participant, [], '2026-05-23').send, true);
});

test('a completed Saturday cannot be asked for a second makeup day on the same date', () => {
  const records = recordsFromValues(2, [true, true, true, false, false, true]);
  const decision = reminderDecision(participant, records, '2026-05-23');
  assert.equal(decision.send, false);
  assert.equal(decision.reason, 'daily_target_met');
  assert.equal(decision.remaining, 1);
  assert.equal(reminderDecision(participant, records, '2026-05-24').send, true);
});

test('already-sent daily reminders suppress duplicates independently of A/B condition', () => {
  const user = { ...participant, reminderDates: ['2026-06-08'] };
  assert.equal(reminderDecision(user, [], '2026-06-08').reason, 'already_sent');
  assert.equal(reminderDecision(user, [record('2026-06-08', 100)], '2026-06-08').send, false);
});

test('push permission and attachment failures do not govern in-app reminder eligibility', () => {
  const user = { ...participant, pushEnabled: false };
  const records = [record('2026-06-08', 100, { attachments: [{ status: 'failed' }] })];
  assert.equal(reminderDecision(user, records, '2026-06-08').send, true);
  const complete = [record('2026-06-08', 500, { attachments: [{ status: 'failed' }] })];
  assert.equal(reminderDecision(user, complete, '2026-06-08').send, false);
});

test('a future record does not suppress a reminder before that activity occurs', () => {
  assert.equal(reminderDecision(participant, [record('2026-06-12', 500)], '2026-06-08').reason, 'missing');
});
