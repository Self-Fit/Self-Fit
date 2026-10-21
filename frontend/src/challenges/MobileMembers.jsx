import React from 'react';
import { ErrorNotice, Icon, Loading } from '../shared.jsx';
import { listMembers } from './index.js';
import { fitnessGradeLabel } from '../fitness-grades.js';
import { useLoad } from './ui.jsx';
import { MemberStats, ModeChip, StatusChip, enrollmentWindow } from './members.jsx';

/** Mobile teacher detail: read-only members and stats; adding/inviting happens on the PC screen. */
export default function MobileMembers({ challenge }) {
  const result = useLoad(() => listMembers(challenge.id), [challenge.id]);
  const members = result.data?.members || [];
  const { reason } = enrollmentWindow(challenge);
  return <section className="mt24" aria-labelledby="ch-mobile-members">
    <h2 id="ch-mobile-members" className="fs16 fw8">참여자</h2>
    {result.loading && !result.data ? <Loading /> : result.error ? <div className="mt12"><ErrorNotice error={result.error} retry={result.refresh} /></div> : <>
      <div className="mt12"><MemberStats stats={result.data.stats} compact /></div>
      {members.length ? <div className="list mt12">{members.map(member => <div className="li ch-member-li" key={member.id}>
        <div className="grow"><div className="k">{member.user.name}</div><div className="sub">{member.user.studentNumber} · {member.user.grade}학년 {member.user.classNumber}반</div><div className="sub">체력 {fitnessGradeLabel(member.user.fitnessGrade)}</div></div>
        <div className="ch-chip-stack"><ModeChip mode={member.mode} /><StatusChip status={member.status} /></div>
      </div>)}</div> : <p className="fs13 muted mt12">아직 참여자가 없어요.</p>}
    </>}
    {reason && <div className="help mt12"><Icon name="info" size={14} />{reason}</div>}
  </section>;
}
