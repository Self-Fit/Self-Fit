// Client-side copy of the challenge validation rules in docs/challenges/api-contract.md
// ("주차 검증 규칙"). The server stays authoritative; this only lets the editor show the
// same {path, message} details before a round trip. Plain ESM so node:test can import it.

export const INPUT_TYPES = ['walking', 'check', 'count', 'distance', 'dumbbell'];
export const DAY_UNIT = '일';
export const DAY_TYPES = ['walking', 'check', 'dumbbell'];
export const EXERCISE_ID = /^[A-Z0-9_]{2,20}$/;
export const COLOR = /^#[0-9A-Fa-f]{6}$/;
export const MAX_WEEKS = 20;
export const MAX_EXERCISES = 5;
export const MAX_DAYS = 365;
export const MESSAGES = {
  overlap: '앞 주차와 기간이 겹칩니다.',
  exerciseId: '운동 식별값은 영문 대문자·숫자·밑줄 2~20자여야 합니다.',
};

const DAY = 86_400_000;
export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** README §4.3: move every week by the same number of days so rest gaps stay as they were. */
export function shiftWeeks(weeks, fromStart, toStart) {
  const offset = daysBetween(fromStart, toStart);
  return weeks.map(week => ({ ...week, startDate: addDays(week.startDate, offset), endDate: addDays(week.endDate, offset) }));
}

/** "다음 주차 자동 채우기": the 7 days starting the day after the previous week ends. */
export function suggestWeekDates(previous, challengeStart) {
  const startDate = previous && isDate(previous.endDate) ? addDays(previous.endDate, 1) : isDate(challengeStart) ? challengeStart : '';
  return { startDate, endDate: startDate ? addDays(startDate, 6) : '' };
}

/** Defaults the server applies when a field is omitted (contract: POST /teacher/challenges). */
export function effectiveDates(input) {
  const weeks = Array.isArray(input.weeks) ? input.weeks : [];
  const endDate = input.endDate || weeks.at(-1)?.endDate || '';
  const enrollmentDeadline = input.enrollmentDeadline || (isDate(input.startDate) ? addDays(input.startDate, -1) : '');
  return { startDate: input.startDate || '', endDate, enrollmentDeadline };
}

const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const isInteger = value => Number.isInteger(value);
const blank = value => value === null || value === undefined || value === '';
const text = value => typeof value === 'string' ? value.trim() : '';

function validateWeek(week, index, period, add) {
  const at = field => `weeks[${index}]${field ? `.${field}` : ''}`;
  if (!week || typeof week !== 'object') { add(at(), '주차 정보가 올바르지 않습니다.'); return; }
  const title = text(week.title);
  if (!title) add(at('title'), '주차 이름을 입력해 주세요.');
  else if (title.length > 60) add(at('title'), '주차 이름은 60자 이하여야 합니다.');
  if (typeof week.description === 'string' && week.description.length > 500) add(at('description'), '주차 설명은 500자 이하여야 합니다.');

  const startOk = isDate(week.startDate), endOk = isDate(week.endDate);
  if (!startOk) add(at('startDate'), '시작일을 입력해 주세요.');
  if (!endOk) add(at('endDate'), '종료일을 입력해 주세요.');
  if (startOk && endOk && week.startDate > week.endDate) add(at('endDate'), '종료일은 시작일과 같거나 뒤여야 합니다.');
  if (startOk && isDate(period.startDate) && week.startDate < period.startDate) add(at('startDate'), '챌린지 시작일보다 앞설 수 없습니다.');
  if (endOk && isDate(period.endDate) && week.endDate > period.endDate) add(at('endDate'), '챌린지 종료일보다 늦을 수 없습니다.');

  if (!INPUT_TYPES.includes(week.inputType)) { add(at('inputType'), '운동 유형을 선택해 주세요.'); return; }
  const target = week.weeklyTarget, daily = week.dailyTarget;
  if (DAY_TYPES.includes(week.inputType)) {
    if (!isInteger(target) || target < 1 || target > 7) add(at('weeklyTarget'), '주간 목표는 1~7일이어야 합니다.');
    if (week.unit !== DAY_UNIT) add(at('unit'), `단위는 '${DAY_UNIT}'이어야 합니다.`);
  }
  if (week.inputType === 'check' && !blank(daily) && !isNumber(daily)) add(at('dailyTarget'), '일일 기준값은 숫자여야 합니다.');
  if (week.inputType === 'count') {
    if (!isInteger(target) || target < 1) add(at('weeklyTarget'), '주간 목표는 1 이상의 정수여야 합니다.');
    if (!blank(daily) && (!isInteger(daily) || daily < 1)) add(at('dailyTarget'), '일일 목표는 1 이상의 정수여야 합니다.');
  }
  if (week.inputType === 'distance') {
    if (!isNumber(target) || target <= 0) add(at('weeklyTarget'), '주간 목표는 0보다 커야 합니다.');
    if (!blank(daily) && (!isNumber(daily) || daily <= 0)) add(at('dailyTarget'), '일일 목표는 0보다 커야 합니다.');
  }
  if ((week.inputType === 'count' || week.inputType === 'distance') && !text(week.unit)) add(at('unit'), '단위를 입력해 주세요.');
  if (week.inputType === 'dumbbell') {
    const exercises = Array.isArray(week.exercises) ? week.exercises : [];
    if (exercises.length < 1 || exercises.length > MAX_EXERCISES) add(at('exercises'), `운동은 1~${MAX_EXERCISES}개여야 합니다.`);
    exercises.forEach((exercise, j) => {
      const field = name => at(`exercises[${j}].${name}`);
      if (typeof exercise?.id !== 'string' || !EXERCISE_ID.test(exercise.id)) add(field('id'), MESSAGES.exerciseId);
      if (!text(exercise?.title)) add(field('title'), '운동 이름을 입력해 주세요.');
      if (!isInteger(exercise?.repetitions) || exercise.repetitions < 1) add(field('repetitions'), '반복 횟수는 1 이상의 정수여야 합니다.');
      if (!isInteger(exercise?.targetSets) || exercise.targetSets < 1) add(field('targetSets'), '세트 수는 1 이상의 정수여야 합니다.');
    });
  }
  if (typeof week.color !== 'string' || !COLOR.test(week.color)) add(at('color'), '색은 #RRGGBB 형식이어야 합니다.');
}

