import { isDumbbell, dumbbellSummary, dumbbellValueLabel } from './dumbbell-values.js';
export const weekdays = ['일','월','화','수','목','금','토'];
export function dateText(value, long = false) { if (!value) return ''; const [y,m,d] = value.split('-').map(Number); return long ? `${m}월 ${d}일 ${weekdays[new Date(Date.UTC(y,m-1,d)).getUTCDay()]}요일` : `${m}/${d}`; }
export function dateRange(start, end) { const result=[]; for (let day = new Date(`${start}T00:00:00Z`); day.toISOString().slice(0,10) <= end; day.setUTCDate(day.getUTCDate()+1)) result.push(day.toISOString().slice(0,10)); return result; }
export function shiftDate(date, amount) { const value=new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate()+amount); return value.toISOString().slice(0,10); }
export const dayIndex = date => new Date(`${date}T00:00:00Z`).getUTCDay();
export const formatNumber = value => { const number=Number(value ?? 0); return number!==0&&Math.abs(number)<1e-6 ? String(number) : new Intl.NumberFormat('ko-KR', { maximumSignificantDigits: 21 }).format(number); };
export const summaryOf = (summary, week) => (summary?.weeks || []).find(item => Number(item.week) === Number(week)) || {};
export const recordOf = (records, date) => (records || []).find(record => record.date === date);
export function valueLabel(week, value) {
  if (value === null || value === undefined) return '미입력';
  if (isDumbbell(week)) return dumbbellValueLabel(week, value);
  if (week.inputType === 'walking') return ['0–1,999보','2,000–3,999보','4,000–5,999보','6,000–7,999보','8,000–9,999보','10,000보 이상'][value] || '미입력';
  if (week.inputType === 'check') return value ? '했어요' : '안 했어요';
  return `${formatNumber(value)}${week.unit || ''}`;
}
export function weekLabel(week, summary, today) {
  if (week.deferred) return '세부 운동 확인 중';
  if (today < week.startDate) return `${dateText(week.startDate)}부터`;
  if (summary.complete) return `완료 · ${formatNumber(summary.total)} / ${formatNumber(week.weeklyTarget)}${week.unit}`;
  return `${today <= week.endDate ? '이번 주' : '미완료'} · ${formatNumber(summary.total)} / ${formatNumber(week.weeklyTarget)}${week.unit}`;
}
export function statusLabel(status) { return ({future:'예정',missing:'미입력',achieved:'목표 달성',below_target:'목표 미달',recorded:'기록 있음',zero:'0 기록',pending:'확인 중',inactive:'활동일 아님',invalid:'확인 필요'})[status] || status; }
export const programLabel = program => ({upcoming:'시작 전',active:'진행 중',rest:'쉬는 기간',ended:'챌린지 종료'})[program?.status] || '';

export function dailyAchieved(week, value) { return isDumbbell(week) ? dumbbellSummary(week, value).complete : week.inputType === 'walking' ? value === 5 : week.inputType === 'check' ? value === true : week.dailyTarget ? Number(value) >= week.dailyTarget : Number(value) > 0; }
