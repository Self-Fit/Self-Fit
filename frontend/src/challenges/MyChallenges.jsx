import React, { useState } from 'react';
import { AppFrame, EmptyState, ErrorNotice, Icon, Loading, Modal, navigate } from '../shared.jsx';
import { StudentPage } from '../student-ui.jsx';
import { dateText } from '../student-utils.js';
import { acceptInvitation, declineInvitation, getStudentChallenge, listMyChallenges } from './index.js';
import { MockNotice, PhaseChip, periodText, toast, useAction, useLoad } from './ui.jsx';
import { TYPE_LABELS, goalText } from './form.js';
import { selectChallenge, selectedChallengeId, switchable } from './student.js';
import '../challenges.css';

const fullDate = date => `${date.slice(0, 4)}년 ${dateText(date)}`;
const closed = item => item.challenge.today > item.challenge.enrollmentDeadline;

function Weeks({ id }) {
  const result = useLoad(() => getStudentChallenge(id), [id]);
  if (result.loading) return <Loading message="주차를 불러오는 중이에요." />;
  if (result.error) return <ErrorNotice error={result.error} retry={result.refresh} />;
  return <ol className="list ch-student-weeks">{result.data.challenge.weeks.map(week => <li className="li" key={week.id || week.week}>
    <span className="ch-dot" style={{ background: week.color }} aria-hidden="true" />
    <div className="grow"><div className="k">{week.week}주차 · {week.title}</div><div className="sub">{dateText(week.startDate)}–{dateText(week.endDate)} · {TYPE_LABELS[week.inputType] || week.inputType}{goalText(week) && ` · ${goalText(week)}`}</div></div>
  </li>)}</ol>;
}

function InvitationCard({ item, busy, onAccept, onDecline }) {
  const [open, setOpen] = useState(false);
  const { challenge } = item, isClosed = closed(item);
  return <article className={`card pad ch-invite ${isClosed ? 'is-closed' : ''}`} aria-labelledby={`invite-${challenge.id}`}>
    <div className="row gap8"><span className="chip blue">초대</span><PhaseChip phase={challenge.phase} /></div>
    <h3 id={`invite-${challenge.id}`} className="ch-invite-title">{challenge.title}</h3>
    {challenge.description && <p className="fs14 t2 mt4">{challenge.description}</p>}
    <div className="kv mt12">
      <div><span>기간</span><b>{periodText(challenge.startDate, challenge.endDate)}</b></div>
      <div><span>주차</span><b>{challenge.weekCount}개</b></div>
      <div><span>수락 마감</span><b className={isClosed ? 'rtext' : ''}>{fullDate(challenge.enrollmentDeadline)}까지</b></div>
    </div>
    <button type="button" className="btn ghost sm mt8 ch-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>주차별 운동 {open ? '접기' : '보기'}<Icon name="chevron" size={14} style={{ transform: `rotate(${open ? -90 : 90}deg)` }} /></button>
    {open && <div className="mt8"><Weeks id={challenge.id} /></div>}
    {isClosed ? <div className="banner line mt12"><Icon name="info" /><span>수락 기간이 지났어요. 참여하려면 선생님께 말씀해 주세요.</span></div>
      : <div className="row gap8 mt16"><button type="button" className="btn secondary grow" disabled={busy} onClick={() => onDecline(item)}>거절</button><button type="button" className="btn primary grow" disabled={busy} onClick={() => onAccept(item)}>{busy ? '처리 중…' : '수락하기'}</button></div>}
  </article>;
}

function ChallengeRow({ item, selected }) {
  const { challenge, membership } = item;
  const how = membership.mode === 'forced' ? '선생님이 등록했어요' : membership.respondedAt ? `${dateText(new Date(membership.respondedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }))}에 초대를 수락했어요` : '초대를 수락했어요';
  return <div className="li ch-mine">
    <div className="grow">
      <div className="row gap8"><PhaseChip phase={challenge.phase} />{selected && <span className="chip line">보고 있는 챌린지</span>}</div>
      <div className="k mt8">{challenge.title}</div>
      <div className="sub">{periodText(challenge.startDate, challenge.endDate)} · {challenge.weekCount}주차 · {how}</div>
    </div>
  </div>;
}

