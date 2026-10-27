import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorNotice, Icon, Loading, Modal } from '../shared.jsx';
import { addMembers, listStudents, previewMembers } from './index.js';
import { useAction, useLoad } from './ui.jsx';
import { SKIP_REASONS, STATUS, enrollmentWindow } from './members.jsx';
import { FITNESS_GRADES } from '../fitness-grades.js';
import { FitnessGradeChip } from '../fitness-grades.jsx';
import { buildMemberSelection, createSelectionPreview } from './member-selection.js';

const STEPS = ['대상 선택', '참여 방식', '결과'];
const blankFilters = { grade: '', classNumber: '', fitnessGrades: [] };
const busyStatus = status => status === 'active' || status === 'pending';

function Steps({ step }) {
  return <ol className="ch-steps" aria-label="진행 단계">{STEPS.map((label, index) => <li key={label} className={index + 1 === step ? 'on' : index + 1 < step ? 'done' : ''} aria-current={index + 1 === step ? 'step' : undefined}><span>{index + 1 < step ? <Icon name="check" size={12} /> : index + 1}</span>{label}</li>)}</ol>;
}

function Select({ label, value, onChange, options }) {
  return <label className="field ch-field"><span className="fw7 fs13">{label}</span><div className="ch-select"><select value={value} onChange={event => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select><Icon name="chevron" size={16} /></div></label>;
}

/** Step 1 filters or checklist → preview (writes nothing) → step 2 forced/invited → step 3 added/skipped. */
export default function AddMembersDialog({ challenge, onClose, onDone }) {
  const enrollment = enrollmentWindow(challenge);
  const [step, setStep] = useState(1);
  const [by, setBy] = useState('filters');
  const [filters, setFilters] = useState(blankFilters);
  const [picked, setPicked] = useState([]);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRequests = useRef(null);
  if (!previewRequests.current) previewRequests.current = createSelectionPreview();
  const [mode, setMode] = useState(enrollment.invite ? 'invited' : 'forced');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, run] = useAction(setError);
  const roster = useLoad(() => listStudents(), []);
  const students = roster.data?.students || [];
  const grades = [...new Set(students.map(student => student.grade))].sort((a, b) => a - b);
  const classes = [...new Set(students.filter(student => !filters.grade || String(student.grade) === filters.grade).map(student => student.classNumber))].sort((a, b) => a - b);
  const visible = useMemo(() => students.filter(student => !search.trim() || student.name.includes(search.trim()) || student.studentNumber.includes(search.trim())), [students, search]);

  // Preview and confirmation share the same selector, with each response tied to its exact selection.
  const selection = useMemo(() => buildMemberSelection(by, filters, picked), [by, filters, picked]);
  const selectionKey = JSON.stringify([challenge.id, selection]);
  const invalidatePreview = () => { previewRequests.current.invalidate(); setPreview(null); setPreviewLoading(false); setError(null); };
  const switchBy = next => { if (next === by) return; invalidatePreview(); setBy(next); setFilters(blankFilters); setPicked([]); setSearch(''); };
  const changeFilter = (key, value) => { invalidatePreview(); setFilters(old => ({ ...old, [key]: value, ...(key === 'grade' ? { classNumber: '' } : {}) })); };
  const toggleGrade = grade => { invalidatePreview(); setFilters(old => ({ ...old, fitnessGrades: old.fitnessGrades.includes(grade) ? old.fitnessGrades.filter(value => value !== grade) : [...old.fitnessGrades, grade] })); };
  const toggle = id => { invalidatePreview(); setPicked(old => old.includes(id) ? old.filter(item => item !== id) : [...old, id]); };

  const runPreview = useCallback(async () => {
    setError(null); setPreview(null); setPreviewLoading(true);
    const outcome = await previewRequests.current.load(selectionKey, () => previewMembers(challenge.id, selection));
    if (!outcome) return;
    setPreviewLoading(false);
    if (outcome.error) setError(outcome.error);
    else setPreview(outcome);
  }, [challenge.id, selection, selectionKey]);
  useEffect(() => {
    // Filter selection automatically includes everyone matching the chosen grade(s).
    if (by === 'filters') runPreview();
    return () => { previewRequests.current.invalidate(); };
  }, [by, runPreview]);

  const previewReady = preview?.key === selectionKey && !previewLoading;
  const previewed = previewReady ? preview.data.students : [];
  const fresh = previewed.filter(student => !busyStatus(student.membership?.status));
  const pending = previewed.filter(student => student.membership?.status === 'pending');
  const willChange = mode === 'forced' ? fresh.length + pending.length : fresh.length;

  async function submit() {
    if (!previewReady || !willChange) return;
    setError(null);
    const data = await run(() => addMembers(challenge.id, { mode, ...selection }));
    if (data) { setResult(data); setStep(3); onDone?.(); }
  }

  const footer = step === 1 ? <><button type="button" className="btn secondary" onClick={onClose}>취소</button><button type="button" className="btn primary" disabled={!previewReady || !previewed.length || busy} onClick={() => { if (previewReady && previewed.length) setStep(2); }}>다음: 참여 방식</button></>
    : step === 2 ? <><button type="button" className="btn secondary" disabled={busy} onClick={() => setStep(1)}>이전</button><button type="button" className="btn primary" disabled={busy || !previewReady || !willChange || (mode === 'invited' ? !enrollment.invite : !enrollment.force)} onClick={submit}>{busy ? '처리 중…' : mode === 'invited' ? `${willChange}명 초대하기` : `${willChange}명 등록하기`}</button></>
      : <button type="button" className="btn primary" onClick={onClose}>닫기</button>;

  const grouped = result ? Object.entries(result.skipped.reduce((groups, item) => ({ ...groups, [item.reason]: [...(groups[item.reason] || []), item] }), {})) : [];
  return <Modal title={`학생 추가 · ${challenge.title}`} onClose={busy ? undefined : onClose} footer={footer}>
    <Steps step={step} />
    {step === 1 && <div className="stack gap16 mt16">
      <div className="seg block" role="tablist" aria-label="고르는 방법">
        <button type="button" role="tab" aria-selected={by === 'filters'} className={by === 'filters' ? 'on' : ''} onClick={() => switchBy('filters')}>조건으로 고르기</button>
        <button type="button" role="tab" aria-selected={by === 'ids'} className={by === 'ids' ? 'on' : ''} onClick={() => switchBy('ids')}>명단에서 고르기</button>
      </div>
      <p className="help">두 방법 중 하나만 쓸 수 있어요. 바꾸면 고른 내용이 초기화돼요.</p>
      {roster.loading ? <Loading /> : roster.error ? <ErrorNotice error={roster.error} retry={roster.refresh} /> : by === 'filters'
        ? <div className="ch-filter-grid ch-grade-filter-grid">
          <Select label="학년" value={filters.grade} onChange={value => changeFilter('grade', value)} options={[['', '전 학년'], ...grades.map(grade => [String(grade), `${grade}학년`])]} />
          <Select label="반" value={filters.classNumber} onChange={value => changeFilter('classNumber', value)} options={[['', '전체 반'], ...classes.map(number => [String(number), `${number}반`])]} />
          <div className="ch-grade-field"><div className="fw7 fs13">체력등급 <span className="muted fw6">· 여러 등급을 고를 수 있어요</span></div><div className="pills mt8" role="group" aria-label="체력등급 선택"><button type="button" className={!filters.fitnessGrades.length ? 'on' : ''} aria-pressed={!filters.fitnessGrades.length} onClick={() => changeFilter('fitnessGrades', [])}>전체</button>{FITNESS_GRADES.map(grade => <button type="button" key={grade} className={filters.fitnessGrades.includes(grade) ? 'on' : ''} aria-pressed={filters.fitnessGrades.includes(grade)} onClick={() => toggleGrade(grade)}>{grade}등급</button>)}</div><p className="help mt8">고른 등급의 학생을 모두 선택해요. 등급을 고르면 미등록 학생은 제외해요.</p></div>
        </div>
        : <div className="stack gap8">
          <label className="search ch-search"><Icon name="search" size={18} /><input aria-label="이름 또는 학번 검색" placeholder="이름 또는 학번" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="ch-pick-list" role="group" aria-label="학생 명단">{visible.map(student => <button type="button" key={student.id} className={`ch-pick ${picked.includes(student.id) ? 'on' : ''}`} aria-pressed={picked.includes(student.id)} onClick={() => toggle(student.id)}>
            <span className={`cbx ${picked.includes(student.id) ? 'on' : ''}`} aria-hidden="true">{picked.includes(student.id) && <Icon name="check" />}</span>
            <b>{student.name}</b><span className="muted num-font">{student.studentNumber}</span><span className="muted">{student.grade}학년 {student.classNumber}반</span><FitnessGradeChip student={student} />
          </button>)}{!visible.length && <p className="fs13 muted ch-pad">검색 결과가 없어요.</p>}</div>
          <p className="fs13 t2">{picked.length}명 선택됨</p>
        </div>}
      {by === 'ids' && <button type="button" className="btn soft" disabled={busy || previewLoading || !picked.length} onClick={runPreview}><Icon name="search" size={16} />{previewLoading ? '확인 중…' : '미리보기'}</button>}
      {previewLoading && <p className="fs13 muted" role="status">대상 학생을 확인하고 있어요…</p>}
      {previewReady && <div className="stack gap8" aria-live="polite">
        {by === 'filters' && <p className="fs14 fw7">조건에 맞는 학생 {previewed.length}명 전체 선택됨</p>}
        <p className="fs14"><b>{previewed.length}명</b> 중 <b className="gtext">{fresh.length}명</b>을 새로 추가할 수 있어요.{previewed.length > fresh.length && <span className="muted"> 회색 학생은 이미 참여 중이거나 수락을 기다리고 있어요.</span>}</p>
        <div className="ch-preview-list">{previewed.map(student => <div key={student.id} className={`ch-preview ${busyStatus(student.membership?.status) ? 'is-busy' : ''}`}>
          <b>{student.name}</b><span className="num-font">{student.studentNumber}</span><span>{student.grade}학년 {student.classNumber}반</span>
          <div className="ch-chip-stack"><FitnessGradeChip student={student} />{student.membership ? <span className={`chip ${STATUS[student.membership.status]?.[1] || ''}`}>{STATUS[student.membership.status]?.[0]}</span> : <span className="chip g">새로 추가</span>}</div>
        </div>)}{!previewed.length && <p className="fs13 muted ch-pad">조건에 맞는 학생이 없어요.</p>}</div>
      </div>}
    </div>}
    {step === 2 && <div className="stack gap12 mt16" role="radiogroup" aria-label="참여 방식">
      <button type="button" role="radio" aria-checked={mode === 'forced'} disabled={!enrollment.force} className={`ch-option ${mode === 'forced' ? 'on' : ''}`} onClick={() => setMode('forced')}>
        <span className={`cbx ${mode === 'forced' ? 'on' : ''}`} aria-hidden="true">{mode === 'forced' && <Icon name="check" />}</span>
        <span className="grow"><b>강제 등록</b><span>바로 참여가 확정돼요. 학생은 거절할 수 없어요.{enrollment.force ? ` 종료일 ${enrollment.forceUntil}까지 가능해요.` : ''}</span>{pending.length > 0 && <span className="warn-text">수락을 기다리던 {pending.length}명도 강제 참여로 바뀌어요.</span>}</span>
      </button>
      <button type="button" role="radio" aria-checked={mode === 'invited'} disabled={!enrollment.invite} className={`ch-option ${mode === 'invited' ? 'on' : ''}`} onClick={() => setMode('invited')}>
        <span className={`cbx ${mode === 'invited' ? 'on' : ''}`} aria-hidden="true">{mode === 'invited' && <Icon name="check" />}</span>
        <span className="grow"><b>초대</b><span>학생이 수락해야 참여해요. 거절할 수도 있어요.{enrollment.invite && ` 수락 마감은 ${enrollment.inviteUntil}이에요.`}</span></span>
      </button>
      {enrollment.reason && <div className="banner warn"><Icon name="info" /><span>{enrollment.reason}</span></div>}
      <div className="banner line"><Icon name="users" /><span>{willChange ? `${willChange}명에게 적용돼요.` : '새로 적용할 학생이 없어요.'} {mode === 'invited' ? '초대한 학생에게 알림이 가요.' : '등록한 학생에게 알림이 가요.'}</span></div>
    </div>}
    {step === 3 && result && <div className="stack gap12 mt16">
      <div className="banner g"><Icon name="check" /><span><b>{result.added.length}명</b>을 {mode === 'invited' ? '초대했어요.' : '등록했어요.'}</span></div>
      {grouped.length > 0 && <div className="stack gap8"><b className="fs14">건너뛴 학생 {result.skipped.length}명</b>{grouped.map(([reason, items]) => <div className="ch-skip" key={reason}><span className="chip">{SKIP_REASONS[reason] || reason}</span><span className="fs13 t2">{items.map(item => item.name ? `${item.name}(${item.studentNumber})` : item.userId).join(', ')}</span></div>)}</div>}
    </div>}
    {error && <div className="mt12"><ErrorNotice error={error} retry={step === 1 && by === 'filters' ? runPreview : undefined} /></div>}
  </Modal>;
}
