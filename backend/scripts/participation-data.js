import { createHash } from 'node:crypto';
import { LEGACY_WEEKS, activityDates, summarizeWeek, validateValue } from '../src/domain/index.js';

// Complete source weeks only. Week 25 contains one day and cannot stand in for a week.
export const SOURCE_WEEK_OPTIONS = Object.freeze([
  [1, 13, 24], [2, 14], [3, 15], [4, 16], [5, 17], [6, 18],
  [7, 19], [8, 20], [9, 21], [10, 22], [11, 23],
].map(Object.freeze));
const walkingBands = ['0~1,999보', '2,000~3,999보', '4,000~5,999보', '6,000~7,999보', '8,000~9,999보', '10,000보 이상'];
const sourceToTarget = new Map(SOURCE_WEEK_OPTIONS.flatMap((options, index) => options.map(week => [week, index + 1])));
sourceToTarget.set(12, 12); sourceToTarget.set(25, 2);
const present = value => value !== null && value !== undefined && value !== '';
const assert = (condition, message) => { if (!condition) throw new Error(`참여 데이터: ${message}`); };
const dateString = value => {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T00:00:00)?$/.test(value), `활동일 형식 오류 (${String(value)})`);
  const date = value.slice(0, 10);
  assert(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date, `존재하지 않는 날짜 (${date})`);
  return date;
};
const weekday = date => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
const plusDays = (date, offset) => new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const sourceDates = week => week <= 12 ? activityDates(LEGACY_WEEKS, week) : Array.from({ length: week === 25 ? 1 : 7 }, (_, index) => plusDays('2026-09-07', (week - 13) * 7 + index));
const hash = text => createHash('sha256').update(text).digest('hex');

function normalizeValue(week, value, row) {
  if (!present(value)) return null;
  let normalized = value;
  if (week.inputType === 'walking') normalized = walkingBands.indexOf(String(value).replace(/[–-]/g, '~').replace(/\s/g, ''));
  // The highest band contains a meaningful space; do not collapse it in the comparison.
  if (week.inputType === 'walking' && String(value).replace(/\s/g, '') === '10,000보이상') normalized = 5;
  if (week.inputType === 'check') normalized = ['했음', '기준 충족'].includes(value) ? true : ['안 했음', '미충족'].includes(value) ? false : value;
  const check = validateValue(week, normalized);
  assert(check.valid, `날짜별기록 ${row}행 입력값 오류: ${check.error}`);
  return normalized;
}

function parseStudents(source) {
  const rows = source.sheets?.['학생명단'];
  assert(Array.isArray(rows), '학생명단 시트가 없습니다.');
  const students = [], seen = new Set();
  for (let index = 5; index < rows.length; index++) {
    const row = rows[index];
    // Notes below the roster are not student accounts.
    if (!/^\d{5}$/.test(String(row?.[0] ?? ''))) continue;
    const studentNumber = String(row[0]);
    assert(!seen.has(studentNumber), `학생명단 ${index + 1}행 학번 중복 (${studentNumber})`);
    seen.add(studentNumber);
    assert(typeof row[1] === 'string' && row[1].trim(), `학생명단 ${index + 1}행 이름 누락`);
    assert(Number.isInteger(row[2]) && row[2] > 0 && Number.isInteger(row[3]) && row[3] > 0, `학생명단 ${index + 1}행 학년·반 오류`);
    assert(['필수', '선택'].includes(row[4]) && row[5] === '참여' && row[6] === 2026, `학생명단 ${index + 1}행 참여 정보 오류`);
    assert(['예시', '가상'].includes(row[7]), `학생명단 ${index + 1}행 가상 자료 표시가 없습니다.`);
    assert(!present(row[9]) || ['꺼짐', '켜짐'].includes(row[9]), `학생명단 ${index + 1}행 알림 설정 오류`);
    assert([row[12], row[14]].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0), `학생명단 ${index + 1}행 체력 점수 누락·오류`);
    assert([row[13], row[15]].every(value => Number.isInteger(value) && value >= 1 && value <= 5), `학생명단 ${index + 1}행 체력 등급 누락·오류`);
    assert(Number.isInteger(row[26]) && row[26] > 0, `학생명단 ${index + 1}행 체력 원본 행 누락`);
    students.push({
      studentNumber, name: row[1].trim(), grade: row[2], classNumber: row[3],
      targetType: row[4] === '필수' ? 'required' : 'optional', participating: true,
      weekendReminder: row[9] === '켜짐', rosterRow: [...row], sourceRow: index + 1,
      fitness: { semester1: { score: row[12], grade: row[13] }, semester2: { score: row[14], grade: row[15] }, scoreChange: row[16], changeLabel: row[17], sourceRow: row[26] },
      sourceMetadata: { isSynthetic: true, sourceSha256: source.sha256, sourceSheet: '학생명단', sourceRow: index + 1, notes: row[10], syntheticStudentNumber: true },
    });
  }
  assert(students.length > 0, '학생명단이 비어 있습니다.');
  return students;
}

