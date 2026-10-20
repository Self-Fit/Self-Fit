const numberFormat = new Intl.NumberFormat('ko-KR');
export const isDumbbell = week => week?.inputType === 'dumbbell';
export const dumbbellExercises = week => Array.isArray(week?.exercises) ? week.exercises : [];
const present = value => value !== null && value !== undefined && value !== '';
const validSets = value => present(value) && ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
export function normalizeDumbbellValue(week, value) {
  return Object.fromEntries(dumbbellExercises(week).map(exercise => [exercise.id, present(value?.[exercise.id]) ? Number(value[exercise.id]) : null]));
}
export function validateDumbbellValue(week, value) {
  const exercises = dumbbellExercises(week);
  if (!exercises.length) return '운동별 기준을 확인할 수 없어요. 새로고침 후 다시 시도해 주세요.';
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '한 종목 이상 완료한 세트 수를 입력해 주세요.';
  if (!exercises.some(exercise => present(value[exercise.id]))) return '한 종목 이상 완료한 세트 수를 입력해 주세요.';
  if (exercises.some(exercise => present(value[exercise.id]) && !validSets(value[exercise.id]))) return '완료 세트는 0 이상의 정수로 입력해 주세요.';
  return null;
}
export function dumbbellSummary(week, value) {
  const exercises = dumbbellExercises(week);
  const rows = exercises.map(exercise => ({ ...exercise, sets: validSets(value?.[exercise.id]) ? Number(value[exercise.id]) : null }));
  const recorded = rows.filter(row => row.sets !== null);
  const completed = rows.filter(row => row.sets !== null && row.sets >= row.targetSets).length;
  const totalSets = recorded.reduce((sum, row) => sum + BigInt(row.sets), 0n);
  const repetitions = recorded.reduce((sum, row) => sum + BigInt(row.sets) * BigInt(row.repetitions), 0n);
  return { rows, total: rows.length, recorded: recorded.length, missing: rows.length - recorded.length, completed,
    complete: rows.length > 0 && completed === rows.length, hasAny: recorded.length > 0,
    zero: rows.length > 0 && recorded.length === rows.length && recorded.every(row => row.sets === 0), totalSets, repetitions,
    progress: rows.length ? rows.reduce((sum, row) => sum + (row.sets === null ? 0 : Math.min(1, row.sets / row.targetSets)), 0) / rows.length : 0 };
}
export function dumbbellValueLabel(week, value) {
  const summary = dumbbellSummary(week, value);
  return summary.hasAny ? `${summary.completed}/${summary.total}종목 완료 · ${numberFormat.format(summary.totalSets)}세트` : '미입력';
}
export function dumbbellExerciseLabel(exercise, sets) {
  return sets === null ? '미입력' : `${numberFormat.format(sets)} / ${exercise.targetSets}세트 · ${numberFormat.format(BigInt(sets) * BigInt(exercise.repetitions))}회`;
}

export function dumbbellValueText(week, value) { return dumbbellSummary(week, value).rows.map(exercise => `${exercise.title}: ${exercise.sets === null ? '미입력' : `${numberFormat.format(exercise.sets)}세트`}`).join('\n'); }
