import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { buildRevisedParticipationData, REVISED_PARTICIPATION_TRANSFORM } from '../scripts/revised-participation-data.js';
import { LEGACY_WEEKS, LEGACY_DUMBBELL_EXERCISES, activityDates, getWeekForDate, summarizeProgram } from '../src/domain/index.js';

const labels = { walking: '걸음 구간', check: '수행 여부', count: '횟수', distance: '거리', dumbbell: '운동별 완료 세트' };
const bands = ['0~1,999보', '2,000~3,999보', '4,000~5,999보', '6,000~7,999보', '8,000~9,999보', '10,000보 이상'];
const valueFor = (index, week, day) => {
  if (index % 2 === 0) {
    if ([1, 2, 3].includes(week) && day === 0) return week === 2 ? false : 0;
    if (week === 5 && day === 0) return 500;
    if (week === 8 && day <= 1) return day === 0 ? 0.1 : 9.9;
    if (week === 12 && day < 4) return day === 3 ? { D12_CURL: 0, D12_SQUAT: null, D12_ROW: 1 } : { D12_CURL: day === 1 ? 3 : 2, D12_SQUAT: 2, D12_ROW: 2 };
  } else {
    if (week === 1 && day < 5) return 5;
    if (week === 12 && day === 0) return { D12_CURL: 0, D12_SQUAT: 0, D12_ROW: 0 };
  }
  return null;
};

