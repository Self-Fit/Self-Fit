import React, { useState } from 'react';
import { EmptyState, ErrorNotice, Icon, Loading, navigate } from '../shared.jsx';
import { listChallenges } from './index.js';
import { MockNotice, PhaseChip, periodText, useLoad } from './ui.jsx';
import TemplatePicker from './TemplatePicker.jsx';

const FILTERS = [['all', '전체'], ['draft', '초안'], ['published', '진행'], ['archived', '보관']];
const countText = counts => `참여 ${counts?.active ?? 0}명 · 대기 ${counts?.pending ?? 0}명`;

function ChallengeCard({ challenge, mode }) {
  const open = () => navigate(`/${mode}/admin/challenges/${encodeURIComponent(challenge.id)}`);
  return <button type="button" className="card ch-card" onClick={open}>
    <div className="row gap8"><PhaseChip phase={challenge.phase} />{challenge.sourceChallengeId && <span className="chip line">양식에서 복사</span>}<Icon name="chevron" size={18} className="ch-card-chev" /></div>
    <h3 className="ch-card-title">{challenge.title}</h3>
    {challenge.description && <p className="ch-card-desc">{challenge.description}</p>}
    <dl className="ch-card-meta">
      <div><dt>기간</dt><dd>{periodText(challenge.startDate, challenge.endDate)}</dd></div>
      <div><dt>주차</dt><dd>{challenge.weekCount}개</dd></div>
      <div><dt>참여</dt><dd>{countText(challenge.counts)}</dd></div>
    </dl>
  </button>;
}

export default function ChallengeList({ mode }) {
  const web = mode === 'web';
  const [lifecycle, setLifecycle] = useState('all');
  const [picking, setPicking] = useState(false);
  const result = useLoad(() => listChallenges({ lifecycle }), [lifecycle]);
  const challenges = result.data?.challenges || [];
  const filterLabel = FILTERS.find(([value]) => value === lifecycle)[1];

  return <div className="ch-page">
    <div className={web ? 'w-title' : ''}>
      <div className="grow"><h1 className={web ? '' : 'page-title'}>챌린지</h1>{web && <p>챌린지 기간과 주차별 운동을 만들고, 지난 챌린지를 양식으로 다시 써요.</p>}</div>
      {web && <div className="row gap8"><button type="button" className="btn secondary" onClick={() => setPicking(true)}><Icon name="history" size={18} />양식으로 불러오기</button><button type="button" className="btn primary" onClick={() => navigate('/web/admin/challenges/new')}><Icon name="plus" size={18} />새 챌린지</button></div>}
    </div>
    <MockNotice />
    <div className="pills ch-filters" role="group" aria-label="챌린지 상태">
      {FILTERS.map(([value, label]) => <button type="button" key={value} className={lifecycle === value ? 'on' : ''} aria-pressed={lifecycle === value} onClick={() => setLifecycle(value)}>{label}</button>)}
    </div>
    {result.loading && !result.data ? <Loading /> : result.error ? <div className="mt16"><ErrorNotice error={result.error} retry={result.refresh} /></div> : !challenges.length
      ? <div className="card mt16"><EmptyState title={lifecycle === 'all' ? '아직 만든 챌린지가 없어요.' : `${filterLabel} 상태인 챌린지가 없어요.`} action={web && lifecycle === 'all' ? <button type="button" className="btn primary mt16" onClick={() => navigate('/web/admin/challenges/new')}><Icon name="plus" size={18} />새 챌린지</button> : null}>{web ? '새 챌린지를 만들거나 지난 챌린지를 양식으로 불러오세요.' : '챌린지는 PC에서 만들 수 있어요.'}</EmptyState></div>
      : web ? <div className="ch-grid mt16">{challenges.map(challenge => <ChallengeCard key={challenge.id} {...{ challenge, mode }} />)}</div>
        : <div className="list mt16">{challenges.map(challenge => <button type="button" key={challenge.id} className="li link ch-li" onClick={() => navigate(`/mobile/admin/challenges/${encodeURIComponent(challenge.id)}`)}>
          <div className="grow"><div className="k">{challenge.title}</div><div className="sub">{periodText(challenge.startDate, challenge.endDate)} · {challenge.weekCount}주차</div><div className="sub">{countText(challenge.counts)}</div></div>
          <PhaseChip phase={challenge.phase} /><Icon name="chevron" size={18} className="chev" />
        </button>)}</div>}
    {!web && <div className="help mt16 ch-center">챌린지 등록과 수정은 PC에서 할 수 있어요.</div>}
    {picking && <TemplatePicker onClose={() => setPicking(false)} />}
  </div>;
}
