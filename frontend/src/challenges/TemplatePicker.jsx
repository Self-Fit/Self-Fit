import React, { useState } from 'react';
import { ErrorNotice, Icon, Loading, Modal, navigate } from '../shared.jsx';
import { duplicateChallenge, listChallenges } from './index.js';
import { FormField, PhaseChip, periodText, useAction, useLoad } from './ui.jsx';
import { addDays, daysBetween, isDate } from './validate.js';

/** "양식으로 불러오기": copy an existing challenge's weeks into a new draft starting on another date. */
export default function TemplatePicker({ onClose }) {
  const result = useLoad(() => listChallenges({ lifecycle: 'all' }), []);
  const [selectedId, setSelectedId] = useState(null);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState(null);
  const [busy, run] = useAction(setError);
  const challenges = result.data?.challenges || [];
  const source = challenges.find(challenge => challenge.id === selectedId);
  const newEnd = source && isDate(startDate) ? addDays(source.endDate, daysBetween(source.startDate, startDate)) : '';
  const fieldError = path => error?.code === 'INVALID_CHALLENGE' ? error.details?.find(detail => detail.path === path)?.message : undefined;

  async function submit(event) {
    event.preventDefault();
    if (!source || !isDate(startDate)) return;
    setError(null);
    const data = await run(() => duplicateChallenge(source.id, { title: title.trim() || undefined, startDate }));
    if (data) navigate(`/web/admin/challenges/${encodeURIComponent(data.challenge.id)}?from=template`);
  }

  return <Modal title="양식으로 불러오기" onClose={busy ? undefined : onClose} footer={<>
    <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>취소</button>
    <button type="submit" form="ch-template-form" className="btn primary" disabled={busy || !source || !isDate(startDate)}>{busy ? '만드는 중…' : '초안 만들기'}</button>
  </>}>
    <form id="ch-template-form" className="stack gap16" onSubmit={submit}>
      <p className="fs13 muted">고른 챌린지의 제목·설명·주차 구성을 복사해 새 초안을 만들어요. 주차 날짜는 새 시작일에 맞춰 같은 간격으로 옮겨지고, 참여자와 기록은 복사하지 않아요.</p>
      {result.loading ? <Loading /> : result.error ? <ErrorNotice error={result.error} retry={result.refresh} /> : !challenges.length ? <p className="fs14 t2">불러올 챌린지가 없어요.</p>
        : <div className="list ch-template-list" role="radiogroup" aria-label="양식으로 쓸 챌린지">
          {challenges.map(challenge => <button type="button" role="radio" aria-checked={challenge.id === selectedId} key={challenge.id} className={`li link ${challenge.id === selectedId ? 'ch-picked' : ''}`} onClick={() => setSelectedId(challenge.id)}>
            <span className={`cbx ${challenge.id === selectedId ? 'on' : ''}`} aria-hidden="true">{challenge.id === selectedId && <Icon name="check" />}</span>
            <div className="grow"><div className="k">{challenge.title}</div><div className="sub">{periodText(challenge.startDate, challenge.endDate)} · {challenge.weekCount}주차</div></div>
            <PhaseChip phase={challenge.phase} />
          </button>)}
        </div>}
      {source && <>
        <FormField label="새 챌린지 제목" error={fieldError('title')} hint="비워 두면 원본 제목 뒤에 (복사)를 붙여요.">
          <div className="input ch-input"><input value={title} maxLength={60} disabled={busy} placeholder={`${source.title} (복사)`} onChange={event => setTitle(event.target.value)} /></div>
        </FormField>
        <FormField label="새 시작일" error={fieldError('startDate')}>
          <div className="input ch-input"><input type="date" required value={startDate} disabled={busy} onChange={event => setStartDate(event.target.value)} /></div>
        </FormField>
        {newEnd && <div className="banner g"><Icon name="calendar" /><span>새 기간 <b>{periodText(startDate, newEnd)}</b> · 주차 {source.weekCount}개 · 쉬는 기간도 원본과 같은 간격이에요.</span></div>}
      </>}
      {error && !fieldError('title') && !fieldError('startDate') && <ErrorNotice error={error} />}
    </form>
  </Modal>;
}