/**
 * Returns [] when valid, otherwise [{path, message}] using the same paths as the
 * server's INVALID_CHALLENGE details (e.g. 'weeks[2].endDate').
 */
export function validateChallenge(input = {}) {
  const errors = [];
  const add = (path, message) => { if (!errors.some(error => error.path === path)) errors.push({ path, message }); };
  const title = text(input.title);
  if (!title) add('title', '챌린지 제목을 입력해 주세요.');
  else if (title.length > 60) add('title', '챌린지 제목은 60자 이하여야 합니다.');
  if (typeof input.description === 'string' && input.description.length > 500) add('description', '설명은 500자 이하여야 합니다.');

  const period = effectiveDates(input);
  const startOk = isDate(period.startDate), endOk = isDate(period.endDate);
  if (!startOk) add('startDate', '시작일을 입력해 주세요.');
  if (input.endDate && !endOk) add('endDate', '종료일이 올바르지 않습니다.');
  if (startOk && endOk) {
    if (period.startDate > period.endDate) add('endDate', '종료일은 시작일과 같거나 뒤여야 합니다.');
    else if (daysBetween(period.startDate, period.endDate) + 1 > MAX_DAYS) add('endDate', `챌린지 기간은 최대 ${MAX_DAYS}일입니다.`);
  }
  if (input.enrollmentDeadline && !isDate(input.enrollmentDeadline)) add('enrollmentDeadline', '초대 마감일이 올바르지 않습니다.');
  else if (endOk && isDate(period.enrollmentDeadline) && period.enrollmentDeadline > period.endDate) add('enrollmentDeadline', '초대 마감일은 챌린지 종료일 이전이어야 합니다.');

  const weeks = Array.isArray(input.weeks) ? input.weeks : [];
  if (weeks.length < 1 || weeks.length > MAX_WEEKS) add('weeks', `주차는 1~${MAX_WEEKS}개여야 합니다.`);
  weeks.forEach((week, index) => validateWeek(week, index, period, add));
  weeks.forEach((week, index) => {
    const previous = weeks[index - 1];
    if (previous && isDate(previous.endDate) && isDate(week?.startDate) && week.startDate <= previous.endDate) add(`weeks[${index}].startDate`, MESSAGES.overlap);
  });
  const seen = new Map();
  weeks.forEach((week, index) => (week?.inputType === 'dumbbell' && Array.isArray(week.exercises) ? week.exercises : []).forEach((exercise, j) => {
    if (typeof exercise?.id !== 'string' || !EXERCISE_ID.test(exercise.id)) return;
    if (seen.has(exercise.id)) add(`weeks[${index}].exercises[${j}].id`, '운동 식별값이 챌린지 안에서 중복됩니다.');
    else seen.set(exercise.id, true);
  }));
  return errors;
}

/** Shapes a WeekInput the way the server stores it (contract: walking dailyTarget is ignored, etc.). */
export function normalizeWeek(week) {
  const { id, week: _number, ...rest } = week;
  const result = {
    title: text(rest.title), startDate: rest.startDate, endDate: rest.endDate, inputType: rest.inputType,
    weeklyTarget: rest.weeklyTarget, dailyTarget: blank(rest.dailyTarget) ? null : rest.dailyTarget,
    unit: DAY_TYPES.includes(rest.inputType) ? DAY_UNIT : text(rest.unit), dailyUnit: text(rest.dailyUnit) || null,
    color: typeof rest.color === 'string' ? rest.color.toUpperCase() : rest.color, description: rest.description || '',
  };
  if (rest.inputType === 'walking') result.dailyTarget = null;
  if (rest.inputType === 'dumbbell') result.exercises = (rest.exercises || []).map(exercise => ({ id: exercise.id, title: text(exercise.title), repetitions: exercise.repetitions, targetSets: exercise.targetSets, sideRule: text(exercise.sideRule) }));
  return result;
}
