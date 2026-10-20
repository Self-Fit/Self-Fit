import { LEGACY_WEEKS, activityDates, validateValue, summarizeWeek } from '../src/domain/index.js';

export const DUMBBELL_TRANSFORM = 'week12-dumbbell-sets-v1';
const ids = ['D12_CURL', 'D12_SQUAT', 'D12_ROW'];
const titles = ['덤벨 컬', '덤벨 스쿼트', '덤벨 로우'];
const sides = ['좌우 각각 10회 = 1세트', '전체 10회 = 1세트', '좌우 각각 10회 = 1세트'];
const headers = {
  운동기준: ['활동일', '운동 식별값', '운동명', '세트당 반복 수', '목표 세트', '좌우 수행 기준', '필수 여부', '완료 세트 기준', '기준 연결키(자동)'],
  운동별기록: ['학번', '활동일', '운동 식별값', '완료 세트', '운영연도', '자료 상태', '최초등록일시', '최종수정일시', '이름', '운동명', '세트당 반복 수', '목표 세트', '환산 횟수', '기록 여부', '목표 충족', '자료 종류', '비고'],
  일별집계: ['학번', '이름', '활동일', '제출 운동 수', '기록일(1/0)', '충족 운동 수', '완료일(1/0)', '환산 총횟수', '일일 상태', '비고', '자료 종류'],
  주간요약: ['학번', '이름', '학년', '반', '1학기 등급(실제)', '점수 변화(실제)', '기존 기록일(106일)', '12주 기록일(5일)', '12주 참여율', '12주 완료일', '주간 완료', '환산 총횟수', '합산 참여율(111일)', '비고'],
};
const check = (condition, message) => { if (!condition) throw new Error(`덤벨 자료: ${message}`); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const close = (actual, expected) => typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-12;
const nonempty = row => Array.isArray(row) && row.some(value => value !== null && value !== undefined && value !== '');
function dateOnly(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T00:00:00)?$/.test(value), '활동일 형식 오류');
  return value.slice(0, 10);
}
function rowsAfter(source, sheet, start) {
  return source.sheets[sheet].slice(start).map((values, index) => ({ row: start + index + 1, values })).filter(item => nonempty(item.values));
}

