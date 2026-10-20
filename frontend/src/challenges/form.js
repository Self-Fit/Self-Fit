// Editor form state <-> contract bodies. Form rows keep numbers as input strings so a
// half-typed value is never lost; toBody() converts them right before validate/save.
import { DAY_UNIT, addDays, isDate, suggestWeekDates } from './validate.js';
import { formatNumber } from '../student-utils.js';

export const PALETTE = ['#E07A2E', '#2E9E6A', '#2F7FD8', '#8A5CD6', '#D9486A', '#1E9FA8', '#C08A12', '#5A6372'];
export const TYPE_LABELS = { walking: '걸음 수(구간)', check: '수행 체크', count: '횟수', distance: '거리', dumbbell: '덤벨 운동' };
const TYPE_DEFAULTS = {
  walking: { weeklyTarget: '5', dailyTarget: '', unit: DAY_UNIT, dailyUnit: '보' },
  check: { weeklyTarget: '5', dailyTarget: '', unit: DAY_UNIT, dailyUnit: '' },
  count: { weeklyTarget: '', dailyTarget: '', unit: '회', dailyUnit: '' },
  distance: { weeklyTarget: '', dailyTarget: '', unit: 'km', dailyUnit: '' },
  dumbbell: { weeklyTarget: '3', dailyTarget: '', unit: DAY_UNIT, dailyUnit: '종목' },
};

let sequence = 0;
const key = () => `row-${++sequence}`;
const str = value => value === null || value === undefined ? '' : String(value);
const num = value => { const textValue = String(value ?? '').trim(); return textValue === '' ? null : Number(textValue); };

export function blankExercise(row) {
  const taken = new Set((row?.exercises || []).map(exercise => exercise.id));
  let n = (row?.exercises?.length || 0) + 1;
  const prefix = `W${row?.number || 1}_`;
  while (taken.has(`${prefix}${n}`)) n += 1;
  return { key: key(), id: `${prefix}${n}`, title: '', repetitions: '10', targetSets: '2', sideRule: '' };
}

/** A new week row: dates follow the previous row ("다음 주차 자동 채우기"). */
export function blankWeek(previous, challengeStart, index) {
  const row = { key: key(), id: undefined, number: index + 1, title: '', ...suggestWeekDates(previous, challengeStart), inputType: 'walking', ...TYPE_DEFAULTS.walking, color: PALETTE[index % PALETTE.length], description: '', exercises: [] };
  return row;
}

export function changeType(row, inputType) {
  const next = { ...row, inputType, ...TYPE_DEFAULTS[inputType] };
  next.exercises = inputType === 'dumbbell' ? (row.exercises.length ? row.exercises : [blankExercise(row)]) : [];
  return next;
}

export function weekToRow(week) {
  return {
    key: key(), id: week.id, number: week.week, title: week.title || '', startDate: week.startDate || '', endDate: week.endDate || '', inputType: week.inputType,
    weeklyTarget: str(week.weeklyTarget), dailyTarget: str(week.dailyTarget), unit: week.unit || '', dailyUnit: week.dailyUnit || '', color: week.color || PALETTE[0], description: week.description || '',
    exercises: (week.exercises || []).map(exercise => ({ key: key(), id: exercise.id, title: exercise.title, repetitions: str(exercise.repetitions), targetSets: str(exercise.targetSets), sideRule: exercise.sideRule || '' })),
  };
}

/** WeekInput for the API. dailyTarget/dailyUnit/unit follow the input type the way the fixtures store them. */
export function rowToWeek(row) {
  const week = { title: row.title.trim(), startDate: row.startDate, endDate: row.endDate, inputType: row.inputType, weeklyTarget: num(row.weeklyTarget), dailyTarget: num(row.dailyTarget), unit: row.unit.trim(), dailyUnit: row.dailyUnit.trim() || null, color: row.color.trim().toUpperCase(), description: row.description.trim() };
  if (row.inputType === 'walking') Object.assign(week, { dailyTarget: null, unit: DAY_UNIT, dailyUnit: '보' });
  if (row.inputType === 'check') week.unit = DAY_UNIT;
  if (row.inputType === 'count' || row.inputType === 'distance') week.dailyUnit = week.dailyTarget === null ? null : week.unit || null;
  if (row.inputType === 'dumbbell') Object.assign(week, {
    unit: DAY_UNIT, dailyUnit: '종목', dailyTarget: row.exercises.length || null,
    exercises: row.exercises.map(exercise => ({ id: exercise.id.trim(), title: exercise.title.trim(), repetitions: num(exercise.repetitions), targetSets: num(exercise.targetSets), sideRule: exercise.sideRule.trim() })),
  });
  return week;
}

export function challengeToForm(challenge) {
  return {
    title: challenge.title, description: challenge.description || '', startDate: challenge.startDate,
    enrollmentDeadline: challenge.enrollmentDeadline, deadlineAuto: challenge.enrollmentDeadline === addDays(challenge.startDate, -1),
    weeks: challenge.weeks.map(weekToRow),
  };
}
export function emptyForm() {
  return { title: '', description: '', startDate: '', enrollmentDeadline: '', deadlineAuto: true, weeks: [] };
}

/** Full create/update body. endDate is always the last week's end (README §4.3 / contract default). */
export function toBody(form) {
  const weeks = form.weeks.map(rowToWeek);
  const deadline = form.deadlineAuto && isDate(form.startDate) ? addDays(form.startDate, -1) : form.enrollmentDeadline;
  return { title: form.title.trim(), description: form.description.trim(), startDate: form.startDate, endDate: weeks.at(-1)?.endDate || undefined, enrollmentDeadline: deadline || undefined, weeks };
}

export const errorMap = details => Object.fromEntries((details || []).map(detail => [detail.path, detail.message]));

/** One-line goal for a week or a form row (numbers may still be input strings). */
export function goalText(week) {
  const target = Number(week.weeklyTarget), daily = Number(week.dailyTarget);
  if (week.weeklyTarget === '' || week.weeklyTarget === null || !Number.isFinite(target)) return '';
  if (week.inputType === 'walking') return `10,000보 이상 ${formatNumber(target)}일`;
  if (week.inputType === 'check') return `수행 ${formatNumber(target)}일${week.dailyTarget && Number.isFinite(daily) ? ` · 하루 ${formatNumber(daily)}${week.dailyUnit || ''}` : ''}`;
  if (week.inputType === 'dumbbell') return `${week.exercises?.length || 0}종목 · ${formatNumber(target)}일`;
  return `주간 ${formatNumber(target)}${week.unit || ''}${week.dailyTarget && Number.isFinite(daily) ? ` · 하루 ${formatNumber(daily)}${week.unit || ''}` : ''}`;
}
