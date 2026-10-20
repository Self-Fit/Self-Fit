import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParticipationData, SOURCE_WEEK_OPTIONS } from '../scripts/participation-data.js';
import { LEGACY_WEEKS, activityDates, validateValue, getWeekForDate, summarizeProgram } from '../src/domain/index.js';

const targets = new Map(SOURCE_WEEK_OPTIONS.flatMap((list, index) => list.map(week => [week, index + 1])));
targets.set(12, 12); targets.set(25, 2);
const sourceDate = (week, day) => week <= 12 ? activityDates(LEGACY_WEEKS, week)[day] : new Date(Date.parse('2026-09-07T00:00:00Z') + ((week - 13) * 7 + day) * 86400000).toISOString().slice(0, 10);
function fixture(valueFor = () => null) {
  const roster = ['10101', '가상 학생', 1, 1, '선택', '참여', 2026, '예시', null, '꺼짐', '검증용 가상 자료', 1, 30, 3, 31, 3, 1, '등급 유지', 0.5, 106, 53, 0.5, 10, 5, 5 / 23, '포함', 5];
  const source = { filename: 'test-only.xlsx', sha256: 'a'.repeat(64), sheets: { 학생명단: [[], [], [], [], [], roster], 날짜별기록: [[], [], [], [], []] } };
  for (let week = 1; week <= 25; week++) for (let day = 0; day < (week === 12 ? 5 : week === 25 ? 1 : 7); day++) {
    const target = LEGACY_WEEKS[targets.get(week) - 1];
    source.sheets.날짜별기록.push(['10101', `${sourceDate(week, day)}T00:00:00`, '월화수목금토일'[day], week, target.title, day < 5 ? '평일 필수' : '선택·보충', target.inputType, week === 12 ? null : valueFor(week, day, target), target.unit, null, null, null, null, day < 5 ? 1 : 0, null, null, '가상']);
  }
  return source;
}

test('blank dates are absent; a whole source week maps to the same weekdays without week 12 or partial week 25', () => {
  const source = fixture((week, day, target) => target.inputType === 'walking' ? (day === 0 ? '0~1,999보' : '10,000보 이상') : target.inputType === 'check' ? (day === 0 ? '안 했음' : '했음') : day === 0 ? 0 : target.inputType === 'distance' ? 2.345 : 200);
  source.sheets.학생명단.push(['필수 항목', '이 행은 안내문입니다.']);
  const before = JSON.stringify(source), result = buildParticipationData(source);
  assert.equal(JSON.stringify(source), before, 'pure transform must not mutate the source');
  assert.equal(result.students.length, 1);
  assert.equal(result.students[0].sourceRow, 6);
  assert.deepEqual(result.students[0].rosterRow, source.sheets.학생명단[5]);
  assert.equal(result.summary.sourceRows, 167);
  assert.equal(result.records.length, 77);
  assert.equal(new Set(result.records.map(row => row.date)).size, 77);
  assert.ok(result.records.some(row => row.value === false));
  assert.ok(result.records.some(row => row.value === 0));
  assert.ok(result.records.some(row => row.value === 2.345));
  for (const record of result.records) {
    const week = getWeekForDate(LEGACY_WEEKS, record.date), original = source.sheets.날짜별기록[record.sourceMetadata.sourceRow - 1];
    assert.ok(validateValue(week, record.value).valid);
    assert.notEqual(week.week, 12);
    assert.notEqual(record.sourceMetadata.sourceWeek, 25);
    assert.equal(new Date(`${record.date}T00:00:00Z`).getUTCDay(), new Date(`${record.sourceMetadata.sourceDate}T00:00:00Z`).getUTCDay());
    assert.equal(original[7], record.sourceMetadata.originalValue);
    assert.equal(original[3], result.mapping[0].selectedWeeks.find(item => item.targetWeek === week.week).sourceWeek);
    assert.equal(record.sourceMetadata.originalCreatedAt, null);
    assert.equal(record.sourceMetadata.isSynthetic, true);
  }
  assert.equal(summarizeProgram(LEGACY_WEEKS, result.records).complete, false);
  assert.deepEqual(buildParticipationData(source), result, 'same input must make exactly the same selection');
});