/** Read-only conversion. Source formulas are archived, never executed. */
export function buildDumbbellData(source) {
  check(source && /^[a-f0-9]{64}$/.test(source.sha256 ?? '') && typeof source.filename === 'string' && source.filename, '원본 파일명과 SHA-256이 필요합니다.');
  const week = LEGACY_WEEKS.find(item => item.week === 12), dates = activityDates(LEGACY_WEEKS, 12);
  check(!week.deferred && week.weeklyTarget === 3, '승인된 12주차 도메인 규칙이 준비되지 않았습니다.');
  for (const [sheet, columns] of Object.entries(headers)) {
    check(Array.isArray(source.sheets?.[sheet]), `${sheet} 시트 누락`);
    check(same(source.sheets[sheet][sheet === '주간요약' ? 11 : 4], columns), `${sheet} 헤더 불일치`);
    check(Array.isArray(source.formulaCells?.[sheet]), `${sheet} 수식 원본 누락`);
    for (const cell of source.formulaCells[sheet]) {
      const address = /^([A-Z]+)([1-9]\d*)$/.exec(cell.cell ?? '');
      check(address && typeof cell.formula === 'string' && cell.formula.startsWith('='), `${sheet} 수식 주소 오류`);
      const column = [...address[1]].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      check(same(cell.cached, source.sheets[sheet][Number(address[2]) - 1]?.[column]), `${sheet} 수식 캐시와 셀 값 불일치`);
      check(!['#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#N/A', '#NUM!', '#NULL!', '#SPILL!', '#CALC!'].includes(cell.cached), `${sheet} 수식 오류 캐시`);
    }
  }
  const rules = source.sheets.운동기준;
  check(rules[24]?.[1] === 5 && rules[26]?.[1] === 3 && rules[27]?.[1] === 3, '운영일·하루 종목 수·주간 완료 기준 불일치');
  check(rules[23]?.[1] === 106 && rules[25]?.[1] === 111, '원본 참고 참여율 분모 불일치');
  const ruleRows = new Map();
  for (const [dateIndex, date] of dates.entries()) for (const [index, id] of ids.entries()) {
    const rowIndex = 5 + dateIndex * 3 + index, row = rules[rowIndex];
    check(row && dateOnly(row[0]) === date && same(row.slice(1, 8), [id, titles[index], 10, 2, sides[index], '필수', '10회 끝낸 세트만 인정']), `운동기준 ${rowIndex + 1}행 불일치`);
    ruleRows.set(`${date}:${id}`, rowIndex + 1);
  }
  const students = [], byStudent = new Map();
  for (const item of rowsAfter(source, '주간요약', 12)) {
    const row = item.values, studentNumber = String(row[0]);
    check(/^\d{5}$/.test(studentNumber) && !byStudent.has(studentNumber), `주간요약 ${item.row}행 학번 오류 또는 중복`);
    check(typeof row[1] === 'string' && row[1].trim() && integer(row[2]) && row[2] > 0 && integer(row[3]) && row[3] > 0, `주간요약 ${item.row}행 학생 정보 오류`);
    check(integer(row[4]) && row[4] >= 1 && row[4] <= 5 && typeof row[5] === 'number' && Number.isFinite(row[5]), `주간요약 ${item.row}행 체력 원본 오류`);
    check(integer(row[6]) && row[6] <= 106, `주간요약 ${item.row}행 기존 참고 기록일 오류`);
    const student = { studentNumber, name: row[1], grade: row[2], classNumber: row[3], sourceRow: item.row, weeklyRow: row, dailyRows: [], exerciseRows: [] };
    students.push(student); byStudent.set(studentNumber, student);
  }
  check(students.length > 0, '학생 명단이 비어 있습니다.');
  const exerciseRows = rowsAfter(source, '운동별기록', 5), exercises = new Map();
  for (const item of exerciseRows) {
    const row = item.values, student = byStudent.get(String(row[0])), date = dateOnly(row[1]), index = ids.indexOf(row[2]);
    check(student && dates.includes(date) && index >= 0, `운동별기록 ${item.row}행 학번·날짜·종목 불일치`);
    const key = `${student.studentNumber}:${date}:${row[2]}`;
    check(!exercises.has(key), `운동별기록 ${item.row}행 학생·날짜·종목 중복`);
    check(row[3] === null || integer(row[3]), `운동별기록 ${item.row}행 세트 수 오류`);
    check(row[4] === 2026 && row[5] === '가상 입력' && row[8] === student.name && row[9] === titles[index] && row[10] === 10 && row[11] === 2 && ['예시', '가상'].includes(row[15]), `운동별기록 ${item.row}행 기준·학생·자료 구분 오류`);
    const value = row[3];
    check(same(row.slice(12, 15), [value === null ? null : value * 10, value === null ? 0 : 1, value !== null && value >= 2 ? 1 : 0]), `운동별기록 ${item.row}행 계산 캐시 불일치`);
    exercises.set(key, item); student.exerciseRows.push(item);
  }
  check(exercises.size === students.length * dates.length * ids.length, '운동별 원본 행 누락');
  const dailyRows = rowsAfter(source, '일별집계', 5), seenDays = new Set(), records = [], dailySummaries = new Map();
  for (const item of dailyRows) {
    const row = item.values, student = byStudent.get(String(row[0])), date = dateOnly(row[2]);
    check(student && dates.includes(date) && row[1] === student.name && row[10] === '가상', `일별집계 ${item.row}행 학생·날짜·자료 구분 오류`);
    const key = `${student.studentNumber}:${date}`;
    check(!seenDays.has(key), `일별집계 ${item.row}행 학생·날짜 중복`); seenDays.add(key);
    const exerciseItems = ids.map(id => exercises.get(`${key}:${id}`));
    check(exerciseItems.every(Boolean), `일별집계 ${item.row}행 운동별 원본 누락`);
    const value = Object.fromEntries(ids.map((id, index) => [id, exerciseItems[index].values[3]]));
    const submitted = Object.values(value).filter(number => number !== null).length;
    const achieved = Object.values(value).filter(number => number !== null && number >= 2).length;
    const repetitions = Object.values(value).reduce((sum, number) => sum + (number ?? 0) * 10, 0);
    const recorded = submitted > 0 ? 1 : 0, complete = achieved === 3 ? 1 : 0;
    check(same(row.slice(3, 8), [submitted, recorded, achieved, complete, repetitions]), `일별집계 ${item.row}행 계산 캐시 불일치`);
    check(row[8] === (!recorded ? '미입력' : complete ? '완료' : repetitions > 0 ? '부분 수행' : '0세트 제출'), `일별집계 ${item.row}행 상태 불일치`);
    student.dailyRows.push(item); dailySummaries.set(key, { recorded, complete, repetitions });
    if (!recorded) continue;
    const validation = validateValue(week, value);
    check(validation.valid, `일별집계 ${item.row}행 도메인 값 오류: ${validation.error}`);
    records.push({ studentNumber: student.studentNumber, date, value, sourceMetadata: {
      isSynthetic: true, transform: DUMBBELL_TRANSFORM, sourceSha256: source.sha256,
      sourceSheet: '일별집계', sourceRow: item.row, sourceDate: date,
      exercises: exerciseItems.map((exercise, index) => ({ exerciseId: ids[index], sourceSheet: '운동별기록', sourceRow: exercise.row, originalSets: exercise.values[3], ruleSheet: '운동기준', ruleRow: ruleRows.get(`${date}:${ids[index]}`), originalCreatedAt: exercise.values[6], originalUpdatedAt: exercise.values[7] })),
    } });
  }
  check(seenDays.size === students.length * dates.length, '일별 원본 행 누락');
  let completedStudents = 0, completedDays = 0, totalRepetitions = 0;
  const groups = [{ label: '1·2등급', grade: grade => grade <= 2 }, { label: '3등급', grade: grade => grade === 3 }, { label: '4·5등급', grade: grade => grade >= 4 }];
  for (const student of students) {
    const row = student.weeklyRow, daily = dates.map(date => dailySummaries.get(`${student.studentNumber}:${date}`));
    check(daily.every(Boolean), '학생별 5일 기록 누락');
    const recorded = daily.reduce((sum, day) => sum + day.recorded, 0), complete = daily.reduce((sum, day) => sum + day.complete, 0), repetitions = daily.reduce((sum, day) => sum + day.repetitions, 0);
    const summary = summarizeWeek(week, records.filter(record => record.studentNumber === student.studentNumber));
    check(row[7] === recorded && close(row[8], recorded / 5) && row[9] === complete && row[10] === (summary.complete ? '완료' : '미완료') && row[11] === repetitions && close(row[12], (row[6] + recorded) / 111), `주간요약 ${student.sourceRow}행 계산 캐시 불일치`);
    check(summary.complete === (complete >= 3), '주간 완료 규칙 불일치');
    if (summary.complete) completedStudents++;
    completedDays += complete; totalRepetitions += repetitions;
  }
  for (const [index, group] of groups.entries()) {
    const members = students.filter(student => group.grade(student.weeklyRow[4])), row = source.sheets.주간요약[index + 5];
    const recorded = members.reduce((sum, student) => sum + student.weeklyRow[7], 0), completed = members.filter(student => student.weeklyRow[10] === '완료').length;
    check(row?.[0] === group.label && row[1] === members.length && row[2] === rules[index + 32]?.[1] && row[3] === recorded && row[4] === members.length * 5 && (members.length === 0 ? row[5] === null : close(row[5], recorded / (members.length * 5))) && row[6] === completed, `주간요약 ${index + 6}행 등급별 집계 불일치`);
  }
  records.sort((a, b) => a.studentNumber.localeCompare(b.studentNumber) || a.date.localeCompare(b.date));
  return { students, records, summary: { students: students.length, dates, sourceExerciseRows: exerciseRows.length, sourceDailyRows: dailyRows.length, submittedDays: records.length, missingDays: dailyRows.length - records.length, completedDays, completedStudents, totalRepetitions, formulaCells: Object.values(source.formulaCells).reduce((sum, cells) => sum + cells.length, 0) } };
}
