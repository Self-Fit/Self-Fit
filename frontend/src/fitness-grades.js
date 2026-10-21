export const FITNESS_GRADES = [1, 2, 3, 4, 5];
export const isFitnessGrade = value => Number.isInteger(value) && FITNESS_GRADES.includes(value);
export const fitnessGradeLabel = value => isFitnessGrade(value) ? `${value}등급` : '미등록';

const period = item => Number.isInteger(item?.year) && [1, 2].includes(item?.semester) ? item.year * 2 + item.semester : null;

/** The account's current assessment is authoritative; history supplies the preceding semester. */
export function fitnessComparison(user, history = []) {
  const current = isFitnessGrade(user?.fitnessGrade) ? { year: user.fitnessGradeYear, semester: user.fitnessGradeSemester, grade: user.fitnessGrade } : null;
  const currentPeriod = period(current);
  const previous = [...history].filter(item => isFitnessGrade(item?.grade) && period(item) !== null && (currentPeriod === null || period(item) < currentPeriod))
    .sort((a, b) => period(b) - period(a))[0] || null;
  return { current, previous };
}

/** Shared by the mock list and bulk selection, with fitness grade separate from school grade. */
export function matchesFitnessGrade(user, filters = {}) {
  if (filters.fitnessGrade === 'unmeasured') return !isFitnessGrade(user.fitnessGrade);
  if (filters.fitnessGrade !== undefined && filters.fitnessGrade !== '') return user.fitnessGrade === Number(filters.fitnessGrade);
  return filters.fitnessGrades === undefined || filters.fitnessGrades.includes(user.fitnessGrade);
}