function parseRecords(source, students) {
  const rows = source.sheets?.['날짜별기록'];
  assert(Array.isArray(rows), '날짜별기록 시트가 없습니다.');
  const byStudent = new Map(students.map(student => [student.studentNumber, new Map()]));
  const keys = new Set(); let rowCount = 0, filled = 0;
  for (let index = 5; index < rows.length; index++) {
    const row = rows[index]; if (!row || row.every(value => !present(value))) continue;
    const studentNumber = String(row[0]), weeks = byStudent.get(studentNumber), sourceWeek = row[3];
    assert(weeks, `날짜별기록 ${index + 1}행 명단에 없는 학번`);
    assert(Number.isInteger(sourceWeek) && sourceWeek >= 1 && sourceWeek <= 25, `날짜별기록 ${index + 1}행 주차 오류`);
    const date = dateString(row[1]), key = `${studentNumber}:${date}`;
    assert(!keys.has(key), `날짜별기록 ${index + 1}행 학생·날짜 중복`); keys.add(key);
    assert(sourceDates(sourceWeek).includes(date), `날짜별기록 ${index + 1}행 주차와 활동일 불일치`);
    assert(row[2] === '월화수목금토일'[weekday(date)], `날짜별기록 ${index + 1}행 요일 불일치`);
    const targetWeek = sourceToTarget.get(sourceWeek), week = LEGACY_WEEKS[targetWeek - 1];
    assert(row[4] === week.title, `날짜별기록 ${index + 1}행 운동 불일치`);
    // This original workbook redistribution remains scoped to weeks 1–11.
    // Week 12 is imported separately from its exercise-level source workbook.
    assert(sourceWeek !== 12 || !present(row[7]), `날짜별기록 ${index + 1}행 별도 반영 대상인 덤벨 입력`);
    const value = sourceWeek === 12 ? null : normalizeValue(week, row[7], index + 1);
    assert(['가상', '예시'].includes(row[16]), `날짜별기록 ${index + 1}행 가상 자료 표시 누락`);
    const record = { studentNumber, sourceWeek, sourceDate: date, sourceRow: index + 1, weekday: weekday(date), value, original: row };
    if (!weeks.has(sourceWeek)) weeks.set(sourceWeek, []);
    weeks.get(sourceWeek).push(record); rowCount++; if (value !== null) filled++;
  }
  for (const [studentNumber, weeks] of byStudent) {
    for (let week = 1; week <= 25; week++) {
      assert(weeks.get(week)?.length === sourceDates(week).length, `${studentNumber}의 ${week}주차 날짜가 누락됐습니다.`);
      weeks.get(week).sort((a, b) => a.sourceDate.localeCompare(b.sourceDate));
    }
  }
  assert(rowCount === students.length * 167, '학생별 167일 원본 행 수 불일치');
  return { byStudent, rowCount, filled };
}

function optionFor(sourceWeek, targetWeek, rows) {
  const week = LEGACY_WEEKS[targetWeek - 1];
  const records = rows.filter(row => row.value !== null).map(row => ({ date: plusDays(week.startDate, row.weekday), value: row.value }));
  return { sourceWeek, targetWeek, rows, weekdayCount: rows.filter(row => row.weekday < 5 && row.value !== null).length,
    weekendCount: rows.filter(row => row.weekday >= 5 && row.value !== null).length,
    complete: summarizeWeek(week, records).complete ? 1 : 0 };
}

