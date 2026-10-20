import React, { useState } from 'react';
import { ErrorNotice, EmptyState, Icon, Loading, Modal, navigate } from '../shared.jsx';
import { addMembers, getChallenge, listMembers, listStudents, removeMember } from './index.js';
import { ChallengeTabs, MockNotice, PhaseChip, periodText, useAction, useFeedback, useLoad } from './ui.jsx';
import { MemberStats, ModeChip, SKIP_REASONS, StatusChip, TARGET_LABELS, enrollmentWindow, time } from './members.jsx';
import AddMembersDialog from './AddMembersDialog.jsx';

const STATUS_FILTERS = [['', '전체'], ['active', '참여 확정'], ['pending', '수락 대기'], ['declined', '거절'], ['removed', '제외됨']];
const blankFilters = { status: '', mode: '', grade: '', classNumber: '', search: '' };

function RemoveDialog({ member, challengeId, onClose, onRemoved }) {
  const [error, setError] = useState(null);
  const [busy, run] = useAction(setError);
  async function confirm() { setError(null); const data = await run(() => removeMember(challengeId, member.user.id)); if (data) onRemoved(member); }
  return <Modal title="참여자에서 제외할까요?" onClose={busy ? undefined : onClose} footer={<><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>취소</button><button type="button" className="btn danger" disabled={busy} onClick={confirm}>{busy ? '제외하는 중…' : '제외하기'}</button></>}>
    <p className="fs14 t2"><b>{member.user.name}</b>({member.user.studentNumber}) 학생을 이 챌린지에서 제외해요. {member.status === 'pending' ? '보낸 초대도 취소돼요.' : ''}</p>
    <p className="fs13 muted mt8">운동 기록이 있는 학생은 제외할 수 없어요. 다시 등록하거나 초대하면 참여할 수 있어요.</p>
    {error && <div className="mt12"><ErrorNotice error={error} /></div>}
  </Modal>;
}

