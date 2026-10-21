import { isFitnessGrade, matchesFitnessGrade } from '../fitness-grades.js';

export function matchesMemberFilters(user, filters = {}) {
  if (filters.grade !== undefined && filters.grade !== '' && String(user.grade) !== String(filters.grade)) return false;
  if (filters.classNumber !== undefined && filters.classNumber !== '' && String(user.classNumber) !== String(filters.classNumber)) return false;
  if (filters.targetType && user.targetType !== filters.targetType) return false;
  return matchesFitnessGrade(user, filters);
}

export const validFitnessSelection = filters => filters.fitnessGrades === undefined || (Array.isArray(filters.fitnessGrades) && filters.fitnessGrades.length > 0 && filters.fitnessGrades.every(isFitnessGrade));

/** Empty grade selection means all grades; never send the contract's invalid empty array. */
export function buildMemberSelection(by, filters, picked) {
  if (by === 'ids') return { studentIds: [...new Set(picked)] };
  const result = {};
  for (const key of ['grade', 'classNumber']) if (filters[key] !== '' && filters[key] !== undefined) result[key] = Number(filters[key]);
  if (filters.fitnessGrades?.length) {
    if (!filters.fitnessGrades.every(isFitnessGrade)) throw new TypeError('체력등급을 확인해 주세요.');
    result.fitnessGrades = [...new Set(filters.fitnessGrades)].sort((a, b) => a - b);
  }
  return { filters: result };
}

/** Invalidate on selection changes and unmount, including the A → B → A race. */
export function createSelectionPreview() {
  let revision = 0;
  return {
    invalidate() { revision += 1; },
    async load(key, request) {
      const issued = ++revision;
      try {
        const data = await request();
        return issued === revision ? { key, data } : null;
      } catch (error) {
        return issued === revision ? { key, error } : null;
      }
    },
  };
}