/** /{mode}/challenges: invitations to accept or decline, current and past challenges, and the challenge switcher. */
export default function MyChallenges({ mode, user, onLogout, onChange }) {
  const result = useLoad(() => listMyChallenges(), []);
  const [declining, setDeclining] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, run] = useAction(error => { setNotice(error); if (error.code === 'INVITATION_CLOSED' || error.code === 'NO_INVITATION') result.refresh(); });
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('current');
  const mine = result.data;
  const selected = selectedId || (mine && selectedChallengeId(mine));
  const reload = () => { result.refresh(); onChange?.(); };

  async function accept(item) {
    setNotice(null);
    if (await run(() => acceptInvitation(item.challenge.id))) { reload(); toast('참여가 확정됐어요.'); }
  }
  async function decline() {
    setNotice(null);
    const item = declining;
    const data = await run(() => declineInvitation(item.challenge.id));
    setDeclining(null);
    if (data) { reload(); toast('초대를 거절했어요.'); }
  }
  function choose(id) { selectChallenge(id); setSelectedId(id); toast('보고 있는 챌린지를 바꿨어요.'); }
  function openArchived(id) { selectChallenge(id); onChange?.(); navigate(`/${mode}`); }

  let body;
  if (result.loading && !mine) body = <Loading />;
  else if (result.error && !mine) body = <ErrorNotice error={result.error} retry={result.refresh} />;
  else {
    const invitations = mine.invitations || [];
    const items = mine.challenges || [];
    const active = items.filter(item => item.membership.status === 'active');
    const ongoing = active.filter(item => item.challenge.phase !== 'ended');
    const past = active.filter(item => item.challenge.phase === 'ended');
    const closedInvites = mine.closedInvitations || [];
    const archived = mine.archived || [];
    const options = switchable(mine);
    const section = (title, count, children) => <section className="ch-student-section" aria-label={title}><h2 className="fs16 fw8">{title} <span className="muted fw7">{count}</span></h2><div className="mt12">{children}</div></section>;
    const tabs = archived.length > 0 && <div className="seg ch-student-tabs" role="tablist" aria-label="내 챌린지 보기">
      <button type="button" role="tab" aria-selected={tab === 'current'} className={tab === 'current' ? 'on' : ''} onClick={() => setTab('current')}>챌린지</button>
      <button type="button" role="tab" aria-selected={tab === 'archived'} className={tab === 'archived' ? 'on' : ''} onClick={() => setTab('archived')}>보관함 <span className="n">{archived.length}</span></button>
    </div>;
    if (tab === 'archived' && archived.length) body = <div className="stack gap24">
      <MockNotice />
      {tabs}
      <section className="ch-student-section" aria-label="보관된 챌린지">
        <p className="fs13 muted">선생님이 보관한 챌린지예요. 기록을 볼 수만 있고 새로 입력하거나 정정할 수는 없어요.</p>
        <div className="list mt12">{archived.map(item => <div className="li ch-mine" key={item.challenge.id}>
          <div className="grow"><div className="row gap8"><PhaseChip phase="archived" />{item.challenge.id === selected && <span className="chip line">보고 있는 챌린지</span>}</div><div className="k mt8">{item.challenge.title}</div><div className="sub">{periodText(item.challenge.startDate, item.challenge.endDate)} · {item.challenge.weekCount}주차</div></div>
          <button type="button" className="btn secondary sm" onClick={() => openArchived(item.challenge.id)}>기록 보기</button>
        </div>)}</div>
      </section>
    </div>;
    else body = <div className="stack gap24">
      <MockNotice />
      {tabs}
      {notice && <ErrorNotice error={notice} />}
      {options.length > 1 && <label className="card pad ch-switch"><span className="fw7 fs14">보고 있는 챌린지</span><div className="ch-select"><select value={selected || ''} onChange={event => choose(event.target.value)}>{options.map(item => <option key={item.challenge.id} value={item.challenge.id}>{item.challenge.title}</option>)}</select><Icon name="chevron" size={16} /></div><span className="help">홈과 기록 화면에 보일 챌린지예요.</span></label>}
      {invitations.length > 0 && section('받은 초대', invitations.length, <div className="stack gap12">{invitations.map(item => <InvitationCard key={item.challenge.id} {...{ item, busy }} onAccept={accept} onDecline={setDeclining} />)}</div>)}
      {section('참여 중', ongoing.length, ongoing.length ? <div className="list">{ongoing.map(item => <ChallengeRow key={item.challenge.id} item={item} selected={item.challenge.id === selected} />)}</div> : <p className="fs14 muted">지금 참여 중인 챌린지가 없어요.{invitations.length ? ' 받은 초대를 확인해 보세요.' : ''}</p>)}
      {closedInvites.length > 0 && section('마감된 초대', closedInvites.length, <div className="stack gap12">{closedInvites.map(item => <InvitationCard key={item.challenge.id} {...{ item, busy }} onAccept={accept} onDecline={setDeclining} />)}</div>)}
      {past.length > 0 && section('지난 챌린지', past.length, <div className="list">{past.map(item => <ChallengeRow key={item.challenge.id} item={item} selected={item.challenge.id === selected} />)}</div>)}
      {!invitations.length && !items.length && !closedInvites.length && !archived.length && <div className="card"><EmptyState title="아직 챌린지가 없어요.">선생님이 챌린지에 등록하거나 초대하면 여기에서 확인할 수 있어요.</EmptyState></div>}
    </div>;
  }
  return <AppFrame {...{ mode, user, onLogout }} title={mode === 'mobile' ? '내 챌린지' : undefined} back={mode === 'mobile' ? () => navigate(`/${mode}`) : undefined}>
    <StudentPage mode={mode} title={mode === 'web' ? '내 챌린지' : undefined} subtitle="받은 초대를 수락하거나 거절하고, 참여 중인 챌린지를 확인해요.">
      {body}
    </StudentPage>
    {declining && <Modal title="초대를 거절할까요?" onClose={busy ? undefined : () => setDeclining(null)} footer={<><button type="button" className="btn secondary" disabled={busy} onClick={() => setDeclining(null)}>취소</button><button type="button" className="btn danger" disabled={busy} onClick={decline}>{busy ? '처리 중…' : '거절하기'}</button></>}>
      <p className="fs14 t2"><b>{declining.challenge.title}</b> 초대를 거절해요. 거절한 뒤에는 선생님이 다시 초대해야 참여할 수 있어요.</p>
    </Modal>}
  </AppFrame>;
}