function chooseWeeks(student, weeks) {
  const all = [...weeks.values()].flat().filter(row => row.sourceWeek !== 12);
  const rawWeekdays = all.filter(row => row.weekday < 5), rawWeekends = all.filter(row => row.weekday >= 5);
  assert(rawWeekdays.length === 116 && rawWeekends.length === 46, `${student.studentNumber} 평일·주말 분모 불일치`);
  const originalWeekdays = rawWeekdays.filter(row => row.value !== null).length;
  const originalWeekends = rawWeekends.filter(row => row.value !== null).length;
  const options = SOURCE_WEEK_OPTIONS.map((candidates, index) => candidates.map(sourceWeek => optionFor(sourceWeek, index + 1, weeks.get(sourceWeek)))
    .sort((a, b) => hash(`${student.studentNumber}:${index + 1}:${a.sourceWeek}`).localeCompare(hash(`${student.studentNumber}:${index + 1}:${b.sourceWeek}`))));
  const originalCompleted = options.flat().reduce((sum, option) => sum + option.complete, 0);
  const targetWeekdays = Math.round(originalWeekdays * 55 / 116);
  let best = null; const path = [];
  function visit(index, weekdays, completed, weekends) {
    if (index === options.length) {
      // Integer distances preserve exact tie ordering for the two rate-based criteria.
      const score = [Math.abs(weekdays - targetWeekdays), Math.abs(completed * 23 - originalCompleted * 11), Math.abs(weekends * 46 - originalWeekends * 22)];
      const better = !best || score.some((value, i) => value < best.score[i] && score.slice(0, i).every((prefix, j) => prefix === best.score[j]));
      if (better) best = { score, options: [...path], weekdays, completed, weekends };
      return;
    }
    for (const option of options[index]) { path.push(option); visit(index + 1, weekdays + option.weekdayCount, completed + option.complete, weekends + option.weekendCount); path.pop(); }
  }
  visit(0, 0, 0, 0);
  return { ...best, original: { weekdaySubmissions: originalWeekdays, weekdayDays: 116, weekendSubmissions: originalWeekends, weekendDays: 46, completedWeeks: originalCompleted, eligibleWeeks: 23 },
    targets: { weekdaySubmissions: targetWeekdays, completedWeeks: originalCompleted * 11 / 23, weekendSubmissions: originalWeekends * 22 / 46 } };
}

