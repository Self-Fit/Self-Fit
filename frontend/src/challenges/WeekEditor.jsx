import React from 'react';
import { Icon } from '../shared.jsx';
import { FormField } from './ui.jsx';
import { PALETTE, TYPE_LABELS, blankExercise, blankWeek, changeType, goalText } from './form.js';
import { COLOR, MAX_EXERCISES, MAX_WEEKS, suggestWeekDates } from './validate.js';

const TYPE_HINTS = {
  walking: '학생은 하루 걸음 수를 6개 구간 중 하나로 골라요. 10,000보 이상인 날을 목표 일수만큼 채우면 완료예요.',
  check: '학생은 그날 했는지만 체크해요. 기준값은 안내용이에요(예: 5분).',
  count: '하루 횟수를 입력하고 주간 합계로 완료를 판정해요.',
  distance: '하루 거리를 소수로 입력하고 주간 합계로 완료를 판정해요.',
  dumbbell: '종목마다 세트 수를 입력해요. 모든 종목의 목표 세트를 채운 날을 목표 일수만큼 채우면 완료예요.',
};

function TextInput({ value, onChange, error, disabled, ...props }) {
  return <div className={`input ch-input ${error ? 'err' : ''} ${disabled ? 'disabled' : ''}`}><input value={value} disabled={disabled} aria-invalid={!!error} onChange={event => onChange(event.target.value)} {...props} /></div>;
}

function ColorPicker({ value, onChange, error, disabled, label }) {
  const valid = COLOR.test(value);
  return <div className="field ch-field ch-color" role="group" aria-label={`${label} 색`}>
    <span className="fw7 fs13">색</span>
    <div className="row gap8 ch-swatches">
      {PALETTE.map(color => <button type="button" key={color} className={`ch-swatch ${value.toUpperCase() === color ? 'on' : ''}`} style={{ background: color }} aria-label={`색 ${color}`} aria-pressed={value.toUpperCase() === color} disabled={disabled} onClick={() => onChange(color)}>{value.toUpperCase() === color && <Icon name="check" size={14} />}</button>)}
      <div className={`input ch-input ch-hex ${error ? 'err' : ''} ${disabled ? 'disabled' : ''}`}><i className="ch-hex-dot" style={{ background: valid ? value : 'transparent' }} /><input aria-label="색 직접 입력" value={value} maxLength={7} placeholder="#RRGGBB" disabled={disabled} aria-invalid={!!error} onChange={event => onChange(event.target.value)} /></div>
    </div>
    {error && <span className="help err" role="alert"><Icon name="info" size={14} />{error}</span>}
  </div>;
}

function Exercises({ row, index, errors, disabled, update }) {
  const err = (j, field) => errors[`weeks[${index}].exercises[${j}].${field}`];
  const set = (j, field, value) => update({ exercises: row.exercises.map((exercise, k) => k === j ? { ...exercise, [field]: value } : exercise) });
  return <div className="ch-exercises">
    <div className="row"><b className="fs13 grow">운동 종목 {row.exercises.length}개</b>{!disabled && <button type="button" className="btn ghost sm" disabled={row.exercises.length >= MAX_EXERCISES} onClick={() => update({ exercises: [...row.exercises, blankExercise(row)] })}><Icon name="plus" size={16} />종목 추가</button>}</div>
    {errors[`weeks[${index}].exercises`] && <span className="help err mt4" role="alert"><Icon name="info" size={14} />{errors[`weeks[${index}].exercises`]}</span>}
    <div className="ch-exercise-head" aria-hidden="true"><span>식별값</span><span>이름</span><span>반복</span><span>세트</span><span>좌우 규칙</span><span /></div>
    {row.exercises.map((exercise, j) => <div className="ch-exercise" key={exercise.key}>
      <FormField hideLabel label={`${j + 1}번 종목 식별값`} error={err(j, 'id')}><TextInput value={exercise.id} disabled={disabled} error={err(j, 'id')} placeholder="CURL" maxLength={20} onChange={value => set(j, 'id', value.toUpperCase())} /></FormField>
      <FormField hideLabel label={`${j + 1}번 종목 이름`} error={err(j, 'title')}><TextInput value={exercise.title} disabled={disabled} error={err(j, 'title')} placeholder="덤벨 컬" onChange={value => set(j, 'title', value)} /></FormField>
      <FormField hideLabel label={`${j + 1}번 종목 반복 횟수`} error={err(j, 'repetitions')}><TextInput type="number" min="1" step="1" inputMode="numeric" value={exercise.repetitions} disabled={disabled} error={err(j, 'repetitions')} onChange={value => set(j, 'repetitions', value)} /></FormField>
      <FormField hideLabel label={`${j + 1}번 종목 목표 세트`} error={err(j, 'targetSets')}><TextInput type="number" min="1" step="1" inputMode="numeric" value={exercise.targetSets} disabled={disabled} error={err(j, 'targetSets')} onChange={value => set(j, 'targetSets', value)} /></FormField>
      <FormField hideLabel label={`${j + 1}번 종목 좌우 규칙`}><TextInput value={exercise.sideRule} disabled={disabled} placeholder="좌우 각각 10회 = 1세트" onChange={value => set(j, 'sideRule', value)} /></FormField>
      {!disabled && <button type="button" className="btn ghost sm ch-icon-btn" aria-label={`${j + 1}번 종목 삭제`} disabled={row.exercises.length <= 1} onClick={() => update({ exercises: row.exercises.filter((_, k) => k !== j) })}><Icon name="close" size={16} /></button>}
    </div>)}
  </div>;
}

