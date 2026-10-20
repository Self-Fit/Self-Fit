/**
 * Authoritative 2026 Self Fit rules. This module has no persistence, clock
 * override, seed records, or dependency on attachment/correction metadata.
 */
export const DUMBBELL_EXERCISES = Object.freeze([
  { id: 'D12_CURL', title: '덤벨 컬', repetitions: 10, targetSets: 2, sideRule: '좌우 각각 10회 = 1세트' },
  { id: 'D12_SQUAT', title: '덤벨 스쿼트', repetitions: 10, targetSets: 2, sideRule: '전체 10회 = 1세트' },
  { id: 'D12_ROW', title: '덤벨 로우', repetitions: 10, targetSets: 2, sideRule: '좌우 각각 10회 = 1세트' },
].map(Object.freeze));

const definitions = [
  [1, '만보 걷기', '2026-05-04', '2026-05-10', 'walking', 5, 10000, '일', '#E07A2E', '하루 10,000보 이상, 기준을 충족한 5일'],
  [2, '아침 스트레칭', '2026-05-18', '2026-05-24', 'check', 5, 5, '일', '#2E9E6A', '등교 후 5분 스트레칭, 수행 5일'],
  [3, '줄넘기', '2026-05-25', '2026-05-31', 'count', 1000, 200, '회', '#2F7FD8', '하루 200회, 주간 합계 1,000회 이상'],
  [4, '플랭크', '2026-06-01', '2026-06-07', 'check', 5, 1, '일', '#8A5CD6', '1분 이상 유지, 기준을 충족한 5일'],
  [5, '스쿼트', '2026-06-08', '2026-06-14', 'count', 500, null, '회', '#D9486A', '주간 합계 500회 이상'],
  [6, '계단 오르기', '2026-06-15', '2026-06-21', 'check', 5, 20, '일', '#1E9FA8', '하루 20층 이상, 기준을 충족한 5일'],
  [7, '팔굽혀펴기', '2026-06-22', '2026-06-28', 'count', 1000, null, '회', '#C08A12', '주간 합계 1,000회 이상'],
  [8, '러닝·워킹', '2026-06-29', '2026-07-05', 'distance', 10, null, 'km', '#4C6FD1', '주간 합계 10km 이상'],
  [9, '윗몸 일으키기', '2026-07-06', '2026-07-12', 'count', 1000, null, '회', '#C2552B', '주간 합계 1,000회 이상'],
  [10, '버피 테스트', '2026-08-17', '2026-08-23', 'count', 300, 60, '회', '#3C9A3C', '하루 60회, 주간 합계 300회 이상'],
  [11, '홈트 15분', '2026-08-24', '2026-08-30', 'check', 5, 15, '일', '#A2508F', '하루 15분 서킷, 수행 5일'],
  [12, '덤벨 운동', '2026-08-31', '2026-09-04', 'dumbbell', 3, 3, '일', '#5A6372', '하루 컬·스쿼트·로우 각 10회씩 2세트, 세 종목을 모두 충족한 3일 이상'],
];

export const WEEKS = Object.freeze(definitions.map(([
  week, title, startDate, endDate, inputType, weeklyTarget, dailyTarget, unit, color, description,
]) => Object.freeze({
  week, title, startDate, endDate, inputType, weeklyTarget, dailyTarget, unit, color, description,
  dailyUnit: dailyTarget === null ? null : ({ 1: '보', 2: '분', 4: '분', 6: '층', 11: '분', 12: '종목' }[week] ?? unit),
  deferred: false,
  ...(week === 12 ? { exercises: DUMBBELL_EXERCISES } : {}),
})));

const dayMilliseconds = 86_400_000;
const koreaFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

