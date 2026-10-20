import { isDeepStrictEqual } from 'node:util';
import { LEGACY_WEEKS, LEGACY_DUMBBELL_EXERCISES, activityDates, getWeekForDate, validateValue, summarizeProgram } from '../src/domain/index.js';

export const REVISED_PARTICIPATION_TRANSFORM = 'twelve-week-participation-revision-v1';
const headers = {
  달성률요약: ['대상', '참여 학생 수', '완료 주수 합계', '가능 주수', '달성률', '전체 완료분 비중'],
  학생별현황: ['학번', '이름', '학년', '반', '대상 구분', '1학기 점수(실제)', '1학기 등급(실제)', '2학기 점수(실제)', '2학기 등급(실제)', '점수 변화(실제)', ...LEGACY_WEEKS.map(w => `${w.week}주차`), '완료 주수(자동)', '전체 주수', '달성률(자동)', '비고', '참여 여부'],
  날짜별기록: ['학번', '활동일', '요일', '주차', '운동', '날짜 구분', '입력 형식', '입력값', '단위', '기록 상태(자동)', '비고', '최초등록일시(선택)', '최종수정일시(선택)', '기록 여부(자동)', '주간 합산값(자동)'],
  덤벨운동기록: ['학번', '활동일', '운동 식별값', '완료 세트', '운동명', '목표 세트(자동)', '기록 여부(자동)', '목표 충족(자동)', '자료 종류', '비고'],
  운영기준: ['주차', '시작일', '종료일', '운동', '입력 형식', '주간 완료 기준값', '단위', '완료 조건', null, '덤벨 기준', '값'],
};
const inputLabels = { walking: '걸음 구간', check: '수행 여부', count: '횟수', distance: '거리', dumbbell: '운동별 완료 세트' };
const bands = ['0~1,999보', '2,000~3,999보', '4,000~5,999보', '6,000~7,999보', '8,000~9,999보', '10,000보 이상'];
const errors = new Set(['#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#N/A', '#NUM!', '#NULL!', '#SPILL!', '#CALC!']);
const empty = value => value === null || value === undefined || value === '';
const integer = value => Number.isSafeInteger(value) && value >= 0;
const check = (condition, message) => { if (!condition) throw new Error(`수정 참여 자료: ${message}`); };
const close = (actual, expected) => expected === null ? empty(actual) : typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-12;
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const rowsAfter = (source, sheet, start = 5) => source.sheets[sheet].slice(start).map((values, index) => ({ row: start + index + 1, values })).filter(item => Array.isArray(item.values) && item.values.some(value => !empty(value)));

function dateOnly(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T00:00:00)?$/.test(value), '활동일 형식 오류');
  const date = value.slice(0, 10), parsed = new Date(`${date}T00:00:00Z`);
  check(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date, '존재하지 않는 활동일');
  return date;
}

function validateSource(source) {
  check(source && /^[a-f0-9]{64}$/.test(source.sha256 ?? '') && typeof source.filename === 'string' && source.filename, '원본 파일명과 SHA-256이 필요합니다.');
  for (const [sheet, header] of Object.entries(headers)) {
    const rows = source.sheets?.[sheet];
    check(Array.isArray(rows), `${sheet} 시트 누락`);
    check(isDeepStrictEqual(rows[4]?.slice(0, header.length), header) && rows[4].slice(header.length).every(empty), `${sheet} 헤더 불일치`);
    check(Array.isArray(source.formulaCells?.[sheet]), `${sheet} 수식 원본 누락`);
    const seen = new Set();
    for (const cell of source.formulaCells[sheet]) {
      const address = /^([A-Z]+)([1-9]\d*)$/.exec(cell.cell ?? '');
      check(address && typeof cell.formula === 'string' && cell.formula.startsWith('=') && Object.hasOwn(cell, 'cached'), `${sheet} 수식 원본 형식 오류`);
      check(!seen.has(cell.cell), `${sheet} 수식 주소 중복`); seen.add(cell.cell);
      const column = [...address[1]].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      const row = rows[Number(address[2]) - 1];
      check(Array.isArray(row) && column < row.length && isDeepStrictEqual(cell.cached, row[column]), `${sheet} 수식 캐시와 셀 값 불일치`);
    }
    check(rows.every(row => Array.isArray(row) && row.every(value => !errors.has(value))), `${sheet} 수식 오류 캐시`);
  }
  const rules = source.sheets.운영기준;
  for (const week of LEGACY_WEEKS) {
    const row = rules[week.week + 4];
    check(row && !week.deferred && row[0] === week.week && dateOnly(row[1]) === week.startDate && dateOnly(row[2]) === week.endDate
      && isDeepStrictEqual(row.slice(3, 8), [week.title, inputLabels[week.inputType], week.weeklyTarget, week.unit, week.description]), `${week.week}주차 운영 기준 불일치`);
  }
  check(isDeepStrictEqual(rules[5]?.slice(9, 11), ['세트당 반복 수', 10]) && isDeepStrictEqual(rules[6]?.slice(9, 11), ['운동별 목표 세트', 2])
    && isDeepStrictEqual(rules[7]?.slice(9, 11), ['하루 필수 운동 수', 3]), '덤벨 운영 기준 불일치');
}

