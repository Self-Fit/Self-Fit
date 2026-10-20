import React, { useEffect, useRef, useState } from 'react';
import { ErrorNotice, Icon, Loading, useResource } from './shared.jsx';
import './participation.css';

const countFormat = new Intl.NumberFormat('ko-KR');
const rateFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const count = value => Number.isFinite(value) ? countFormat.format(value) : '—';
const hasRate = value => Number.isFinite(value);
const rate = value => hasRate(value) ? `${rateFormat.format(value)}%` : '—';
const barWidth = value => hasRate(value) ? `${Math.min(100, Math.max(0, value))}%` : '0%';
const initialFilters = { grade: '', classNumber: '', targetType: '' };

function EmptyChart({ children = '집계할 참여 학생이 없어요.' }) {
  return <div className="participation-empty"><Icon name="chart" size={28}/><p>{children}</p></div>;
}

function WeekChart({ weeks, mobile }) {
  return <section className="card participation-chart-card" aria-labelledby="participation-weeks-title">
    <div className="participation-card-head">
      <div><h2 id="participation-weeks-title" className="q">주차별 완수율</h2><p className="participation-card-sub">각 주차를 완료한 학생 ÷ 참여 학생</p></div>
      <span className="participation-legend"><i/>완료</span>
    </div>
    {weeks.length ? <>
      <div className="participation-week-chart">
        <div className="participation-axis" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
        <div className="participation-week-scroll" tabIndex={mobile ? 0 : undefined} aria-label={mobile ? '주차별 완수율 그래프, 가로로 이동할 수 있어요.' : undefined}>
          <ol className="participation-week-bars">
            {weeks.map(week => {
              const label = `${week.week}주차 ${week.name}, ${week.pending ? '판정 대기' : `완수율 ${rate(week.completionRate)}, 완료 ${count(week.completed)}명`}, 참여 ${count(week.participants)}명`;
              return <li key={week.week} className={`participation-week ${week.pending ? 'is-pending' : ''}`} title={label}>
                <div className="participation-week-plot" role="img" aria-label={label}>
                  <div className="participation-week-track" aria-hidden="true"><span className="participation-week-fill" style={{ height: barWidth(week.completionRate) }}/></div>
                  <b className="participation-week-rate" aria-hidden="true">{week.pending ? '대기' : rate(week.completionRate)}</b>
                </div>
                <b className="participation-week-number">{week.week}주차</b>
                <span className="participation-week-name" title={week.name}>{week.name}</span>
                <span className="participation-week-count">{week.pending ? '—' : count(week.completed)} / {count(week.participants)}명</span>
              </li>;
            })}
          </ol>
        </div>
      </div>
      <div className="participation-chart-foot"><span>막대 아래 숫자는 완료 학생 / 참여 학생이에요.</span>{mobile && <span className="participation-scroll-hint">옆으로 넘겨 보기 <Icon name="chevron" size={12}/></span>}</div>
    </> : <EmptyChart>표시할 주차가 없어요.</EmptyChart>}
  </section>;
}

function ComparisonRows({ items }) {
  if (!items.length) return <EmptyChart/>;
  return <div className="participation-comparison-rows">{items.map(item => <div className="participation-comparison-row" key={item.targetType || `${item.grade}-${item.classNumber || ''}`}>
    <div className="participation-comparison-label"><div><b>{item.label}</b><span>참여 {count(item.participants)}명</span></div><strong className={hasRate(item.completionRate) ? 'gtext' : 'muted'}>{rate(item.completionRate)}</strong></div>
    <div className="participation-comparison-track" role="img" aria-label={`${item.label} 완수율 ${rate(item.completionRate)}, 완료한 주차 ${count(item.completedWeeks)} / 전체 가능 주차 ${count(item.possibleWeeks)}`} title={`${count(item.completedWeeks)} / ${count(item.possibleWeeks)}주`}><span style={{ width: barWidth(item.completionRate) }}/></div>
    <div className="participation-comparison-count">완료 {count(item.completedWeeks)} / {count(item.possibleWeeks)}주</div>
  </div>)}</div>;
}