function TypeFields({ row, index, errors, disabled, update }) {
  const err = field => errors[`weeks[${index}].${field}`];
  const number = (field, label, props = {}, hint) => <FormField label={label} error={err(field)} hint={hint}><TextInput type="number" inputMode="decimal" value={row[field]} disabled={disabled} error={err(field)} onChange={value => update({ [field]: value })} {...props} /></FormField>;
  const text = (field, label, props = {}, hint) => <FormField label={label} error={err(field)} hint={hint}><TextInput value={row[field]} disabled={disabled} error={err(field)} onChange={value => update({ [field]: value })} {...props} /></FormField>;
  const days = number('weeklyTarget', '주간 목표 (일)', { min: 1, max: 7, step: 1, inputMode: 'numeric' }, '1~7일');
  if (row.inputType === 'walking' || row.inputType === 'dumbbell') return days;
  if (row.inputType === 'check') return <>{days}{number('dailyTarget', '일일 기준값 (선택)', { min: 0, step: 'any' })}{text('dailyUnit', '기준 단위 (선택)', { placeholder: '분', maxLength: 10 })}</>;
  const step = row.inputType === 'count' ? { step: 1, min: 1, inputMode: 'numeric' } : { step: 'any', min: 0 };
  const unit = row.unit.trim();
  return <>{number('weeklyTarget', `주간 합계${unit ? ` (${unit})` : ''}`, step)}{number('dailyTarget', `일일 목표 (선택)`, step)}{text('unit', '단위', { placeholder: row.inputType === 'count' ? '회' : 'km', maxLength: 10 })}</>;
}