/** Pure conversion of the revised workbook. Blank dates are omissions, never zero records. */
export function buildRevisedParticipationData(source) {
  validateSource(source);
  const students = [], byStudent = new Map();
  for (const { row: sourceRow, values: row } of rowsAfter(source, '학생별현황')) {
    const studentNumber = String(row[0]);
    check(/^\d{5}$/.test(studentNumber) && !byStudent.has(studentNumber), `학생별현황 ${sourceRow}행 학번 오류 또는 중복`);
    check(typeof row[1] === 'string' && row[1].trim() && integer(row[2]) && row[2] > 0 && integer(row[3]) && row[3] > 0, `학생별현황 ${sourceRow}행 정체 정보 오류`);
    check(['필수', '선택'].includes(row[4]) && row[26] === '참여', `학생별현황 ${sourceRow}행 대상·참여 여부 오류`);
    check([row[5], row[7]].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
      && [row[6], row[8]].every(value => integer(value) && value >= 1 && value <= 5)
      && close(row[9], row[7] - row[5]), `학생별현황 ${sourceRow}행 체력 원값 오류`);
    const student = { studentNumber, name: row[1], grade: row[2], classNumber: row[3], targetType: row[4] === '필수' ? 'required' : 'optional', participating: true,
      sourceRow, rosterRow: row, fitness: { semester1: { score: row[5], grade: row[6] }, semester2: { score: row[7], grade: row[8] }, scoreChange: row[9], sourceRow }, dailyRows: [], exerciseRows: [] };
    students.push(student); byStudent.set(studentNumber, student);
  }
  check(students.length > 0, '학생 명단이 비어 있습니다.');
  const dates = activityDates(LEGACY_WEEKS), dumbbellDates = activityDates(LEGACY_WEEKS, 12), exercises = new Map();
  const sourceExerciseRows = rowsAfter(source, '덤벨운동기록');
  for (const item of sourceExerciseRows) {
    const row = item.values, student = byStudent.get(String(row[0])), date = dateOnly(row[1]), exercise = LEGACY_DUMBBELL_EXERCISES.find(item => item.id === row[2]);
    check(student && dumbbellDates.includes(date) && exercise, `덤벨운동기록 ${item.row}행 학생·날짜·종목 오류`);
    const key = `${student.studentNumber}:${date}:${exercise.id}`;
    check(!exercises.has(key), `덤벨운동기록 ${item.row}행 학생·날짜·종목 중복`);
    check(row[3] === null || integer(row[3]), `덤벨운동기록 ${item.row}행 세트 수 오류`);
    check(row[4] === exercise.title && row[5] === exercise.targetSets && row[8] === '가상', `덤벨운동기록 ${item.row}행 기준·자료 종류 오류`);
    check(row[6] === Number(row[3] !== null) && row[7] === Number(row[3] !== null && row[3] >= exercise.targetSets), `덤벨운동기록 ${item.row}행 계산 캐시 불일치`);
    exercises.set(key, item); student.exerciseRows.push(item);
  }
  check(exercises.size === students.length * dumbbellDates.length * LEGACY_DUMBBELL_EXERCISES.length, '덤벨 운동별 원본 행 누락');
  const records = [], byStudentRecords = new Map(students.map(student => [student.studentNumber, []])), seenDates = new Set();
  const sourceDailyRows = rowsAfter(source, '날짜별기록');
  let partialDumbbellDays = 0, zeroDumbbellDays = 0;
  for (const item of sourceDailyRows) {
    const row = item.values, student = byStudent.get(String(row[0])), date = dateOnly(row[1]), week = getWeekForDate(LEGACY_WEEKS, date);
    check(student && week && row[3] === week.week && row[4] === week.title, `날짜별기록 ${item.row}행 학생·날짜·운동 오류`);
    const key = `${student.studentNumber}:${date}`, weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    check(!seenDates.has(key), `날짜별기록 ${item.row}행 학생·날짜 중복`); seenDates.add(key);
    check(row[2] === '일월화수목금토'[weekday] && (weekday === 0 || weekday === 6 ? row[5] === '주말·보충' : ['평일', '휴업일·자율'].includes(row[5])), `날짜별기록 ${item.row}행 요일·날짜 구분 오류`);
    check(row[6] === (week.inputType === 'dumbbell' ? '세 운동 충족 여부(자동)' : inputLabels[week.inputType])
      && row[8] === ({ walking: '구간', check: '체크', dumbbell: '완료일' }[week.inputType] ?? week.unit), `날짜별기록 ${item.row}행 입력 형식·단위 오류`);
    let value = row[7], exerciseItems = [];
    if (week.inputType === 'dumbbell') {
      exerciseItems = LEGACY_DUMBBELL_EXERCISES.map(exercise => exercises.get(`${key}:${exercise.id}`));
      check(exerciseItems.every(Boolean), `날짜별기록 ${item.row}행 덤벨 원본 누락`);
      value = Object.fromEntries(LEGACY_DUMBBELL_EXERCISES.map((exercise, index) => [exercise.id, exerciseItems[index].values[3]]));
    } else if (value !== null && week.inputType === 'walking') value = bands.indexOf(value);
    else if (value !== null && week.inputType === 'check') value = ['했음', '기준 충족'].includes(value) ? true : ['안 했음', '미충족'].includes(value) ? false : value;
    const submitted = week.inputType === 'dumbbell' ? Object.values(value).some(sets => sets !== null) : value !== null;
    if (submitted) check(validateValue(week, value).valid, `날짜별기록 ${item.row}행 도메인 입력값 오류`);
    const contribution = !submitted ? 0 : week.inputType === 'walking' ? Number(value === 5) : week.inputType === 'check' ? Number(value === true)
      : week.inputType === 'dumbbell' ? Number(LEGACY_DUMBBELL_EXERCISES.every(exercise => value[exercise.id] >= exercise.targetSets)) : value;
    if (week.inputType === 'dumbbell') check(row[7] === (submitted ? contribution : null), `날짜별기록 ${item.row}행 덤벨 합산 캐시 불일치`);
    check(row[9] === (submitted ? '기록 있음' : '미입력') && row[13] === Number(submitted) && row[14] === contribution, `날짜별기록 ${item.row}행 계산 캐시 불일치`);
    student.dailyRows.push(item);
    if (!submitted) continue;
    if (week.inputType === 'dumbbell') {
      if (Object.values(value).some(sets => sets === null)) partialDumbbellDays++;
      if (Object.values(value).every(sets => sets === 0)) zeroDumbbellDays++;
    }
    const record = { studentNumber: student.studentNumber, date, value, sourceMetadata: {
      isSynthetic: true, transform: REVISED_PARTICIPATION_TRANSFORM, sourceSha256: source.sha256,
      sourceSheet: '날짜별기록', sourceRow: item.row, sourceDate: date, week: week.week, originalValue: row[7], dateType: row[5], notes: row[10], originalCreatedAt: row[11], originalUpdatedAt: row[12],
      ...(exerciseItems.length ? { exercises: exerciseItems.map((exercise, index) => ({ exerciseId: LEGACY_DUMBBELL_EXERCISES[index].id, sourceSheet: '덤벨운동기록', sourceRow: exercise.row, originalSets: exercise.values[3], notes: exercise.values[9] })) } : {}),
    } };
    records.push(record); byStudentRecords.get(student.studentNumber).push(record);
  }
  check(seenDates.size === students.length * dates.length && students.every(student => student.dailyRows.length === dates.length), '학생별 82일 원본 행 누락');
  const targets = { required: { label: '필수', participants: 0, completedWeeks: 0 }, optional: { label: '선택', participants: 0, completedWeeks: 0 } };
  const weeks = LEGACY_WEEKS.map(week => ({ week: week.week, title: week.title, completed: 0, required: 0, optional: 0 }));
  let completedWeeks = 0;
  for (const student of students) {
    const summary = summarizeProgram(LEGACY_WEEKS, byStudentRecords.get(student.studentNumber)), row = student.rosterRow;
    check(summary.weeks.every((week, index) => row[10 + index] === Number(week.complete)) && row[22] === summary.completedWeeks
      && row[23] === LEGACY_WEEKS.length && close(row[24], summary.progress), `학생별현황 ${student.sourceRow}행 주차·달성률 계산 캐시 불일치`);
    completedWeeks += summary.completedWeeks; targets[student.targetType].participants++; targets[student.targetType].completedWeeks += summary.completedWeeks;
    summary.weeks.forEach((week, index) => { weeks[index].completed += Number(week.complete); weeks[index][student.targetType] += Number(week.complete); });
  }
  const possibleWeeks = students.length * LEGACY_WEEKS.length, completionRate = completedWeeks / possibleWeeks * 100;
  const sourceSummary = source.sheets.달성률요약;
  const groups = [...Object.values(targets), { label: '전체', participants: students.length, completedWeeks }];
  for (const [index, group] of groups.entries()) {
    const row = sourceSummary[index + 5], possible = group.participants * LEGACY_WEEKS.length;
    check(row && isDeepStrictEqual(row.slice(0, 4), [group.label, group.participants, group.completedWeeks, possible])
      && close(row[4], ratio(group.completedWeeks, possible)) && close(row[5], index === 2 ? completedWeeks ? 1 : 0 : ratio(group.completedWeeks, completedWeeks)), `달성률요약 ${index + 6}행 대상별 계산 캐시 불일치`);
  }
  const difference = (ratio(targets.required.completedWeeks, targets.required.participants * LEGACY_WEEKS.length) ?? 0) - (ratio(targets.optional.completedWeeks, targets.optional.participants * LEGACY_WEEKS.length) ?? 0);
  check(sourceSummary[10]?.[0] === '필수·선택 달성률 차이' && close(sourceSummary[10]?.[2], difference * 100), '달성률요약 달성률 차이 캐시 불일치');
  check(isDeepStrictEqual(sourceSummary[15], ['주차', '운동', '필수 완료 학생', '선택 완료 학생', '전체 완료 학생', '참여 학생 수', '전체 달성률', '필수 달성률', '선택 달성률']), '달성률요약 주차별 헤더 불일치');
  for (const [index, week] of weeks.entries()) {
    const row = sourceSummary[index + 16];
    check(row && isDeepStrictEqual(row.slice(0, 6), [week.week, week.title, week.required, week.optional, week.completed, students.length])
      && close(row[6], week.completed / students.length) && close(row[7], ratio(week.required, targets.required.participants))
      && close(row[8], ratio(week.optional, targets.optional.participants)), `달성률요약 ${index + 17}행 주차별 계산 캐시 불일치`);
  }
  records.sort((a, b) => a.studentNumber.localeCompare(b.studentNumber) || a.date.localeCompare(b.date));
  return { students, records, summary: { students: students.length, dates, sourceDailyRows: sourceDailyRows.length, sourceExerciseRows: sourceExerciseRows.length,
    submittedDays: records.length, missingDays: sourceDailyRows.length - records.length, completedWeeks, possibleWeeks, completionRate, totalWeeks: LEGACY_WEEKS.length,
    partialDumbbellDays, zeroDumbbellDays, targets: Object.entries(targets).map(([targetType, group]) => ({ targetType, ...group, possibleWeeks: group.participants * LEGACY_WEEKS.length, completionRate: group.participants ? group.completedWeeks / (group.participants * LEGACY_WEEKS.length) * 100 : null })),
    weeks, formulaCells: Object.values(source.formulaCells).reduce((sum, cells) => sum + cells.length, 0) } };
}
