import React from 'react';
import { dateText } from '../student-utils.js';

export const MODE_LABELS = { forced: '강제 등록', invited: '초대' };
export const STATUS = { active: ['참여 확정', 'g'], pending: ['수락 대기', 'warn'], declined: ['거절', 'red'], removed: ['제외됨', 'line'] };
export const SKIP_REASONS = { already_active: '이미 참여 중', already_pending: '이미 초대 대기 중', not_found: '찾을 수 없는 학생', not_student: '학생 계정이 아님' };
export const TARGET_LABELS = { required: '필수', optional: '선택' };

export function ModeChip({ mode }) { return <span className={`chip ${mode === 'forced' ? 'dark' : 'blue'}`}>{MODE_LABELS[mode] || mode}</span>; }
export function StatusChip({ status }) { const [label, tone] = STATUS[status] || [status, '']; return <span className={`chip ${tone}`}>{label}</span>; }

export const time = value => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fullDate = date => `${date.slice(0, 4)}년 ${dateText(date)}`;

/**
 * Who can still be added (contract: POST …/members → CHALLENGE_NOT_PUBLISHED / ENROLLMENT_CLOSED).
 * Uses the server's `today` from the challenge, never the browser clock.
 */
export function enrollmentWindow(challenge) {
  if (!challenge) return { invite: false, force: false, reason: '' };
  if (challenge.lifecycle === 'draft') return { invite: false, force: false, reason: '게시한 뒤에 학생을 등록하거나 초대할 수 있어요.' };
  if (challenge.lifecycle === 'archived') return { invite: false, force: false, reason: '보관된 챌린지에는 학생을 추가할 수 없어요.' };
  const invite = challenge.today <= challenge.enrollmentDeadline, force = challenge.today <= challenge.endDate;
  const reason = !force ? `챌린지가 끝나(${fullDate(challenge.endDate)}) 더 이상 등록할 수 없어요.`
    : !invite ? `초대 마감일(${fullDate(challenge.enrollmentDeadline)})이 지나 초대는 보낼 수 없어요. 강제 등록은 종료일(${fullDate(challenge.endDate)})까지 할 수 있어요.` : '';
  return { invite, force, reason, inviteUntil: fullDate(challenge.enrollmentDeadline), forceUntil: fullDate(challenge.endDate) };
}

export function MemberStats({ stats, compact = false }) {
  const items = [['참여 확정', stats.active, 'g'], ['수락 대기', stats.pending], ['거절', stats.declined], ['강제 등록', stats.forced], ['초대', stats.invited]];
  if (compact) return <div className="ch-mini-stats">{items.map(([label, value]) => <div key={label}><span>{label}</span><b>{value ?? 0}</b></div>)}</div>;
  return <div className="stats ch-stats">{items.map(([label, value, tone]) => <div className="stat" key={label}><div className="l">{label}</div><div className={`v ${tone || ''}`}>{value ?? 0}<small>명</small></div></div>)}</div>;
}