function WeekRow({ row, index, count, previous, challengeStart, errors, lock, setRow, move, remove }) {
  const structureLocked = lock !== 'none', cosmeticLocked = lock === 'all';
  const update = patch => setRow(index, old => ({ ...old, ...patch }));
  const err = field => errors[`weeks[${index}].${field}`];
  const dateErrors = [errors[`weeks[${index}]`], err('startDate'), err('endDate')].filter(Boolean);
  const suggestion = suggestWeekDates(previous, challengeStart);
  return <section className="card ch-week" aria-labelledby={`ch-week-${row.key}`} style={{ '--week-color': COLOR.test(row.color) ? row.color : 'var(--line-2)' }}>
    <div className="ch-week-head">
      <span className="ch-week-num" aria-hidden="true">{index + 1}</span>
      <h3 id={`ch-week-${row.key}`} className="fs15 fw8">{index + 1}주차</h3>
      <span className="fs13 muted grow ch-week-goal">{TYPE_LABELS[row.inputType]}{goalText(row) && ` · ${goalText(row)}`}</span>
      {!structureLocked && <div className="row gap4">
        <button type="button" className="btn ghost sm ch-icon-btn" aria-label={`${index + 1}주차 위로`} disabled={index === 0} onClick={() => move(index, -1)}><Icon name="chevron" size={16} style={{ transform: 'rotate(-90deg)' }} /></button>
        <button type="button" className="btn ghost sm ch-icon-btn" aria-label={`${index + 1}주차 아래로`} disabled={index === count - 1} onClick={() => move(index, 1)}><Icon name="chevron" size={16} style={{ transform: 'rotate(90deg)' }} /></button>
        <button type="button" className="btn ghost sm ch-icon-btn" aria-label={`${index + 1}주차 삭제`} onClick={() => remove(index)}><Icon name="close" size={16} /></button>
      </div>}
    </div>
    {dateErrors.length > 0 && <div className="banner red ch-week-banner" role="alert"><Icon name="info" /><span>{dateErrors.join(' ')}</span></div>}
    <div className="ch-week-grid">
      <FormField label="운동 이름" error={err('title')} className="ch-span-2"><TextInput value={row.title} disabled={cosmeticLocked} error={err('title')} maxLength={60} placeholder="예: 만보 걷기" onChange={value => update({ title: value })} /></FormField>
      <FormField label="시작일"><TextInput type="date" value={row.startDate} disabled={structureLocked} error={err('startDate') || errors[`weeks[${index}]`]} onChange={value => update({ startDate: value })} /></FormField>
      <FormField label="종료일"><TextInput type="date" value={row.endDate} disabled={structureLocked} error={err('endDate')} min={row.startDate || undefined} onChange={value => update({ endDate: value })} /></FormField>
      <FormField label="운동 유형" error={err('inputType')}>
        <div className={`ch-select ${structureLocked ? 'disabled' : ''}`}><select value={row.inputType} disabled={structureLocked} onChange={event => setRow(index, old => changeType(old, event.target.value))}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Icon name="chevron" size={16} /></div>
      </FormField>
      <TypeFields {...{ row, index, errors, update }} disabled={structureLocked} />
    </div>
    {!structureLocked && suggestion.startDate && (dateErrors.length > 0 || !row.startDate || !row.endDate) && (row.startDate !== suggestion.startDate || row.endDate !== suggestion.endDate) && <button type="button" className="btn ghost sm ch-suggest" onClick={() => update(suggestion)}><Icon name="calendar" size={16} />{index ? '앞 주차 다음 날부터' : '챌린지 시작일부터'} 7일로 맞추기 ({suggestion.startDate.slice(5).replace('-', '/')}–{suggestion.endDate.slice(5).replace('-', '/')})</button>}
    <p className="help ch-type-hint">{TYPE_HINTS[row.inputType]}</p>
    {row.inputType === 'dumbbell' && <Exercises {...{ row, index, errors, update }} disabled={structureLocked} />}
    <div className="ch-week-grid ch-week-foot">
      <FormField label="학생에게 보일 설명" error={err('description')} className="ch-span-2"><TextInput value={row.description} disabled={cosmeticLocked} error={err('description')} maxLength={500} placeholder="예: 하루 10,000보 이상, 기준을 충족한 5일" onChange={value => update({ description: value })} /></FormField>
      <ColorPicker label={`${index + 1}주차`} value={row.color} disabled={cosmeticLocked} error={err('color')} onChange={value => update({ color: value })} />
    </div>
  </section>;
}

/**
 * lock: 'none' (draft/upcoming: everything), 'structure' (started: week name, description and colour only), 'all' (read-only).
 * Errors are {path: message} using the contract's detail paths.
 */
export default function WeekEditor({ weeks, setWeeks, errors, challengeStart, lock = 'none' }) {
  const setRow = (index, fn) => setWeeks(rows => rows.map((row, i) => i === index ? fn(row) : row));
  const move = (index, delta) => setWeeks(rows => { const next = [...rows]; const [row] = next.splice(index, 1); next.splice(index + delta, 0, row); return next; });
  const remove = index => setWeeks(rows => rows.filter((_, i) => i !== index));
  const add = () => setWeeks(rows => [...rows, blankWeek(rows.at(-1), challengeStart, rows.length)]);
  return <div className="stack gap16">
    {errors.weeks && <div className="banner red" role="alert"><Icon name="info" /><span>{errors.weeks}</span></div>}
    {!weeks.length && <div className="card ch-week-empty"><p className="fs14 t2">아직 주차가 없어요. 주차를 추가하면 날짜가 앞 주차 다음 날부터 7일로 채워져요.</p></div>}
    {weeks.map((row, index) => <WeekRow key={row.key} {...{ row, index, lock, errors, challengeStart, setRow, move, remove }} count={weeks.length} previous={weeks[index - 1]} />)}
    {lock === 'none' && <button type="button" className="btn secondary ch-add-week" disabled={weeks.length >= MAX_WEEKS} onClick={add}><Icon name="plus" size={18} />{weeks.length ? `${weeks.length + 1}주차 추가` : '첫 주차 추가'}{weeks.length >= MAX_WEEKS && ` (최대 ${MAX_WEEKS}개)`}</button>}
  </div>;
}
