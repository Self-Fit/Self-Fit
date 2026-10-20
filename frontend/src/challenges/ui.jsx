import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, navigate } from '../shared.jsx';
import { dateText } from '../student-utils.js';
import { usingMock } from './index.js';

/** useResource for the challenge client: loader is an async function, deps decide when to reload. */
export function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const latest = useRef(loader); latest.current = loader;
  useEffect(() => {
    let active = true;
    setState(old => ({ ...old, loading: true, error: null }));
    latest.current().then(data => active && setState({ data, loading: false, error: null }), error => active && setState({ data: null, loading: false, error }));
    return () => { active = false; };
  }, [...deps, tick]);
  return { ...state, refresh: useCallback(() => setTick(value => value + 1), []) };
}

/** One request at a time per screen; returns [busy, run]. run(fn) resolves to fn's result or undefined on error. */
export function useAction(onError) {
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const run = useCallback(async fn => {
    if (lock.current) return undefined;
    lock.current = true; setBusy(true);
    try { return await fn(); } catch (error) { onError?.(error); return undefined; } finally { lock.current = false; setBusy(false); }
  }, [onError]);
  return [busy, run];
}

export function useFeedback() {
  const [message, setMessage] = useState('');
  useEffect(() => { if (!message) return undefined; const timer = setTimeout(() => setMessage(''), 2600); return () => clearTimeout(timer); }, [message]);
  return [message ? <div className="runtime-feedback" role="status">{message}</div> : null, setMessage];
}

export const PHASES = {
  draft: ['초안', ''],
  upcoming: ['시작 전', 'blue'],
  active: ['진행 중', 'g'],
  rest: ['쉬는 기간', 'warn'],
  ended: ['종료', 'dark'],
  archived: ['보관됨', 'line'],
};
export function PhaseChip({ phase, large = false }) {
  const [label, tone] = PHASES[phase] || [phase, ''];
  return <span className={`chip ${tone} ${large ? 'lg' : ''}`}>{label}</span>;
}

const year = date => date?.slice(0, 4);
export function periodText(start, end) {
  if (!start) return '';
  if (!end) return `${year(start)}년 ${dateText(start)}`;
  return year(start) === year(end) ? `${year(start)}년 ${dateText(start)} – ${dateText(end)}` : `${year(start)}년 ${dateText(start)} – ${year(end)}년 ${dateText(end)}`;
}

export function MockNotice() {
  if (!usingMock) return null;
  return <div className="banner blue ch-mock" role="note"><Icon name="info" />예시 데이터(mock)로 동작 중이에요. 새로고침하면 처음 상태로 돌아가요.</div>;
}

/** Label + control + inline error, matching the server's INVALID_CHALLENGE detail path. */
export function FormField({ label, error, hint, children, className = '', hideLabel = false }) {
  return <label className={`field ch-field ${className}`}>
    <span className={hideLabel ? 'sr-only' : 'fw7 fs13'}>{label}</span>
    {children}
    {error ? <span className="help err" role="alert"><Icon name="info" size={14} />{error}</span> : hint ? <span className="help">{hint}</span> : null}
  </label>;
}

/** 구성 / 참여자 tabs on a saved challenge (web). */
export function ChallengeTabs({ id, current, memberCount }) {
  const base = `/web/admin/challenges/${encodeURIComponent(id)}`;
  const tabs = [['setup', '구성', base], ['members', `참여자${memberCount === undefined ? '' : ` ${memberCount}`}`, `${base}/members`]];
  return <nav className="ch-tabs" aria-label="챌린지 화면">{tabs.map(([key, label, href]) => <a key={key} href={href} className={current === key ? 'on' : ''} aria-current={current === key ? 'page' : undefined} onClick={event => { event.preventDefault(); if (current !== key) navigate(href); }}>{label}</a>)}</nav>;
}
