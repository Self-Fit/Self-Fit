import React from 'react';
import { Icon } from './shared.jsx';
import { dumbbellExercises, dumbbellSummary, dumbbellExerciseLabel } from './dumbbell-values.js';
import './dumbbell.css';

export function DumbbellInput({ week, value, onChange, disabled = false, controlOnly = false }) {
  const exercises = dumbbellExercises(week);
  const change = (id, sets) => onChange({ ...Object.fromEntries(exercises.map(exercise => [exercise.id, value?.[exercise.id] ?? null])), [id]: sets });
  return <div className="dumbbell-editor">{!controlOnly && <><div className="q">운동별 완료 세트</div><div className="q-sub">정해진 횟수를 모두 채운 세트만 1세트로 입력해요.</div></>}
    <div className="mt8">{exercises.map(exercise => {
      const sets = value?.[exercise.id] ?? null;
      return <div className="set-row" key={exercise.id}><div className="grow"><div className="nm">{exercise.title}</div><div className="rule">{exercise.sideRule || `${exercise.repetitions}회 = 1세트`} · 목표 {exercise.targetSets}세트</div><div className="dots-set" aria-hidden="true">{Array.from({ length: exercise.targetSets }, (_, index) => <i key={index} className={sets !== null && Number(sets) > index ? 'on' : ''}/>)}</div></div><div className="mini-step"><button type="button" disabled={disabled || sets === null || Number(sets) <= 0} aria-label={`${exercise.title} 1세트 줄이기`} onClick={() => change(exercise.id, Math.max(0, Number(sets) - 1))}><Icon name="minus" size={16}/></button><span className="v num-font"><input type="number" inputMode="numeric" min="0" step="1" aria-label={`${exercise.title} 완료 세트`} placeholder="—" value={sets ?? ''} disabled={disabled} onChange={event => change(exercise.id, event.target.value === '' ? null : event.target.value)}/><small>/ {exercise.targetSets}</small></span><button type="button" disabled={disabled || Number(sets) >= Number.MAX_SAFE_INTEGER} aria-label={`${exercise.title} 1세트 늘리기`} onClick={() => change(exercise.id, Number(sets ?? 0) + 1)}><Icon name="plus" size={16}/></button></div></div>;
    })}</div>
    <div className="help mt12">빈칸은 미입력이에요. 하지 않았다면 0을 입력해 주세요.</div>
  </div>;
}

export function DumbbellDetails({ week, value, title, showSummary = true }) {
  const summary = dumbbellSummary(week, value);
  return <div className="dumbbell-details">{showSummary && <div className="row"><div className="q grow">{title || '운동별 기록'}</div><span className={`chip ${summary.complete ? 'g' : ''}`}>{summary.hasAny ? `${summary.completed} / ${summary.total}종목` : '미입력'}</span></div>}
    <div className={`kv ${showSummary ? 'mt12' : ''}`}>{summary.rows.map(exercise => <div key={exercise.id}><span>{exercise.title}</span><b className={exercise.sets === null ? 'muted' : ''}>{dumbbellExerciseLabel(exercise, exercise.sets)}</b></div>)}<div><span>총 환산 횟수</span><b>{summary.hasAny ? `${summary.repetitions.toLocaleString('ko-KR')}회` : '—'}</b></div></div>
    <div className="help mt12">환산 횟수는 완료 세트 × {summary.rows[0]?.repetitions ?? 10}회예요. 좌우 운동도 두 배로 계산하지 않아요.</div>
  </div>;
}

export function DumbbellComparison({ week, before, after }) {
  return <div className="dumbbell-comparison mt16"><DumbbellDetails week={week} value={before} title="현재 기록"/><DumbbellDetails week={week} value={after} title="요청 기록"/></div>;
}