export default function MemberManager({ mode, id }) {
  const [filters, setFilters] = useState(blankFilters);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [notice, setNotice] = useState(null);
  const [feedback, say] = useFeedback();
  const [busy, run] = useAction(setNotice);
  const challengeResult = useLoad(() => getChallenge(id), [id]);
  const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
  const membersResult = useLoad(() => listMembers(id, query), [id, JSON.stringify(query)]);
  const roster = useLoad(() => listStudents(), []);
  const challenge = challengeResult.data?.challenge;
  const members = membersResult.data?.members || [];
  const stats = membersResult.data?.stats;
  const students = roster.data?.students || [];
  const grades = [...new Set(students.map(student => student.grade))].sort((a, b) => a - b);
  const classes = [...new Set(students.filter(student => !filters.grade || String(student.grade) === filters.grade).map(student => student.classNumber))].sort((a, b) => a - b);
  const set = (key, value) => setFilters(old => ({ ...old, [key]: value, ...(key === 'grade' ? { classNumber: '' } : {}) }));
  const reload = () => { membersResult.refresh(); challengeResult.refresh(); };

  if (challengeResult.loading && !challenge) return <Loading />;
  if (challengeResult.error) return <div className="ch-page"><BackLink /><div className="mt16"><ErrorNotice error={challengeResult.error} retry={challengeResult.refresh} /></div></div>;
  const enrollment = enrollmentWindow(challenge);

  async function act(member, nextMode) {
    setNotice(null);
    const data = await run(() => addMembers(id, { mode: nextMode, studentIds: [member.user.id] }));
    if (!data) return;
    reload();
    if (data.skipped.length) say(`${member.user.name}: ${SKIP_REASONS[data.skipped[0].reason] || data.skipped[0].reason}`);
    else say(nextMode === 'forced' ? `${member.user.name} 학생을 강제 참여로 등록했어요.` : `${member.user.name} 학생을 다시 초대했어요.`);
  }
  const actions = member => {
    const invite = <button type="button" key="invite" className="btn ghost sm" disabled={busy || !enrollment.invite} title={enrollment.invite ? undefined : enrollment.reason} onClick={() => act(member, 'invited')}>재초대</button>;
    const force = <button type="button" key="force" className="btn ghost sm" disabled={busy || !enrollment.force} title={enrollment.force ? undefined : enrollment.reason} onClick={() => act(member, 'forced')}>{member.status === 'pending' ? '강제 전환' : '강제 등록'}</button>;
    const remove = <button type="button" key="remove" className="btn ghost sm ch-danger" disabled={busy} onClick={() => setRemoving(member)}>제외</button>;
    return { active: [remove], pending: [force, remove], declined: [invite, force, remove], removed: [invite, force] }[member.status] || [];
  };

  return <div className="ch-page">
    <BackLink />
    <div className="w-title mt12">
      <div className="grow"><PhaseChip phase={challenge.phase} /><h1 className="mt8">{challenge.title}</h1><p>{periodText(challenge.startDate, challenge.endDate)} · 초대 마감 {challenge.enrollmentDeadline.slice(5).replace('-', '/')}</p></div>
      <button type="button" className="btn primary" disabled={!enrollment.invite && !enrollment.force} title={enrollment.reason || undefined} onClick={() => setAdding(true)}><Icon name="plus" size={18} />학생 추가</button>
    </div>
    <ChallengeTabs id={id} current="members" memberCount={stats ? stats.active + stats.pending : undefined} />
    <div className="stack gap12 mt16">
      <MockNotice />
      {enrollment.reason && <div className="banner warn"><Icon name="info" /><span>{enrollment.reason}</span></div>}
      {notice && <ErrorNotice error={notice} />}
    </div>
    {stats && <div className="mt16"><MemberStats stats={stats} /></div>}
    <div className="filters mt20" role="group" aria-label="참여자 필터">
      <label className="search"><Icon name="search" size={18} /><input aria-label="이름 또는 학번 검색" placeholder="이름 또는 학번 검색" value={filters.search} onChange={event => set('search', event.target.value)} /></label>
      <div className="ch-select ch-filter-select"><select aria-label="학년" value={filters.grade} onChange={event => set('grade', event.target.value)}><option value="">전 학년</option>{grades.map(grade => <option key={grade} value={grade}>{grade}학년</option>)}</select><Icon name="chevron" size={16} /></div>
      <div className="ch-select ch-filter-select"><select aria-label="반" value={filters.classNumber} onChange={event => set('classNumber', event.target.value)}><option value="">전체 반</option>{classes.map(number => <option key={number} value={number}>{number}반</option>)}</select><Icon name="chevron" size={16} /></div>
      <div className="seg" role="group" aria-label="참여 방식">{[['', '전체'], ['forced', '강제'], ['invited', '초대']].map(([value, label]) => <button type="button" key={value} className={filters.mode === value ? 'on' : ''} aria-pressed={filters.mode === value} onClick={() => set('mode', value)}>{label}</button>)}</div>
    </div>
    <div className="pills mt12" role="group" aria-label="참여 상태">{STATUS_FILTERS.map(([value, label]) => <button type="button" key={value} className={filters.status === value ? 'on' : ''} aria-pressed={filters.status === value} onClick={() => set('status', value)}>{label}</button>)}</div>
    {membersResult.loading && !membersResult.data ? <Loading /> : membersResult.error ? <div className="mt16"><ErrorNotice error={membersResult.error} retry={membersResult.refresh} /></div>
      : !members.length ? <div className="card mt16"><EmptyState title={Object.keys(query).length ? '조건에 맞는 참여자가 없어요.' : '아직 참여자가 없어요.'} action={!Object.keys(query).length && (enrollment.invite || enrollment.force) ? <button type="button" className="btn primary mt16" onClick={() => setAdding(true)}><Icon name="plus" size={18} />학생 추가</button> : null}>{Object.keys(query).length ? '검색어나 필터를 바꿔 보세요.' : enrollment.reason || '학년·반 조건이나 명단에서 학생을 골라 등록하거나 초대하세요.'}</EmptyState></div>
        : <div className="tbl-wrap mt12 table-scroll"><table className="tbl"><thead><tr><th>이름</th><th>학번</th><th>학년 · 반</th><th>구분</th><th>방식</th><th>상태</th><th>초대일</th><th>응답일</th><th className="r">관리</th></tr></thead><tbody>
          {members.map(member => <tr key={member.id}>
            <td className="who"><b>{member.user.name}</b></td><td className="num-font">{member.user.studentNumber}</td><td>{member.user.grade}학년 {member.user.classNumber}반</td>
            <td><span className={`chip ${member.user.targetType === 'required' ? 'g' : ''}`}>{TARGET_LABELS[member.user.targetType] || '—'}</span></td>
            <td><ModeChip mode={member.mode} /></td><td><StatusChip status={member.status} /></td>
            <td className="muted fs13">{time(member.invitedAt)}</td><td className="muted fs13">{time(member.respondedAt)}</td>
            <td className="r"><div className="row gap4 ch-row-actions">{actions(member)}</div></td>
          </tr>)}
        </tbody></table><div className="pager"><span>{members.length}명</span></div></div>}
    {adding && <AddMembersDialog challenge={challenge} onClose={() => setAdding(false)} onDone={reload} />}
    {removing && <RemoveDialog member={removing} challengeId={id} onClose={() => setRemoving(null)} onRemoved={member => { setRemoving(null); reload(); say(`${member.user.name} 학생을 제외했어요.`); }} />}
    {feedback}
  </div>;
}

function BackLink() {
  return <button type="button" className="btn ghost sm ch-back" onClick={() => navigate('/web/admin/challenges')}><Icon name="back" size={16} />챌린지 목록</button>;
}
