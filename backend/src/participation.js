import { WEEKS, summarizeProgram } from './domain/index.js';

const percentage = (completed, possible) => possible === 0 ? null : completed / possible * 100;
const numberOrder = (left, right) => left === right ? 0 : left == null ? 1 : right == null ? -1 : left - right;
const targetLabels = { required: '필수', optional: '선택' };

function addToGroup(groups, key, fields, completedWeeks) {
  if (!groups.has(key)) groups.set(key, { ...fields, participants: 0, completedWeeks: 0 });
  const group = groups.get(key);
  group.participants++;
  group.completedWeeks += completedWeeks;
}

/** Aggregate effective records only; pending corrections never enter this input. */
export function buildParticipation(students) {
  if (!Array.isArray(students)) throw new TypeError('학생 목록은 배열이어야 합니다.');
  const program = summarizeProgram();
  const cohort = students.filter(student => student.participating === true);
  const weeks = WEEKS.map(week => ({
    week: week.week, name: week.title, participants: cohort.length, completed: 0,
    completionRate: null, pending: program.pendingWeeks.includes(week.week),
  }));
  const grades = new Map(), classes = new Map();
  const targets = new Map(Object.entries(targetLabels).map(([targetType, label]) => [
    targetType, { targetType, label, participants: 0, completedWeeks: 0 },
  ]));
  let completedWeeks = 0;
  for (const student of cohort) {
    const summary = summarizeProgram(student.records ?? []);
    completedWeeks += summary.completedWeeks;
    for (const [index, week] of summary.weeks.entries()) {
      if (week.complete === true) weeks[index].completed++;
    }
    const grade = student.grade ?? null, classNumber = student.classNumber ?? null;
    const gradeLabel = grade === null ? '학년 미지정' : `${grade}학년`;
    addToGroup(grades, grade, { grade, label: gradeLabel }, summary.completedWeeks);
    addToGroup(classes, JSON.stringify([grade, classNumber]), {
      grade, classNumber, label: `${gradeLabel} ${classNumber === null ? '반 미지정' : `${classNumber}반`}`,
    }, summary.completedWeeks);
    const targetType = student.targetType ?? null;
    addToGroup(targets, targetType, { targetType, label: targetLabels[targetType] ?? '대상 미지정' }, summary.completedWeeks);
  }
  for (const week of weeks) {
    week.completionRate = week.pending ? null : percentage(week.completed, week.participants);
  }
  const finishGroup = group => {
    const possibleWeeks = group.participants * program.totalWeeks;
    return { ...group, possibleWeeks, completionRate: percentage(group.completedWeeks, possibleWeeks) };
  };
  const possibleWeeks = cohort.length * program.totalWeeks;
  return {
    summary: {
      participants: cohort.length, completedWeeks, possibleWeeks,
      completionRate: percentage(completedWeeks, possibleWeeks),
      totalWeeks: program.totalWeeks, pendingWeeks: program.pendingWeeks,
    },
    weeks,
    grades: [...grades.values()].sort((a, b) => numberOrder(a.grade, b.grade)).map(finishGroup),
    classes: [...classes.values()].sort((a, b) => numberOrder(a.grade, b.grade) || numberOrder(a.classNumber, b.classNumber)).map(finishGroup),
    targets: [...targets.values()].map(finishGroup),
  };
}
