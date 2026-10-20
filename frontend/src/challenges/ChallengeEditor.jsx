import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorNotice, Icon, Loading, Modal, navigate } from '../shared.jsx';
import { dateText } from '../student-utils.js';
import { archiveChallenge, createChallenge, deleteChallenge, getChallenge, publishChallenge, updateChallenge } from './index.js';
import { FormField, MockNotice, PhaseChip, periodText, useAction, useFeedback, useLoad } from './ui.jsx';
import { challengeToForm, emptyForm, errorMap, toBody } from './form.js';
import { addDays, daysBetween, isDate, shiftWeeks, validateChallenge } from './validate.js';
import WeekEditor from './WeekEditor.jsx';
import ChallengeDetail from './ChallengeDetail.jsx';

const LIST = '/web/admin/challenges';
const fullDate = date => isDate(date) ? `${date.slice(0, 4)}년 ${dateText(date)}` : '—';

/** Edit lock from README §4.1: weeks and dates only while draft or not yet started. */
export function lockFor(challenge) {
  if (!challenge) return 'none';
  if (challenge.lifecycle === 'archived') return 'all';
  if (challenge.lifecycle === 'published' && challenge.phase !== 'upcoming') return 'structure';
  return 'none';
}

function ConfirmDialog({ kind, challenge, busy, onConfirm, onClose }) {
  const copy = {
    publish: ['챌린지를 게시할까요?', '게시하면 학생에게 보이고 주차 구성은 시작 전까지만 바꿀 수 있어요.', '게시하기', 'primary'],
    archive: ['챌린지를 보관할까요?', '보관하면 더 이상 수정할 수 없고 목록의 보관함으로 옮겨져요. 기록과 참여 정보는 그대로 남아요.', '보관하기', 'dark'],
    delete: ['초안을 삭제할까요?', '삭제한 초안은 되돌릴 수 없어요.', '삭제하기', 'danger'],
  }[kind];
  return <Modal title={copy[0]} onClose={busy ? undefined : onClose} footer={<><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>취소</button><button type="button" className={`btn ${copy[3]}`} disabled={busy} onClick={onConfirm}>{busy ? '처리 중…' : copy[2]}</button></>}>
    <p className="fs14 t2"><b>{challenge.title}</b></p>
    <p className="fs14 t2 mt8">{copy[1]}</p>
  </Modal>;
}

