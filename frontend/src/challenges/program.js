// Existing teacher/student screens were written against the legacy `/program` shape
// ({today,status,weeks,activityDates,startDate,endDate,...}). Challenge-scoped endpoints return a
// `Challenge` instead; programOf() maps one onto the other so those screens keep working.
const STATUS = { upcoming: 'upcoming', active: 'active', rest: 'rest', ended: 'ended', archived: 'ended' };

export function programOf(challenge) {
  if (!challenge) return null;
  return {
    challengeId: challenge.id, title: challenge.title, year: challenge.year, today: challenge.today,
    status: STATUS[challenge.phase] || 'upcoming', startDate: challenge.startDate, endDate: challenge.endDate,
    weeks: challenge.weeks || [], activityDates: challenge.activityDates || [], week12Pending: false,
  };
}

/** True when there are rest days between this week and the next one. */
export function restAfter(weeks, index) {
  const next = weeks[index + 1];
  if (!next) return false;
  const gap = (Date.parse(`${next.startDate}T00:00:00Z`) - Date.parse(`${weeks[index].endDate}T00:00:00Z`)) / 86_400_000;
  return gap > 1;
}