/** Pure transformation of an archived workbook extract. Never writes files or a database. */
export function buildParticipationData(source) {
  assert(source && typeof source === 'object' && /^[a-f0-9]{64}$/.test(source.sha256 ?? ''), '원본 SHA-256이 필요합니다.');
  const students = parseStudents(source), parsed = parseRecords(source, students), records = [], mapping = [], groups = {};
  for (const student of students) {
    const choice = chooseWeeks(student, parsed.byStudent.get(student.studentNumber));
    mapping.push({ studentNumber: student.studentNumber, original: choice.original, targets: choice.targets,
      actual: { weekdaySubmissions: choice.weekdays, weekendSubmissions: choice.weekends, completedWeeks: choice.completed },
      weekdayDeviation: choice.score[0], selectedWeeks: choice.options.map(option => ({ targetWeek: option.targetWeek, sourceWeek: option.sourceWeek, sourceRows: option.rows.map(row => row.sourceRow) })) });
    for (const option of choice.options) for (const row of option.rows) {
      if (row.value === null) continue;
      records.push({ studentNumber: student.studentNumber, date: plusDays(LEGACY_WEEKS[option.targetWeek - 1].startDate, row.weekday), value: row.value,
        sourceMetadata: { isSynthetic: true, redistribution: 'same-exercise-complete-week-v1', sourceSha256: source.sha256, sourceSheet: '날짜별기록',
          sourceRow: row.sourceRow, sourceDate: row.sourceDate, sourceWeek: row.sourceWeek, targetWeek: option.targetWeek,
          originalValue: row.original[7], dateType: row.original[5], originalCreatedAt: row.original[11], originalUpdatedAt: row.original[12] } });
    }
    const grade = student.fitness.semester1.grade, group = grade <= 2 ? '1·2등급' : grade === 3 ? '3등급' : '4·5등급';
    const item = groups[group] ??= { students: 0, sourceWeekdaySubmissions: 0, sourceWeekdayDays: 0, targetWeekdaySubmissions: 0, targetWeekdayDays: 0 };
    item.students++; item.sourceWeekdaySubmissions += choice.original.weekdaySubmissions; item.sourceWeekdayDays += 116;
    item.targetWeekdaySubmissions += choice.weekdays; item.targetWeekdayDays += 55;
  }
  records.sort((a, b) => a.studentNumber.localeCompare(b.studentNumber) || a.date.localeCompare(b.date));
  for (const item of Object.values(groups)) { item.sourceRate = item.sourceWeekdaySubmissions / item.sourceWeekdayDays; item.targetRate = item.targetWeekdaySubmissions / item.targetWeekdayDays; }
  return { students, records, mapping, summary: {
    sourceFilename: source.filename, sourceSha256: source.sha256, students: students.length, sourceRows: parsed.rowCount, sourceFilledRecords: parsed.filled,
    targetRecords: records.length, targetActivityDays: 82, redistributedWeeks: 11, unmappedWeeks: [12], deferredWeeks: LEGACY_WEEKS.filter(week => week.deferred).map(week => week.week),
    originalArchiveRequired: true, selectionMethod: 'lexicographic-weekday-completion-weekend',
    exactWeekdayTargets: mapping.filter(item => item.weekdayDeviation === 0).length,
    maxWeekdayDeviation: Math.max(...mapping.map(item => item.weekdayDeviation)), completedWeekRecords: mapping.reduce((sum, item) => sum + item.actual.completedWeeks, 0), groups,
  } };
}

// Imports only attach to the migrated legacy challenge; never create or select
// the latest challenge, because archived workbook dates have a fixed meaning.
export const LEGACY_CHALLENGE_ID = 'challenge-2026-self-fit';
export async function legacyChallengeId(db) {
  const challenge = await db.challenge.findUnique({ where: { id: LEGACY_CHALLENGE_ID }, select: { id: true } });
  assert(challenge, '레거시 챌린지가 없습니다. 먼저 마이그레이션을 적용해 주세요.');
  return challenge.id;
}

/** Accounts no longer store participation (20261021090000); the source workbook still says who took part. */
export function withSourceParticipation(users, students) {
  const byNumber = new Map(students.map(student => [student.studentNumber, student]));
  return users.map(user => ({ ...user, participating: byNumber.get(user.studentNumber)?.participating ?? false }));
}

/** `users` carry `participating` from the source workbook (see withSourceParticipation). */
export async function ensureLegacyMemberships(db, users, { apply = true, requireExisting = false } = {}) {
  const challengeId = await legacyChallengeId(db);
  const participants = users.filter(user => user.role === 'student'
    && (user.targetType === 'required' || (user.targetType === 'optional' && user.participating)));
  const existing = await db.challengeMembership.findMany({ where: { challengeId, userId: { in: participants.map(user => user.id) } } });
  for (const membership of existing) {
    const user = participants.find(item => item.id === membership.userId);
    assert(membership.status === 'active' && membership.mode === (user.targetType === 'required' ? 'forced' : 'invited'),
      '레거시 참여 상태가 변경되어 기존 상태를 덮어쓰지 않습니다.');
  }
  const found = new Set(existing.map(item => item.userId));
  const missing = participants.filter(user => !found.has(user.id));
  assert(!requireExisting || missing.length === 0, '레거시 참여 정보가 누락되어 기존 적재를 검증할 수 없습니다.');
  if (apply && missing.length) await db.challengeMembership.createMany({ data: missing.map(user => ({
    challengeId, userId: user.id, mode: user.targetType === 'required' ? 'forced' : 'invited', status: 'active',
  })) });
  return challengeId;
}