export default function Participation({ mode }) {
  const mobile = mode === 'mobile';
  const [filters, setFilters] = useState(initialFilters);
  const [comparison, setComparison] = useState('grades');
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '')).toString();
  const resource = useResource(`/teacher/participation${query ? `?${query}` : ''}`);
  const optionsRef = useRef({ grades: [], classes: [] });
  useEffect(() => { if (resource.data?.filterOptions) optionsRef.current = resource.data.filterOptions; }, [resource.data]);
  const options = resource.data?.filterOptions || optionsRef.current;
  const classes = [...new Set(options.classes.filter(item => !filters.grade || String(item.grade) === filters.grade).map(item => item.classNumber))].sort((a, b) => a - b);
  const reset = () => setFilters(initialFilters);
  const filtered = Object.values(filters).some(Boolean);
  const data = resource.data;
  const summary = data?.summary;
  const pendingWeeks = Array.isArray(summary?.pendingWeeks) ? summary.pendingWeeks : [];
  const pendingLabel = pendingWeeks.map(week => `${week}주차`).join(', ');

  return <div className={`participation-page ${mobile ? 'is-mobile' : 'is-web'}`}>
    <header className="participation-heading"><div><h1 className={mobile ? 'page-title' : ''}>참여율</h1><p>완료한 주차 기준으로 챌린지 진행도를 확인해요.</p></div><span className="chip line">주차 완료 기준</span></header>
    <div className="filters participation-filters" role="group" aria-label="참여율 집계 조건">
      <label className="participation-select"><span className="sr-only">학년</span><select className="select" value={filters.grade} onChange={event => setFilters(old => ({ ...old, grade: event.target.value, classNumber: '' }))}><option value="">전체 학년</option>{options.grades.map(grade => <option key={grade} value={grade}>{grade}학년</option>)}</select><Icon name="chevron" size={14}/></label>
      <label className="participation-select"><span className="sr-only">반</span><select className="select" value={filters.classNumber} onChange={event => setFilters(old => ({ ...old, classNumber: event.target.value }))}><option value="">전체 반</option>{classes.map(classNumber => <option key={classNumber} value={classNumber}>{classNumber}반</option>)}</select><Icon name="chevron" size={14}/></label>
      <div className="seg participation-target-filter" role="group" aria-label="참여 대상">{[['', '전체'], ['required', '필수'], ['optional', '선택']].map(([value, label]) => <button type="button" key={value} aria-pressed={filters.targetType === value} className={filters.targetType === value ? 'on' : ''} onClick={() => setFilters(old => ({ ...old, targetType: value }))}>{label}</button>)}</div>
      <button type="button" className="btn ghost participation-reset" disabled={!filtered} onClick={reset}><Icon name="refresh" size={15}/>초기화</button>
    </div>
    <div className="participation-results" aria-busy={resource.loading}>
      {resource.loading ? <div className="card participation-state"><Loading/></div> : resource.error ? <div className="card participation-state"><ErrorNotice error={resource.error} retry={resource.refresh}/></div> : summary ? <>
        <section className="stats participation-stats" aria-label="참여율 요약">
          <div className="stat"><div className="l">전체 완수율</div><div className="v gtext">{rate(summary.completionRate)}</div><div className="d">완료한 주차 ÷ 전체 가능 주차</div></div>
          <div className="stat"><div className="l">집계 학생</div><div className="v">{count(summary.participants)}<small>명</small></div><div className="d">참여 학생 기준</div></div>
          <div className="stat"><div className="l">완료한 주차</div><div className="v participation-completed-value">{count(summary.completedWeeks)}<small>/ {count(summary.possibleWeeks)}주</small></div><div className="d">{count(summary.participants)}명 × 전체 {count(summary.totalWeeks)}주</div></div>
        </section>
        <p className="participation-method"><Icon name="info" size={15}/><span>전체 {count(summary.totalWeeks)}주를 포함해 계산해요.{pendingWeeks.length > 0 && <> {pendingLabel}는 판정 대기 중이며 전체 가능 주차에 포함돼요.</>}</span></p>
        {summary.participants === 0 ? <section className="card participation-no-results"><div className="empty"><div className="art"><Icon name="users" size={44}/></div><b>조건에 맞는 참여 학생이 없어요.</b><p>학년·반 또는 참여 대상 조건을 바꿔 보세요.</p>{filtered && <button type="button" className="btn secondary mt20" onClick={reset}>필터 초기화</button>}</div></section> : <>
          <WeekChart weeks={data.weeks || []} mobile={mobile}/>
          <div className="participation-comparison-grid">
            <section className="card participation-chart-card" aria-labelledby="participation-groups-title">
              <div className="participation-card-head"><div><h2 id="participation-groups-title" className="q">학년·반별 비교</h2><p className="participation-card-sub">참여 학생의 전체 {count(summary.totalWeeks)}주 기준</p></div><div className="seg participation-comparison-tabs" role="group" aria-label="비교 단위">{[['grades', '학년별'], ['classes', '반별']].map(([value, label]) => <button type="button" key={value} className={comparison === value ? 'on' : ''} aria-pressed={comparison === value} onClick={() => setComparison(value)}>{label}</button>)}</div></div>
              <ComparisonRows items={data[comparison] || []}/>
            </section>
            <section className="card participation-chart-card" aria-labelledby="participation-targets-title"><div className="participation-card-head"><div><h2 id="participation-targets-title" className="q">필수·선택별 비교</h2><p className="participation-card-sub">선택한 조건에 해당하는 참여 학생</p></div></div><ComparisonRows items={data.targets || []}/><p className="participation-denominator">완료한 주차 / (참여 학생 × {count(summary.totalWeeks)}주)</p></section>
          </div>
        </>}
      </> : null}
    </div>
  </div>;
}