/** Entirely fabricated fixture. This export is also used by isolated importer tests. */
export function makeRevisedSourceFixture(count = 2) {
  const sheets = {
    달성률요약: Array.from({ length: 28 }, () => Array(9).fill(null)),
    학생별현황: Array.from({ length: 5 }, () => []),
    날짜별기록: Array.from({ length: 5 }, () => []),
    덤벨운동기록: Array.from({ length: 5 }, () => []),
    운영기준: Array.from({ length: 17 }, () => Array(11).fill(null)),
  };
  sheets.달성률요약[4] = ['대상', '참여 학생 수', '완료 주수 합계', '가능 주수', '달성률', '전체 완료분 비중', null, null, null];
  sheets.학생별현황[4] = ['학번', '이름', '학년', '반', '대상 구분', '1학기 점수(실제)', '1학기 등급(실제)', '2학기 점수(실제)', '2학기 등급(실제)', '점수 변화(실제)', ...LEGACY_WEEKS.map(w => `${w.week}주차`), '완료 주수(자동)', '전체 주수', '달성률(자동)', '비고', '참여 여부'];
  sheets.날짜별기록[4] = ['학번', '활동일', '요일', '주차', '운동', '날짜 구분', '입력 형식', '입력값', '단위', '기록 상태(자동)', '비고', '최초등록일시(선택)', '최종수정일시(선택)', '기록 여부(자동)', '주간 합산값(자동)'];
  sheets.덤벨운동기록[4] = ['학번', '활동일', '운동 식별값', '완료 세트', '운동명', '목표 세트(자동)', '기록 여부(자동)', '목표 충족(자동)', '자료 종류', '비고'];
  sheets.운영기준[4] = ['주차', '시작일', '종료일', '운동', '입력 형식', '주간 완료 기준값', '단위', '완료 조건', null, '덤벨 기준', '값'];
  for (const week of LEGACY_WEEKS) sheets.운영기준[week.week + 4] = [week.week, week.startDate, week.endDate, week.title, labels[week.inputType], week.weeklyTarget, week.unit, week.description, null, null, null];
  [['세트당 반복 수', 10], ['운동별 목표 세트', 2], ['하루 필수 운동 수', 3]].forEach((pair, index) => sheets.운영기준[index + 5].splice(9, 2, ...pair));
  const summaries = [];
  for (let index = 0; index < count; index++) {
    const studentNumber = String(10001 + index), records = [], target = index % 2 === 0 ? '필수' : '선택';
    for (const week of LEGACY_WEEKS) for (const [day, date] of activityDates(LEGACY_WEEKS, week).entries()) {
      const value = valueFor(index, week.week, day), submitted = value !== null;
      const achieved = week.inputType === 'dumbbell' && submitted ? Object.values(value).every(sets => sets >= 2) : false;
      const input = value === null ? null : week.inputType === 'walking' ? bands[value] : week.inputType === 'check' ? value ? '했음' : '안 했음' : week.inputType === 'dumbbell' ? Number(achieved) : value;
      const contribution = !submitted ? 0 : week.inputType === 'walking' ? Number(value === 5) : week.inputType === 'check' ? Number(value) : week.inputType === 'dumbbell' ? Number(achieved) : value;
      sheets.날짜별기록.push([studentNumber, date, '월화수목금토일'[day], week.week, week.title, day < 5 ? '평일' : '주말·보충', week.inputType === 'dumbbell' ? '세 운동 충족 여부(자동)' : labels[week.inputType], input, ({ walking: '구간', check: '체크', dumbbell: '완료일' }[week.inputType] ?? week.unit), submitted ? '기록 있음' : '미입력', !submitted ? '검증용 가상 부상 휴식' : null, null, null, Number(submitted), contribution]);
      if (submitted) records.push({ date, value });
      if (week.week === 12) for (const exercise of LEGACY_DUMBBELL_EXERCISES) {
        const sets = value?.[exercise.id] ?? null;
        sheets.덤벨운동기록.push([studentNumber, date, exercise.id, sets, exercise.title, 2, Number(sets !== null), Number(sets !== null && sets >= 2), '가상', sets === null ? '검증용 종목 미입력' : null]);
      }
    }
    const summary = summarizeProgram(LEGACY_WEEKS, records);
    summaries.push({ target, summary });
    sheets.학생별현황.push([studentNumber, `Fixture Student ${index + 1}`, 1, 1, target, 30.125, 3, 32.625, 3, 2.5, ...summary.weeks.map(week => Number(week.complete)), summary.completedWeeks, 12, summary.progress, '자동화 테스트 전용 가상 자료', '참여']);
  }
  const total = summaries.reduce((sum, item) => sum + item.summary.completedWeeks, 0);
  const groups = ['필수', '선택'].map(target => ({ target, members: summaries.filter(item => item.target === target) }));
  for (const [index, group] of [...groups, { target: '전체', members: summaries }].entries()) {
    const complete = group.members.reduce((sum, item) => sum + item.summary.completedWeeks, 0), possible = group.members.length * 12;
    sheets.달성률요약[index + 5] = [group.target, group.members.length, complete, possible, possible ? complete / possible : null, index === 2 ? total ? 1 : 0 : total ? complete / total : null, null, null, null];
  }
  sheets.달성률요약[10][0] = '필수·선택 달성률 차이';
  sheets.달성률요약[10][2] = ((sheets.달성률요약[5][4] ?? 0) - (sheets.달성률요약[6][4] ?? 0)) * 100;
  sheets.달성률요약[15] = ['주차', '운동', '필수 완료 학생', '선택 완료 학생', '전체 완료 학생', '참여 학생 수', '전체 달성률', '필수 달성률', '선택 달성률'];
  for (const [index, week] of LEGACY_WEEKS.entries()) {
    const completed = groups.map(group => group.members.filter(item => item.summary.weeks[index].complete).length);
    sheets.달성률요약[index + 16] = [week.week, week.title, ...completed, completed[0] + completed[1], count, (completed[0] + completed[1]) / count, groups[0].members.length ? completed[0] / groups[0].members.length : null, groups[1].members.length ? completed[1] / groups[1].members.length : null];
  }
  const formulaCells = Object.fromEntries(Object.keys(sheets).map(key => [key, []]));
  formulaCells.달성률요약.push({ cell: 'E8', formula: '=C8/D8', cached: sheets.달성률요약[7][4] });
  formulaCells.학생별현황.push({ cell: 'W6', formula: '=SUM(K6:V6)', cached: sheets.학생별현황[5][22] });
  formulaCells.날짜별기록.push({ cell: 'N6', formula: '=IF(H6="",0,1)', cached: sheets.날짜별기록[5][13] });
  formulaCells.덤벨운동기록.push({ cell: 'G6', formula: '=IF(D6="",0,1)', cached: sheets.덤벨운동기록[5][6] });
  return { filename: 'synthetic-revised-fixture.xlsx', sha256: 'a'.repeat(64), sheets, formulaCells, dateEpoch: '1899-12-30T00:00:00' };
}

