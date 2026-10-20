import React from 'react';
import { Icon } from '../shared.jsx';
import { dateText } from '../student-utils.js';
import { PhaseChip, periodText } from './ui.jsx';
import { TYPE_LABELS, goalText } from './form.js';

/** Read-only challenge view: the mobile detail screen and archived challenges on the web. */
export default function ChallengeDetail({ challenge, mode, children }) {
  const web = mode === 'web';
  const counts = challenge.counts || {};
  return <div className="ch-page">
    <div className="row gap8"><PhaseChip phase={challenge.phase} />{challenge.sourceChallengeId && <span className="chip line">양식에서 복사</span>}</div>
    <h1 className={web ? 'ch-title mt8' : 'page-title mt8'}>{challenge.title}</h1>
    {challenge.description && <p className="fs14 t2 mt8">{challenge.description}</p>}
    <div className="kv mt16">
      <div><span>기간</span><b>{periodText(challenge.startDate, challenge.endDate)}</b></div>
      <div><span>초대 마감</span><b>{challenge.enrollmentDeadline ? `${challenge.enrollmentDeadline.slice(0, 4)}년 ${dateText(challenge.enrollmentDeadline)}` : '—'}</b></div>
      <div><span>주차</span><b>{challenge.weekCount}개</b></div>
      <div><span>참여</span><b>확정 {counts.active ?? 0}명 · 대기 {counts.pending ?? 0}명 · 거절 {counts.declined ?? 0}명</b></div>
    </div>
    {children}
    <h2 className="fs16 fw8 mt24">주차 구성</h2>
    <div className="list mt12">{challenge.weeks.map(week => <div className="li ch-detail-week" key={week.id || week.week}>
      <span className="ch-dot" style={{ background: week.color }} aria-hidden="true" />
      <div className="grow">
        <div className="k">{week.week}주차 · {week.title}</div>
        <div className="sub">{dateText(week.startDate)}–{dateText(week.endDate)} · {TYPE_LABELS[week.inputType] || week.inputType}{goalText(week) && ` · ${goalText(week)}`}</div>
        {week.inputType === 'dumbbell' && week.exercises?.length > 0 && <div className="sub">{week.exercises.map(exercise => `${exercise.title} ${exercise.repetitions}회×${exercise.targetSets}세트`).join(', ')}</div>}
      </div>
    </div>)}</div>
    {!web && <div className="help mt16 ch-center"><Icon name="info" size={14} />챌린지 수정은 PC에서 할 수 있어요.</div>}
  </div>;
}
