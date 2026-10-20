import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import templates from './design-templates.json';
import icons from './design-icons.json';
export { templates };

export class ApiError extends Error {
  constructor(message, status, code, details) { super(message); Object.assign(this, { status, code, details }); }
}
export async function api(path, options = {}) {
  const init = { credentials: 'include', ...options, headers: { ...options.headers } };
  if (init.body !== undefined && !(init.body instanceof FormData) && typeof init.body !== 'string') {
    init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(init.body);
  }
  const response = await fetch(path.startsWith('/api') ? path : `/api${path}`, init);
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const result = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    if(response.status===401&&!path.replace(/^\/api/,'').startsWith('/auth/'))window.dispatchEvent(new Event('self-fit-session-expired'));
    throw new ApiError(result?.error?.message || '요청을 처리하지 못했어요.', response.status, result?.error?.code, result?.error?.details);
  }
  return result;
}
export function navigate(path, replace = false) {
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}
export function useLocation() {
  const [location, setLocation] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => { const update = () => setLocation(window.location.pathname + window.location.search); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  return location;
}
const SessionContext = createContext(null);
export function SessionProvider({ children }) {
  const [user, setUser] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  async function refresh() { try { const data = await api('/auth/me'); setUser(data.user); setError(null); } catch (error) { setUser(null); if (error.status !== 401) setError(error); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, []);
  useEffect(() => { const expire=()=>setUser(null); window.addEventListener('self-fit-session-expired',expire); return()=>window.removeEventListener('self-fit-session-expired',expire); }, []);
  return <SessionContext.Provider value={{ user, setUser, loading, error, refresh }}>{children}</SessionContext.Provider>;
}
export function useSession() { return useContext(SessionContext); }
export function useResource(path, revision = 0) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) { setState({ data: null, loading: false, error: null }); return; }
    let active = true; setState(old => ({ ...old, loading: true, error: null }));
    // Keep the previous object when the payload is unchanged so template-driven screens
    // (whose setup depends on `data`) are not rebuilt, and typed input is not lost, on every refresh.
    api(path).then(data => active && setState(old => ({ data: old.data !== null && JSON.stringify(old.data) === JSON.stringify(data) ? old.data : data, loading: false, error: null }))).catch(error => active && setState({ data: null, loading: false, error }));
    return () => { active = false; };
  }, [path, revision, tick]);
  return { ...state, refresh: () => setTick(v => v + 1) };
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function setText(root, selector, value) { root.querySelectorAll(selector).forEach(element => { element.textContent = String(value ?? ''); }); }

