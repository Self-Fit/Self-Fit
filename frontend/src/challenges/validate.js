// Client-side copy of the challenge validation in backend/src/domain/index.js
// (validateWeeks, the contract's "주차 검증 규칙"). Same paths and messages as the server's
// INVALID_CHALLENGE details; the server stays authoritative. Plain ESM so node:test can import it.

export const INPUT_TYPES = ['walking', 'check', 'count', 'distance', 'dumbbell'];
export const DAY_UNIT = '일';
export const DAY_TYPES = ['walking', 'check', 'dumbbell'];
export const EXERCISE_ID = /^[A-Z0-9_]{2,20}$/;
export const COLOR = /^#[0-9A-Fa-f]{6}$/;
export const MAX_WEEKS = 20;
export const MAX_EXERCISES = 5;
export const MAX_DAYS = 365;
export const MESSAGES = {
  overlap: '주차 날짜는 순서대로 배치하고 서로 겹치지 않아야 해요.',
  exerciseId: '종목 ID는 영문 대문자·숫자·밑줄로 2~20자여야 해요.',
};

const DAY = 86_400_000;
export function isDate(value) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false; // no year 0, like the server
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
  const endDate = input.endDate === undefined ? weeks.at(-1)?.endDate : input.endDate;
  const enrollmentDeadline = input.enrollmentDeadline === undefined && isDate(input.startDate) ? addDays(input.startDate, -1) : input.enrollmentDeadline;
  return { startDate: input.startDate, endDate, enrollmentDeadline };
}

/**
 * Returns [] when valid, otherwise [{path, message}] exactly as the server's
 * INVALID_CHALLENGE details (e.g. 'weeks[2].endDate'). A path can appear more than once.
 */