export default function ChallengeEditor({ mode, id }) {
  const isNew = !id;
  // ?from=template|created is a one-shot hint from the previous screen; drop it from the URL so a reload doesn't repeat it.
  const [from] = useState(() => new URLSearchParams(window.location.search).get('from'));
  useEffect(() => { if (from) window.history.replaceState(window.history.state, '', window.location.pathname); }, []);
  const result = useLoad(() => isNew ? Promise.resolve({ challenge: null }) : getChallenge(id), [id]);
  const [challenge, setChallenge] = useState(null);
  const [form, setForm] = useState(() => isNew ? emptyForm() : null);
  const [baseline, setBaseline] = useState(() => isNew ? JSON.stringify(toBody(emptyForm())) : '');
  const [errors, setErrors] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [feedback, say] = useFeedback();
  const top = useRef(null);
  const [busy, run] = useAction(error => {
    setNotice(error);
    if (error.code === 'INVALID_CHALLENGE') { setErrors(errorMap(error.details)); setAttempted(true); }
    if (error.code === 'CHALLENGE_LOCKED' || error.code === 'CHALLENGE_ARCHIVED') result.refresh();
    top.current?.scrollIntoView?.({ block: 'start' });
  });

  useEffect(() => { if (result.data?.challenge) setChallenge(result.data.challenge); }, [result.data]);
  useEffect(() => {
    if (!challenge) return;
    const next = challengeToForm(challenge);
    setForm(next); setBaseline(JSON.stringify(toBody(next))); setErrors({}); setAttempted(false);
  }, [challenge]);
  useEffect(() => { if (from === 'created') say('초안을 저장했어요.'); }, []);

  const body = useMemo(() => form && toBody(form), [form]);
  const dirty = !!body && JSON.stringify(body) !== baseline;
  useEffect(() => { if (attempted && body) setErrors(errorMap(validateChallenge(body))); }, [body, attempted]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (result.loading && !challenge && !isNew) return <Loading />;
  if (result.error && !challenge) return <div className="ch-page"><BackLink /><div className="mt16"><ErrorNotice error={result.error} retry={result.refresh} /></div></div>;
  if (mode === 'mobile') return challenge ? <ChallengeDetail {...{ challenge, mode }} /> : <div className="ch-page"><p className="fs14 t2">챌린지 등록은 PC에서 할 수 있어요.</p></div>;
  if (!form) return <Loading />;

  const lock = lockFor(challenge);
  if (lock === 'all') return <><BackLink /><div className="mt16"><MockNotice /></div><div className="banner line mt16"><Icon name="info" />보관된 챌린지는 수정할 수 없어요. 양식으로 불러와 새 챌린지를 만들 수 있어요.</div><div className="mt20"><ChallengeDetail {...{ challenge, mode }} /></div>{feedback}</>;

  const editingStructure = lock === 'none';
  const set = patch => setForm(old => ({ ...old, ...patch }));
  const setWeeks = fn => setForm(old => ({ ...old, weeks: fn(old.weeks) }));
  const deadline = body.enrollmentDeadline;
  const endDate = body.endDate;
  const firstWeek = form.weeks[0];
  const canShift = editingStructure && isDate(form.startDate) && isDate(firstWeek?.startDate) && firstWeek.startDate !== form.startDate && form.weeks.every(row => isDate(row.startDate) && isDate(row.endDate));
  const activeDays = body.weeks.reduce((sum, week) => sum + (isDate(week.startDate) && isDate(week.endDate) && week.startDate <= week.endDate ? daysBetween(week.startDate, week.endDate) + 1 : 0), 0);
  const restDays = isDate(form.startDate) && isDate(endDate) && form.startDate <= endDate ? Math.max(0, daysBetween(form.startDate, endDate) + 1 - activeDays) : 0;

  function payload() {
    if (lock !== 'structure') return body;
    // After the start only title, description and week colours may change (README §4.1).
    const colors = body.weeks.map(week => week.color);
    const changed = challenge.weeks.some((week, index) => week.color.toUpperCase() !== colors[index]);
    return { title: body.title, description: body.description, ...(changed ? { weeks: challenge.weeks.map(({ id: _id, week: _week, ...week }, index) => ({ ...week, color: colors[index] })) } : {}) };
  }
  async function save() {
    setAttempted(true); setNotice(null);
    const found = validateChallenge(body);
    setErrors(errorMap(found));
    if (found.length) { say('입력 내용을 확인해 주세요.'); requestAnimationFrame(() => document.querySelector('.ch-editor [aria-invalid="true"], .ch-editor .banner.red')?.scrollIntoView({ block: 'center' })); return; }
    const data = await run(() => isNew ? createChallenge(body) : updateChallenge(id, payload()));
    if (!data) return;
    if (isNew) { setBaseline(JSON.stringify(body)); navigate(`${LIST}/${encodeURIComponent(data.challenge.id)}?from=created`, true); return; }
    setChallenge(data.challenge); say('저장했어요.');
  }
  async function act(kind) {
    setNotice(null);
    const call = { publish: publishChallenge, archive: archiveChallenge, delete: deleteChallenge }[kind];
    const data = await run(() => call(id));
    setDialog(null);
    if (!data) return;
    if (kind === 'delete') { navigate(LIST); return; }
    setChallenge(data.challenge);
    say(kind === 'publish' ? '게시했어요. 이제 학생을 등록하거나 초대할 수 있어요.' : '보관했어요.');
  }
  const changeStart = value => set({ startDate: value, ...(form.deadlineAuto ? { enrollmentDeadline: isDate(value) ? addDays(value, -1) : '' } : {}) });

  return <div className="ch-page ch-editor" ref={top}>
    <BackLink />
    <div className="w-title mt12">
      <div className="grow">
        <div className="row gap8">{challenge ? <PhaseChip phase={challenge.phase} /> : <span className="chip">새 초안</span>}{challenge?.sourceChallengeId && <span className="chip line">양식에서 복사</span>}{dirty && <span className="chip warn">저장 안 됨</span>}</div>
        <h1 className="mt8">{form.title.trim() || (isNew ? '새 챌린지' : challenge.title)}</h1>
        <p>{isDate(form.startDate) ? `${periodText(form.startDate, isDate(endDate) ? endDate : '')} · 주차 ${form.weeks.length}개 · 초대 마감 ${fullDate(deadline)}` : '시작일과 주차를 정하면 기간이 계산돼요.'}</p>
      </div>
      {challenge && <div className="row gap8">
        {challenge.lifecycle === 'draft' && <button type="button" className="btn ghost" disabled={busy} onClick={() => setDialog('delete')}>삭제</button>}
        {challenge.lifecycle === 'published' && <button type="button" className="btn secondary" disabled={busy} onClick={() => setDialog('archive')}>보관</button>}
        {challenge.lifecycle === 'draft' && <button type="button" className="btn primary" disabled={busy || dirty} title={dirty ? '저장한 뒤 게시할 수 있어요.' : undefined} onClick={() => setDialog('publish')}><Icon name="flag" size={18} />게시</button>}
      </div>}
    </div>
    <div className="stack gap12 mt16">
      <MockNotice />
      {from === 'template' && challenge?.lifecycle === 'draft' && <div className="banner g"><Icon name="history" /><span>양식에서 복사한 초안이에요. 주차 날짜를 새 시작일에 맞춰 옮겼어요. 내용을 확인한 뒤 게시하세요.</span></div>}
      {challenge?.lifecycle === 'draft' && dirty && <div className="banner line"><Icon name="info" /><span>게시하려면 먼저 변경 내용을 저장해 주세요.</span></div>}
      {challenge?.lifecycle === 'published' && challenge.phase === 'upcoming' && <div className="banner blue"><Icon name="calendar" /><span>게시된 챌린지예요. 시작일({dateText(challenge.startDate)}) 전까지 기간과 주차 구성을 바꿀 수 있어요.</span></div>}
      {lock === 'structure' && <div className="banner warn"><Icon name="lock" /><span>시작된 챌린지라 기간과 주차 구성은 바꿀 수 없어요. 제목·설명과 주차 색만 수정할 수 있어요.</span></div>}
      {notice && <ErrorNotice error={notice} />}
    </div>

    <section className="card pad ch-section mt20" aria-labelledby="ch-basic">
      <h2 id="ch-basic" className="fs16 fw8">기본 정보</h2>
      <div className="ch-basic-grid mt16">
        <FormField label="챌린지 제목" error={errors.title} className="ch-span-2"><div className={`input ch-input ${errors.title ? 'err' : ''}`}><input value={form.title} maxLength={60} placeholder="예: 2027 봄 챌린지" aria-invalid={!!errors.title} onChange={event => set({ title: event.target.value })} /></div></FormField>
        <FormField label="시작일" error={errors.startDate}><div className={`input ch-input ${errors.startDate ? 'err' : ''} ${editingStructure ? '' : 'disabled'}`}><input type="date" value={form.startDate} disabled={!editingStructure} aria-invalid={!!errors.startDate} onChange={event => changeStart(event.target.value)} /></div></FormField>
        <FormField label="초대 마감일" error={errors.enrollmentDeadline} hint={form.deadlineAuto ? '시작일 전날로 자동 설정돼요.' : '학생이 초대를 수락할 수 있는 마지막 날이에요.'}>
          <div className={`input ch-input ${errors.enrollmentDeadline ? 'err' : ''} ${editingStructure ? '' : 'disabled'}`}><input type="date" value={deadline || ''} disabled={!editingStructure} aria-invalid={!!errors.enrollmentDeadline} onChange={event => set({ enrollmentDeadline: event.target.value, deadlineAuto: false })} />{editingStructure && !form.deadlineAuto && isDate(form.startDate) && <button type="button" className="btn ghost sm" onClick={() => set({ deadlineAuto: true, enrollmentDeadline: addDays(form.startDate, -1) })}>전날로</button>}</div>
        </FormField>
        <FormField label="설명" error={errors.description} className="ch-span-full"><div className={`input area ch-input ${errors.description ? 'err' : ''}`}><textarea rows={2} value={form.description} maxLength={500} placeholder="학생 화면에 보일 한두 문장" aria-invalid={!!errors.description} onChange={event => set({ description: event.target.value })} /></div></FormField>
      </div>
      {errors.endDate && <div className="banner red mt12" role="alert"><Icon name="info" /><span>{errors.endDate}</span></div>}
      <p className="help mt12"><Icon name="calendar" size={14} />종료일은 마지막 주차의 종료일({fullDate(endDate)})로 정해져요.</p>
      {canShift && <div className="banner line mt12"><Icon name="calendar" /><span>1주차가 {dateText(firstWeek.startDate)}에 시작해요. 시작일({dateText(form.startDate)})에 맞춰 모든 주차를 같은 간격으로 옮길까요?</span><button type="button" className="btn secondary sm" onClick={() => setWeeks(rows => shiftWeeks(rows, rows[0].startDate, form.startDate))}>주차 날짜 옮기기</button></div>}
    </section>

    <section className="mt32" aria-labelledby="ch-weeks">
      <div className="row ch-section-head"><h2 id="ch-weeks" className="fs18 fw8 grow">주차 구성 <span className="muted fw7">{form.weeks.length}개</span></h2>{form.weeks.length > 0 && <span className="fs13 muted">활동 {activeDays}일{restDays ? ` · 쉬는 기간 ${restDays}일` : ''}</span>}</div>
      <div className="mt12"><WeekEditor weeks={form.weeks} setWeeks={setWeeks} errors={errors} challengeStart={form.startDate} lock={lock} /></div>
    </section>

    <div className="ch-savebar">
      <span className="fs13 grow">{busy ? '저장 중이에요…' : dirty ? '저장하지 않은 변경 사항이 있어요.' : isNew ? '제목, 시작일, 주차를 입력한 뒤 초안으로 저장해요.' : '모든 변경 사항이 저장됐어요.'}</span>
      {!isNew && dirty && <button type="button" className="btn ghost" disabled={busy} onClick={() => { const next = challengeToForm(challenge); setForm(next); setErrors({}); setAttempted(false); setNotice(null); }}>되돌리기</button>}
      <button type="button" className="btn primary" disabled={busy || (!isNew && !dirty)} onClick={save}>{busy ? '저장 중…' : isNew ? '초안 저장' : '저장'}</button>
    </div>
    {dialog && <ConfirmDialog kind={dialog} challenge={challenge} busy={busy} onClose={() => setDialog(null)} onConfirm={() => act(dialog)} />}
    {feedback}
  </div>;
}

function BackLink() {
  return <button type="button" className="btn ghost sm ch-back" onClick={() => navigate(LIST)}><Icon name="back" size={16} />챌린지 목록</button>;
}