// Importer integration tests may import the synthetic fixture without registering this suite twice.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  test('revised workbook maps directly to its actual dates and counts completed weeks over twelve', () => {
    const source = makeRevisedSourceFixture(), original = structuredClone(source), result = buildRevisedParticipationData(source);
    assert.deepEqual(source, original);
    assert.equal(result.students.length, 2);
    assert.equal(result.summary.sourceDailyRows, 164);
    assert.equal(result.summary.sourceExerciseRows, 30);
    assert.equal(result.summary.submittedDays, 16);
    assert.equal(result.summary.missingDays, 148);
    assert.equal(result.summary.completedWeeks, 4);
    assert.equal(result.summary.possibleWeeks, 24);
    assert.ok(Math.abs(result.summary.completionRate - 100 / 6) < 1e-12);
    assert.equal(new Set(result.records.map(row => `${row.studentNumber}:${row.date}`)).size, 16);
    assert.equal(result.students[0].sourceRow, 6);
    assert.deepEqual(result.students[0].rosterRow, source.sheets.학생별현황[5]);
    assert.equal(result.students[0].fitness.semester1.score, 30.125);
    assert.equal(result.students[0].dailyRows.length, 82);
    assert.equal(result.students[0].exerciseRows.length, 15);
    assert.ok(result.students[0].dailyRows.some(item => item.values[10] === '검증용 가상 부상 휴식'));
    for (const record of result.records) {
      assert.equal(record.sourceMetadata.transform, REVISED_PARTICIPATION_TRANSFORM);
      assert.equal(record.date, source.sheets.날짜별기록[record.sourceMetadata.sourceRow - 1][1]);
      assert.equal(record.sourceMetadata.week, getWeekForDate(LEGACY_WEEKS, record.date).week);
      assert.equal(record.sourceMetadata.originalCreatedAt, null);
    }
  });

  test('zero and false submissions survive while absent days and absent exercise fields stay missing', () => {
    const result = buildRevisedParticipationData(makeRevisedSourceFixture());
    const first = result.records.filter(record => record.studentNumber === '10001');
    assert.equal(first.find(record => record.date === '2026-05-04').value, 0);
    assert.equal(first.find(record => record.date === '2026-05-18').value, false);
    assert.equal(first.find(record => record.date === '2026-05-25').value, 0);
    assert.deepEqual(first.find(record => record.date === '2026-09-03').value, { D12_CURL: 0, D12_SQUAT: null, D12_ROW: 1 });
    assert.equal(first.some(record => record.date === '2026-09-04'), false);
    assert.equal(result.summary.partialDumbbellDays, 1);
    assert.equal(result.summary.zeroDumbbellDays, 1);
    assert.equal(first.find(record => record.date === '2026-06-29').value, 0.1);
    const allZero = result.records.find(record => record.studentNumber === '10002' && record.date === '2026-08-31');
    assert.deepEqual(allZero.value, { D12_CURL: 0, D12_SQUAT: 0, D12_ROW: 0 });
  });

  test('missing and duplicate student, date or exercise rows fail before any import', () => {
    for (const [sheet, pattern] of [['학생별현황', /학번 오류 또는 중복/], ['날짜별기록', /학생·날짜 중복/], ['덤벨운동기록', /학생·날짜·종목 중복/]]) {
      const source = makeRevisedSourceFixture(); source.sheets[sheet].push([...source.sheets[sheet][5]]);
      assert.throws(() => buildRevisedParticipationData(source), pattern);
    }
    for (const sheet of ['날짜별기록', '덤벨운동기록']) {
      const source = makeRevisedSourceFixture(); source.sheets[sheet].pop();
      assert.throws(() => buildRevisedParticipationData(source), /원본 행 누락/);
    }
  });

  test('foreign identity, shifted dates, altered exercise titles and unexpected input formats are rejected', () => {
    for (const [index, value, pattern] of [[0, '99999', /학생·날짜·운동 오류/], [1, '2026-05-11', /학생·날짜·운동 오류/], [4, '다른 운동', /학생·날짜·운동 오류/], [6, '횟수', /입력 형식·단위 오류/], [2, '화', /요일·날짜 구분 오류/]]) {
      const source = makeRevisedSourceFixture(); source.sheets.날짜별기록[5][index] = value;
      assert.throws(() => buildRevisedParticipationData(source), pattern);
    }
  });

  test('invalid typed exercise values, unsupported sets and altered domain rules cannot pass', () => {
    const invalidCount = makeRevisedSourceFixture(); invalidCount.sheets.날짜별기록.find(row => row[3] === 3)[7] = -1;
    assert.throws(() => buildRevisedParticipationData(invalidCount), /도메인 입력값 오류/);
    const invalidSets = makeRevisedSourceFixture(); invalidSets.sheets.덤벨운동기록[5][3] = 1.5;
    assert.throws(() => buildRevisedParticipationData(invalidSets), /세트 수 오류/);
    const invalidRules = makeRevisedSourceFixture(); invalidRules.sheets.운영기준[16][5] = 2;
    assert.throws(() => buildRevisedParticipationData(invalidRules), /운영 기준 불일치/);
    const invalidFitness = makeRevisedSourceFixture(); invalidFitness.sheets.학생별현황[5][9] = 99;
    assert.throws(() => buildRevisedParticipationData(invalidFitness), /체력 원값 오류/);
  });

  test('formula addresses, cached cell values and Excel error values are independently checked', () => {
    const wrongCache = makeRevisedSourceFixture(); wrongCache.formulaCells.달성률요약[0].cached = 0.56;
    assert.throws(() => buildRevisedParticipationData(wrongCache), /수식 캐시와 셀 값 불일치/);
    const wrongAddress = makeRevisedSourceFixture(); wrongAddress.formulaCells.달성률요약[0].cell = 'ZZ99999';
    assert.throws(() => buildRevisedParticipationData(wrongAddress), /수식 캐시와 셀 값 불일치/);
    const duplicate = makeRevisedSourceFixture(); duplicate.formulaCells.달성률요약.push({ ...duplicate.formulaCells.달성률요약[0] });
    assert.throws(() => buildRevisedParticipationData(duplicate), /수식 주소 중복/);
    const error = makeRevisedSourceFixture(); error.sheets.운영기준[0] = ['#REF!'];
    assert.throws(() => buildRevisedParticipationData(error), /수식 오류 캐시/);
  });

  test('matching but fraudulent formula caches still fail recomputed daily and completion summaries', () => {
    const source = makeRevisedSourceFixture(); source.sheets.달성률요약[7][4] = 0.56; source.formulaCells.달성률요약[0].cached = 0.56;
    assert.throws(() => buildRevisedParticipationData(source), /대상별 계산 캐시 불일치/);
    const student = makeRevisedSourceFixture(); student.sheets.학생별현황[5][21] = 0;
    assert.throws(() => buildRevisedParticipationData(student), /주차·달성률 계산 캐시 불일치/);
    const daily = makeRevisedSourceFixture(); daily.sheets.날짜별기록[5][14] = 1;
    assert.throws(() => buildRevisedParticipationData(daily), /계산 캐시 불일치/);
    const detail = makeRevisedSourceFixture(); detail.sheets.덤벨운동기록[5][7] = 0;
    assert.throws(() => buildRevisedParticipationData(detail), /계산 캐시 불일치/);
  });

  test('full-cohort synthetic fixture preserves the 82-day and 15-exercise cardinalities', () => {
    const result = buildRevisedParticipationData(makeRevisedSourceFixture(194));
    assert.equal(result.students.length, 194);
    assert.equal(result.summary.sourceDailyRows, 15908);
    assert.equal(result.summary.sourceExerciseRows, 2910);
    assert.equal(result.summary.possibleWeeks, 2328);
    assert.ok(result.students.every(student => student.name.startsWith('Fixture Student ')));
  });
}