export function validateChallenge(input) {
  const details = [];
  const add = (path, message) => details.push({ path, message });
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const text = (value, path, min, max) => {
    if (typeof value !== 'string' || value.trim().length < min || value.length > max) add(path, `${min}자 이상 ${max}자 이하의 글자를 입력해 주세요.`);
  };
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const integer = value => Number.isSafeInteger(value);
  if (!object(input)) return [{ path: '', message: '챌린지 정보를 입력해 주세요.' }];
  const { title, description = '', startDate, weeks } = input;
  const { endDate, enrollmentDeadline } = effectiveDates(input);
  text(title, 'title', 1, 60);
  text(description, 'description', 0, 500);
  for (const [path, date] of Object.entries({ startDate, endDate, enrollmentDeadline })) if (!isDate(date)) add(path, '유효한 YYYY-MM-DD 날짜를 입력해 주세요.');
  if (isDate(startDate) && isDate(endDate)) {
    if (startDate > endDate) add('endDate', '종료일은 시작일보다 빠를 수 없어요.');
    if (daysBetween(startDate, endDate) + 1 > MAX_DAYS) add('endDate', `챌린지 기간은 최대 ${MAX_DAYS}일이에요.`);
  }
  if (isDate(enrollmentDeadline) && isDate(endDate) && enrollmentDeadline > endDate) add('enrollmentDeadline', '참여 마감일은 챌린지 종료일 이하여야 해요.');
  if (!Array.isArray(weeks) || weeks.length < 1 || weeks.length > MAX_WEEKS) add('weeks', `활동 주차는 1개 이상 ${MAX_WEEKS}개 이하로 설정해 주세요.`);
  const exerciseIds = new Set();
  if (Array.isArray(weeks)) weeks.forEach((week, index) => {
    const path = `weeks[${index}]`;
    if (!object(week)) { add(path, '활동 주차 정보를 입력해 주세요.'); return; }
    text(week.title, `${path}.title`, 1, 60);
    text(week.description === undefined ? '' : week.description, `${path}.description`, 0, 500);
    for (const key of ['startDate', 'endDate']) if (!isDate(week[key])) add(`${path}.${key}`, '유효한 YYYY-MM-DD 날짜를 입력해 주세요.');
    if (isDate(week.startDate) && isDate(week.endDate)) {
      if (week.startDate > week.endDate) add(`${path}.endDate`, '주차 종료일은 시작일보다 빠를 수 없어요.');
      if (isDate(startDate) && week.startDate < startDate) add(`${path}.startDate`, '주차는 챌린지 기간 안에 있어야 해요.');
      if (isDate(endDate) && week.endDate > endDate) add(`${path}.endDate`, '주차는 챌린지 기간 안에 있어야 해요.');
    }
    const previous = weeks[index - 1];
    if (index > 0 && isDate(previous?.endDate) && isDate(week.startDate) && previous.endDate >= week.startDate) add(`${path}.startDate`, MESSAGES.overlap);
    if (!INPUT_TYPES.includes(week.inputType)) add(`${path}.inputType`, '지원하는 운동 기록 형식을 선택해 주세요.');
    if (DAY_TYPES.includes(week.inputType)) {
      if (!integer(week.weeklyTarget) || week.weeklyTarget < 1 || week.weeklyTarget > 7) add(`${path}.weeklyTarget`, '주간 목표는 1일부터 7일까지의 정수여야 해요.');
    } else if (week.inputType === 'count') {
      if (!integer(week.weeklyTarget) || week.weeklyTarget < 1) add(`${path}.weeklyTarget`, '주간 목표 횟수는 1 이상의 정수여야 해요.');
    } else if (week.inputType === 'distance') {
      if (!finite(week.weeklyTarget) || week.weeklyTarget <= 0) add(`${path}.weeklyTarget`, '주간 목표 거리는 0보다 커야 해요.');
    }
    const daily = week.dailyTarget ?? null;
    if ((week.inputType === 'check' || week.inputType === 'dumbbell') && daily !== null && (!finite(daily) || daily <= 0)) add(`${path}.dailyTarget`, '일일 목표는 0보다 큰 숫자 또는 빈 값이어야 해요.');
    if (week.inputType === 'count' && daily !== null && (!integer(daily) || daily < 1)) add(`${path}.dailyTarget`, '일일 목표 횟수는 1 이상의 정수 또는 빈 값이어야 해요.');
    if (week.inputType === 'distance' && daily !== null && (!finite(daily) || daily <= 0)) add(`${path}.dailyTarget`, '일일 목표 거리는 0보다 큰 숫자 또는 빈 값이어야 해요.');
    if (week.inputType === 'walking' || week.inputType === 'check') {
      if (week.unit !== DAY_UNIT) add(`${path}.unit`, '일 단위 운동의 주간 단위는 일이어야 해요.');
    } else if (typeof week.unit !== 'string' || !week.unit.trim()) add(`${path}.unit`, '운동 단위를 입력해 주세요.');
    if (week.dailyUnit !== undefined && week.dailyUnit !== null && typeof week.dailyUnit !== 'string') add(`${path}.dailyUnit`, '일일 단위는 글자 또는 빈 값이어야 해요.');
    if (typeof week.color !== 'string' || !COLOR.test(week.color)) add(`${path}.color`, '색상은 #RRGGBB 형식으로 입력해 주세요.');
    if (week.inputType === 'dumbbell') {
      if (!Array.isArray(week.exercises) || week.exercises.length < 1 || week.exercises.length > MAX_EXERCISES) add(`${path}.exercises`, `덤벨 종목은 1개 이상 ${MAX_EXERCISES}개 이하로 설정해 주세요.`);
      if (Array.isArray(week.exercises)) week.exercises.forEach((exercise, j) => {
        const at = `${path}.exercises[${j}]`;
        if (!object(exercise)) { add(at, '덤벨 종목 정보를 입력해 주세요.'); return; }
        if (typeof exercise.id !== 'string' || !EXERCISE_ID.test(exercise.id)) add(`${at}.id`, MESSAGES.exerciseId);
        else if (exerciseIds.has(exercise.id)) add(`${at}.id`, '종목 ID는 챌린지 안에서 중복될 수 없어요.');
        else exerciseIds.add(exercise.id);
        text(exercise.title, `${at}.title`, 1, 60);
        if (!integer(exercise.repetitions) || exercise.repetitions < 1) add(`${at}.repetitions`, '반복 횟수는 1 이상의 정수여야 해요.');
        if (!integer(exercise.targetSets) || exercise.targetSets < 1) add(`${at}.targetSets`, '목표 세트는 1 이상의 정수여야 해요.');
        if (typeof exercise.sideRule !== 'string') add(`${at}.sideRule`, '종목 수행 설명은 글자로 입력해 주세요.');
      });
    }
  });
  return details;
}

const blank = value => value === null || value === undefined || value === '';
const text = value => typeof value === 'string' ? value.trim() : '';

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