function isDateString(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function resolveWeek(week) {
  const number = typeof week === 'object' && week !== null ? week.week : week;
  return WEEKS.find((candidate) => candidate.week === number) ?? null;
}

function requireWeek(week) {
  const resolved = resolveWeek(week);
  if (!resolved) throw new RangeError('주차는 1부터 12까지여야 합니다.');
  return resolved;
}

function isWeekend(date) {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function present(value) {
  return value !== null && value !== undefined;
}

function isDumbbellShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.keys(value).length === DUMBBELL_EXERCISES.length
    && DUMBBELL_EXERCISES.every(({ id }) => Object.hasOwn(value, id));
}

function hasSubmittedValue(week, value) {
  return present(value) && !(week.inputType === 'dumbbell'
    && isDumbbellShape(value) && DUMBBELL_EXERCISES.every(({ id }) => value[id] === null));
}

/** A date-only value is already a Korean calendar date, not a UTC instant. */
export function koreanDate(instant = new Date()) {
  if (isDateString(instant)) return instant;
  if (typeof instant === 'string' && (!isDateString(instant.slice(0, 10)) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(instant))) {
    throw new RangeError('시각에는 시간대(Z 또는 +09:00)가 필요합니다.');
  }
  if (!(instant instanceof Date) && typeof instant !== 'string' && typeof instant !== 'number') {
    throw new TypeError('유효한 날짜 또는 시각이 필요합니다.');
  }
  const parsed = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(parsed.getTime())) throw new RangeError('유효하지 않은 시각입니다.');
  const parts = Object.fromEntries(koreaFormatter.formatToParts(parsed).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getWeekForDate(date) {
  if (!isDateString(date)) return null;
  return WEEKS.find((week) => week.startDate <= date && date <= week.endDate) ?? null;
}

/** All 82 dates, or only the dates belonging to a specified week. */
export function activityDates(week) {
  const weeks = week === undefined ? WEEKS : [requireWeek(week)];
  return weeks.flatMap(({ startDate, endDate }) => {
    const dates = [];
    for (let timestamp = Date.parse(`${startDate}T00:00:00.000Z`);
      timestamp <= Date.parse(`${endDate}T00:00:00.000Z`); timestamp += dayMilliseconds) {
      dates.push(new Date(timestamp).toISOString().slice(0, 10));
    }
    return dates;
  });
}

/** Date eligibility only. The API must independently check participation/role. */
export function canWriteDate(date, today = new Date()) {
  const week = getWeekForDate(date);
  if (!week || week.deferred) return false;
  try {
    return date === koreanDate(today);
  } catch {
    return false;
  }
}

/** No truthiness coercion: false and 0 are submitted values, null is not. */
export function validateValue(week, value) {
  const resolved = resolveWeek(week);
  const invalid = (code, error) => ({ valid: false, code, error });
  if (!resolved) return invalid('invalid_week', '유효한 활동 주차가 아닙니다.');
  if (resolved.deferred) return invalid('deferred', '덤벨 운동의 세부 규칙은 아직 확정되지 않았습니다.');
  if (!hasSubmittedValue(resolved, value)) return invalid('missing_value', '운동 기록을 입력해 주세요.');
  if (resolved.inputType === 'walking') {
    if (!Number.isInteger(value) || value < 0 || value > 5) {
      return invalid('invalid_band', '걷기 구간은 0부터 5까지의 정수여야 합니다.');
    }
  } else if (resolved.inputType === 'check') {
    if (typeof value !== 'boolean') return invalid('invalid_check', '수행 여부를 선택해 주세요.');
  } else if (resolved.inputType === 'dumbbell') {
    if (!isDumbbellShape(value)) {
      return invalid('invalid_dumbbell', '컬·스쿼트·로우 세 종목의 세트 수를 입력해 주세요.');
    }
    if (DUMBBELL_EXERCISES.some(({ id }) => value[id] !== null
      && (!Number.isSafeInteger(value[id]) || value[id] < 0))) {
      return invalid('invalid_sets', '세트 수는 미입력 또는 정확히 표현할 수 있는 0 이상의 정수여야 합니다.');
    }
  } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return invalid('invalid_number', '0 이상의 유효한 숫자를 입력해 주세요.');
  } else if (resolved.inputType === 'count' && !Number.isSafeInteger(value)) {
    return invalid('invalid_integer', '횟수는 정확히 표현할 수 있는 0 이상의 정수여야 합니다.');
  }
  return { valid: true, code: null, error: null };
}

function valueAchieved(week, value) {
  if (week.inputType === 'walking') return value === 5;
  if (week.inputType === 'check') return value === true;
  if (week.inputType === 'dumbbell') {
    return DUMBBELL_EXERCISES.every(({ id, targetSets }) => value?.[id] >= targetSets);
  }
  return week.dailyTarget === null ? null : value >= week.dailyTarget;
}

export function dailyStatus(week, value, date, today = new Date()) {
  const resolved = resolveWeek(week);
  const dateWeek = getWeekForDate(date);
  if (!resolved || !dateWeek || dateWeek.week !== resolved.week) return 'inactive';
  let todayDate;
  try {
    todayDate = koreanDate(today);
  } catch {
    return 'invalid';
  }
  if (date > todayDate) return 'future';
  if (resolved.deferred) return 'pending';
  if (!hasSubmittedValue(resolved, value)) return 'missing';
  if (!validateValue(resolved, value).valid) return 'invalid';
  // Walking band zero is not an exact zero-step record; false is not missing.
  if (resolved.inputType === 'walking' || resolved.inputType === 'check') {
    return valueAchieved(resolved, value) ? 'achieved' : 'below_target';
  }
  if (resolved.inputType === 'dumbbell') {
    if (DUMBBELL_EXERCISES.every(({ id }) => value[id] === 0)) return 'zero';
    return valueAchieved(resolved, value) ? 'achieved' : 'below_target';
  }
  if (value === 0) return 'zero';
  if (resolved.dailyTarget === null) return 'recorded';
  return valueAchieved(resolved, value) ? 'achieved' : 'below_target';
}

// Add the decimal representations of validated JS numbers with integer math.
// This avoids 0.1 + 0.2 artifacts without choosing an unapproved distance scale.
function decimalSum(values) {
  if (values.length === 0) return 0;
  const terms = values.map((value) => {
    const [mantissa, exponentText = '0'] = String(value).toLowerCase().split('e');
    const fractionDigits = (mantissa.split('.')[1] ?? '').length;
    let coefficient = BigInt(mantissa.replace('.', ''));
    let scale = fractionDigits - Number(exponentText);
    if (scale < 0) {
      coefficient *= 10n ** BigInt(-scale);
      scale = 0;
    }
    return { coefficient, scale };
  });
  const scale = Math.max(...terms.map((term) => term.scale));
  const coefficient = terms.reduce((sum, term) => sum + term.coefficient * 10n ** BigInt(scale - term.scale), 0n);
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  const decimal = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  const total = Number(`${negative ? '-' : ''}${decimal}`);
  if (!Number.isFinite(total)) throw new RangeError('운동량 합계를 정확히 표시할 수 있는 범위를 벗어났습니다.');
  return total;
}

/** Records are the current effective values, not correction-request snapshots. */
function recordsForWeek(week, records) {
  if (!Array.isArray(records)) throw new TypeError('기록은 배열이어야 합니다.');
  const byDate = new Map();
  for (const record of records) {
    if (!record || !isDateString(record.date)) continue;
    if (record.date < week.startDate || record.date > week.endDate) continue;
    // A later value replaces the same day's total; never add both versions.
    byDate.set(record.date, record);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function summarizeWeek(week, records = []) {
  const resolved = requireWeek(week);
  const currentRecords = recordsForWeek(resolved, records).filter((record) => hasSubmittedValue(resolved, record.value));
  const common = {
    week: resolved.week,
    inputType: resolved.inputType,
    unit: resolved.unit,
    weeklyTarget: resolved.weeklyTarget,
    recordedDays: currentRecords.length,
    missingDays: activityDates(resolved).length - currentRecords.length,
  };
  if (resolved.deferred) {
    return {
      ...common, weekdayTotal: null, weekendTotal: null, total: null,
      weekdayAchieved: null, weekendAchieved: null, makeupDays: null,
      creditedDays: null, remaining: null, excess: null,
      complete: null, progress: null, status: 'pending',
    };
  }
  for (const { date, value } of currentRecords) {
    const validation = validateValue(resolved, value);
    if (!validation.valid) throw new TypeError(`${date}: ${validation.error}`);
  }
  const weekdayRecords = currentRecords.filter((record) => !isWeekend(record.date));
  const weekendRecords = currentRecords.filter((record) => isWeekend(record.date));
  const dayBased = ['walking', 'check', 'dumbbell'].includes(resolved.inputType);
  const hasDailyTarget = dayBased || resolved.dailyTarget !== null;
  const achieved = (items) => items.filter(({ value }) => valueAchieved(resolved, value) === true).length;
  const weekdayAchieved = hasDailyTarget ? achieved(weekdayRecords) : null;
  const weekendAchieved = hasDailyTarget ? achieved(weekendRecords) : null;
  const weekdayTotal = dayBased ? weekdayAchieved : decimalSum(weekdayRecords.map(({ value }) => value));
  const weekendTotal = dayBased ? weekendAchieved : decimalSum(weekendRecords.map(({ value }) => value));
  const total = decimalSum([weekdayTotal, weekendTotal]);
  if (resolved.inputType === 'count' && !Number.isSafeInteger(total)) {
    throw new RangeError('주간 횟수 합계가 정확히 표현할 수 있는 정수 범위를 벗어났습니다.');
  }
  const makeupDays = dayBased ? Math.min(weekendAchieved, Math.max(0, resolved.weeklyTarget - weekdayAchieved)) : null;
  const creditedDays = dayBased ? weekdayAchieved + makeupDays : null;
  const remaining = Math.max(0, decimalSum([resolved.weeklyTarget, -total]));
  const excess = Math.max(0, decimalSum([total, -resolved.weeklyTarget]));
  const complete = total >= resolved.weeklyTarget;
  return {
    ...common, weekdayTotal, weekendTotal, total, weekdayAchieved, weekendAchieved,
    makeupDays, creditedDays, remaining, excess, complete,
    progress: Math.min(1, total / resolved.weeklyTarget),
    status: complete ? 'complete' : 'incomplete',
  };
}

export function summarizeProgram(records = []) {
  const weeks = WEEKS.map((week) => summarizeWeek(week, records));
  const completedWeeks = weeks.filter((week) => week.complete === true).length;
  const pendingWeeks = weeks.filter((week) => week.status === 'pending').map((week) => week.week);
  return {
    weeks, completedWeeks, totalWeeks: WEEKS.length, pendingWeeks,
    complete: pendingWeeks.length > 0 ? null : completedWeeks === WEEKS.length,
    progress: completedWeeks / WEEKS.length,
    status: pendingWeeks.length > 0 ? 'pending' : completedWeeks === WEEKS.length ? 'complete' : 'incomplete',
  };
}

/**
 * Pure eligibility decision. The scheduler enforces 20:00 KST and atomically
 * creates one event per student/date. Push permission does not gate in-app events.
 * user: { participating, weekendReminder, reminderDates: ['YYYY-MM-DD'] }
 */
export function reminderDecision(user, records = [], date = koreanDate()) {
  const week = getWeekForDate(date);
  const decision = (send, reason, remaining = null) => ({ send, reason, week: week?.week ?? null, remaining });
  if (user?.participating !== true) return decision(false, 'not_participant');
  if (!week) return decision(false, 'inactive');
  if (week.deferred) return decision(false, 'deferred');
  // Future records cannot satisfy a reminder's historical/as-of-day total.
  const currentRecords = recordsForWeek(week, records).filter((record) => record.date <= date);
  const summary = summarizeWeek(week, currentRecords);
  if (summary.complete) return decision(false, 'week_complete', 0);
  if (isWeekend(date) && user.weekendReminder !== true) return decision(false, 'weekend_disabled', summary.remaining);
  if (Array.isArray(user.reminderDates) && user.reminderDates.includes(date)) {
    return decision(false, 'already_sent', summary.remaining);
  }
  const value = currentRecords.find((record) => record.date === date)?.value;
  if (!hasSubmittedValue(week, value)) return decision(true, 'missing', summary.remaining);
  if (week.dailyTarget === null) return decision(true, 'weekly_target_unmet', summary.remaining);
  if (valueAchieved(week, value)) return decision(false, 'daily_target_met', summary.remaining);
  return decision(true, 'daily_target_unmet', summary.remaining);
}