export function Icon({ name = 'chevron', size = 20, className = '', ...props }) { return <svg className={`i ${className}`} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props} dangerouslySetInnerHTML={{ __html: icons[name] || icons.chevron }} />; }
export function Brand({ large = false }) { return <span className={`brand-original ${large ? 'large' : ''}`} role="img" aria-label="Self Fit"><span className="brand-symbol"><img src="/brand/self-fit-original.png" alt="" /></span><span className="brand-word"><img src="/brand/self-fit-original.png" alt="" /></span></span>; }
export function AppFrame({ mode = 'web', role = 'student', user, onLogout, children, header = true, title, back, tabs = true }) {
  const teacher = role === 'teacher'; const prefix = `/${mode}`;
  const nav = teacher ? [['참여 현황','/admin','grid'],['참여율','/admin/participation','chart'],['정정 요청함','/admin/corrections','inbox'],['명단 관리','/admin/students','user'],['운영 일정','/admin/schedule','calendar']] : [['챌린지','/','home'],['내 기록','/records','chart'],['마이','/me','user']];
  const mobileNav = teacher ? [['현황','/admin','grid'],['정정 요청','/admin/corrections','inbox'],['명단','/admin/students','users'],['더보기','/admin/more','more']] : nav;
  const current = window.location.pathname;
  const link = suffix => prefix + (suffix === '/' ? '' : suffix);
  const active = suffix => suffix === '/' ? current === prefix || current === `${prefix}/` : suffix === '/admin' ? current === `${prefix}/admin` : current.startsWith(link(suffix));
  const userTitle = user?.name || (teacher ? '교사' : '');
  const headerNode = mode === 'web' ? <header className="w-hd"><div className="w-brand"><Brand /><div><span>{teacher ? '교사 관리' : '경북SW마이스터고'}</span></div></div><nav className="w-nav">{nav.map(([label,path]) => <a href={link(path)} className={active(path) ? 'on' : ''} key={path} onClick={event => { event.preventDefault(); navigate(link(path)); }}>{label}</a>)}</nav>{!teacher && <button className="icon-btn" aria-label="알림" onClick={() => navigate(`${prefix}/notifications`)}><Icon name="bell" /></button>}{teacher && <button className="icon-btn" aria-label="비밀번호 변경" title="비밀번호 변경" onClick={() => navigate(`${prefix}/password`)}><Icon name="lock" /></button>}<button className="w-user" onClick={() => teacher ? onLogout?.() : navigate(`${prefix}/me`)} title={teacher ? '로그아웃' : '마이'}><span className="avatar">{userTitle.slice(0,1)}</span>{userTitle}</button></header> : title ? <header className="m-hd sub"><button className="icon-btn" aria-label="뒤로" onClick={back || (() => navigate(link(teacher ? '/admin' : '/')))}><Icon name="back" /></button><div className="t">{title}</div><span className="sp" /></header> : <header className="m-hd"><Brand /><div className="name" /><button className="icon-btn" aria-label={teacher ? '메뉴' : '알림'} onClick={() => teacher ? navigate(`${prefix}/admin/more`) : navigate(`${prefix}/notifications`)}><Icon name={teacher ? 'menu' : 'bell'} /></button>{!teacher && <div className="avatar">{userTitle.slice(0,1)}</div>}</header>;
  const content = <>{header && headerNode}{children}{mode === 'mobile' && header && tabs && <nav className="tabbar">{mobileNav.map(([label,path,icon]) => <button key={path} className={active(path) ? 'on' : ''} onClick={() => navigate(link(path))}><Icon name={icon} size={24} />{label}</button>)}</nav>}</>;
  return mode === 'web' ? <div className="browser app-frame"><div className="view">{content}</div></div> : <div className="mobile-app"><div className="screen">{content}</div></div>;
}
export function DesignTemplate({ id, setup, revision, originalLogo = false }) {
  const ref = useRef(null); const template = templates[id];
  useLayoutEffect(() => {
    if (!template || !ref.current) return;
    ref.current.innerHTML = template.html;
    if (!originalLogo) applyBrand(ref.current);
    return setup?.(ref.current);
  }, [id, setup, revision, originalLogo]);
  if (!template) return <p>화면을 찾을 수 없습니다.</p>;
  return <div ref={ref} className={template.mode === 'web' ? 'browser app-frame' : 'mobile-app'} />;
}
export function TemplateSlots({ id, setup, slots }) {
  const ref = useRef(null); const [targets,setTargets] = useState({}); const template = templates[id];
  useLayoutEffect(() => {
    const root=ref.current; root.innerHTML=template.html; applyBrand(root); const next={};
    for(const [key,slot] of Object.entries(slots)) { const target=typeof slot.selector==='function'?slot.selector(root):root.querySelector(slot.selector); if(target){target.replaceChildren();next[key]=target;} }
    setTargets(next);
  },[id]);
  useLayoutEffect(()=>{if(Object.keys(targets).length)return setup?.(ref.current);},[setup,targets]);
  return <><div ref={ref} className={template.mode==='web'?'browser app-frame':'mobile-app'}/>{Object.entries(targets).map(([key,target])=>createPortal(slots[key]?.children,target,key))}</>;
}
export function applyBrand(root) {
  root.querySelectorAll('.logo').forEach(logo => {
    const image = document.createElement('span'); image.className = `brand-original ${logo.classList.contains('lg') ? 'large' : ''}`; image.setAttribute('role','img'); image.setAttribute('aria-label','Self Fit'); image.innerHTML = '<span class="brand-symbol"><img src="/brand/self-fit-original.png" alt="" /></span><span class="brand-word"><img src="/brand/self-fit-original.png" alt="" /></span>';
    const next = logo.nextElementSibling;
    if (next?.classList.contains('name')) next.textContent = '';
    else if (next && /^Self\s*Fit/.test(next.textContent.trim()) && (next.tagName === 'H1' || (logo.classList.contains('lg') && !next.querySelector('input')))) { next.style.visibility = 'hidden'; next.setAttribute('aria-hidden','true'); }
    else if (logo.closest('.w-brand') && next) next.querySelector('b')?.remove();
    logo.replaceWith(image);
  });
}
export function ErrorNotice({ error, retry }) { return <div className="notice-error" role="alert"><Icon name="info" size={18} /><span>{error?.message || String(error || '')}</span>{retry && <button className="btn sm secondary" onClick={retry}>다시 시도</button>}</div>; }
export function Loading({ message = '불러오는 중이에요.' }) { return <div className="empty"><div className="spinner" /><p>{message}</p></div>; }
export function EmptyState({ title, children, action }) { return <div className="empty"><div className="ico-wrap"><Icon name="inbox" size={28} /></div><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>; }
export function Modal({ title, children, onClose, footer }) { const panel = useRef(null); const closeRef = useRef(onClose); closeRef.current = onClose; useEffect(() => { const previous = document.activeElement; panel.current?.focus(); const key = event => { if (event.key === 'Escape') closeRef.current?.(); if (event.key === 'Tab') { const items = [...panel.current.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')].filter(item => !item.disabled); if (!items.length) return; const first=items[0], last=items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }; document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus(); }; }, []); return <div className="dim app-modal-backdrop" onClick={event => event.target === event.currentTarget && onClose?.()}><section className={window.location.pathname.startsWith('/mobile') ? 'dialog' : 'modal'} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}><div className="mh"><h3 className="grow">{title}</h3>{onClose && <button className="icon-btn" aria-label="닫기" onClick={onClose}><Icon name="close" /></button>}</div><div className="mb">{children}</div>{footer && <div className="mf">{footer}</div>}</section></div>; }