test('selection minimizes weekday count, then completion distance, then weekend distance', () => {
  // Two 5-weekday options satisfy the primary objective. Both complete once.
  // Zero weekend days is closer to 2/46*22 than two weekend days.
  const source = fixture((week, day) => week === 1 && day < 5 || week === 24 ? '10,000보 이상' : null);
  const result = buildParticipationData(source), mapping = result.mapping[0];
  assert.equal(mapping.original.weekdaySubmissions, 10);
  assert.equal(mapping.targets.weekdaySubmissions, 5);
  assert.equal(mapping.original.completedWeeks, 2);
  assert.equal(mapping.actual.weekdaySubmissions, 5);
  assert.equal(mapping.actual.completedWeeks, 1);
  assert.equal(mapping.actual.weekendSubmissions, 0);
  assert.equal(mapping.selectedWeeks[0].sourceWeek, 1);
  assert.equal(result.records.length, 5);
});

test('weekday distance takes precedence over completing one more week', () => {
  const source = fixture((week, day) => week === 1 && day < 4 || week === 24 && day < 5 ? '10,000보 이상' : null);
  // 9/116*55 rounds to 4. Source week 1 matches that count exactly even though
  // week 24 would complete; the primary criterion must not be sacrificed.
  const result = buildParticipationData(source);
  assert.equal(result.mapping[0].selectedWeeks[0].sourceWeek, 1);
  assert.equal(result.mapping[0].weekdayDeviation, 0);
  assert.equal(result.mapping[0].actual.completedWeeks, 0);
});

test('completion distance breaks a tie in weekday submissions', () => {
  const source = fixture((week, day) => [1, 13, 24].includes(week) && (day < 3 || week !== 1 && day >= 5) ? '10,000보 이상' : null);
  const result = buildParticipationData(source);
  assert.equal(result.mapping[0].targets.weekdaySubmissions, 4);
  assert.equal(result.mapping[0].actual.weekdaySubmissions, 3);
  assert.equal(result.mapping[0].weekdayDeviation, 1, 'report an unavoidable nearest-feasible shortfall rather than inventing a record');
  assert.equal(result.mapping[0].actual.completedWeeks, 1);
  assert.ok([13, 24].includes(result.mapping[0].selectedWeeks[0].sourceWeek));
});

test('all blank sources produce no synthetic zero records and leave week twelve for its separate import', () => {
  const result = buildParticipationData(fixture());
  assert.equal(result.records.length, 0);
  assert.equal(result.summary.completedWeekRecords, 0);
  assert.deepEqual(result.summary.deferredWeeks, []);
  assert.deepEqual(result.summary.unmappedWeeks, [12]);
  assert.equal(result.summary.redistributedWeeks, 11);
  assert.equal(result.students[0].participating, true, 'optional participants remain enrolled from the supplied roster');
});

test('duplicate student, duplicate date, missing date, invalid value and separately imported input fail before import', () => {
  const duplicateStudent = fixture(); duplicateStudent.sheets.학생명단.push([...duplicateStudent.sheets.학생명단[5]]);
  assert.throws(() => buildParticipationData(duplicateStudent), /학번 중복/);
  const duplicateDate = fixture(); duplicateDate.sheets.날짜별기록.push([...duplicateDate.sheets.날짜별기록[5]]);
  assert.throws(() => buildParticipationData(duplicateDate), /학생·날짜 중복/);
  const missingDate = fixture(); missingDate.sheets.날짜별기록.pop();
  assert.throws(() => buildParticipationData(missingDate), /날짜가 누락/);
  const invalidValue = fixture(); invalidValue.sheets.날짜별기록.find(row => row[3] === 3)[7] = -1;
  assert.throws(() => buildParticipationData(invalidValue), /입력값 오류/);
  const deferred = fixture(); deferred.sheets.날짜별기록.find(row => row[3] === 12)[7] = 1;
  assert.throws(() => buildParticipationData(deferred), /별도 반영 대상인 덤벨/);
});

test('foreign student, wrong exercise and shifted source dates cannot silently map into valid records', () => {
  const foreign = fixture(); foreign.sheets.날짜별기록[5][0] = '99999';
  assert.throws(() => buildParticipationData(foreign), /명단에 없는 학번/);
  const wrongExercise = fixture(); wrongExercise.sheets.날짜별기록[5][4] = '스쿼트';
  assert.throws(() => buildParticipationData(wrongExercise), /운동 불일치/);
  const shifted = fixture(); shifted.sheets.날짜별기록[5][1] = '2026-05-11T00:00:00';
  assert.throws(() => buildParticipationData(shifted), /주차와 활동일 불일치/);
  const missingFitness = fixture(); missingFitness.sheets.학생명단[5][13] = null;
  assert.throws(() => buildParticipationData(missingFitness), /체력 등급/);
});
