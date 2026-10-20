import React,{useCallback,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {SessionProvider,useSession,useLocation,navigate,api,Loading,ErrorNotice,Brand,DesignTemplate,templates} from './shared';
import {Login,PasswordChange} from './auth';
import StudentApp from './student';
import TeacherApp from './teacher';
import './design.css';
import './app.css';

function DesignPreview({id}) {
  const originalLogo=new URLSearchParams(window.location.search).has('original');
  const setup=useCallback(root=>{const scroller=root.querySelector('#gs');if(scroller){if(id.startsWith('MT'))scroller.scrollLeft=120;if(id==='WT-03'){const selected=scroller.querySelector('.sq.sel');if(selected){const fixed=scroller.querySelector('.stick').offsetWidth;const score=scroller.querySelector('.score-c').offsetWidth;scroller.scrollLeft+=selected.getBoundingClientRect().left-scroller.getBoundingClientRect().left-fixed-(scroller.clientWidth-fixed-score)/2;}}}},[id]);
  return <><div className="preview-controls"><b>디자인 검수용 · 예시 데이터</b><select aria-label="디자인 화면" value={id} onChange={e=>navigate(`/design/${e.target.value}${originalLogo?'?original':''}`)}>{Object.values(templates).map(t=><option key={t.id} value={t.id}>{t.id} {t.title}</option>)}</select><a href={originalLogo?`/design/${id}`:`/design/${id}?original`} onClick={e=>{e.preventDefault();navigate(e.currentTarget.getAttribute('href'));}}>{originalLogo?'새 로고 보기':'원본 로고 비교'}</a><a href="/" onClick={e=>{e.preventDefault();navigate('/');}}>실제 서비스</a></div><DesignTemplate {...{id,setup,originalLogo}}/></>;
}
function ModePicker(){return <main className="mode-picker card"><div className="center"><Brand large/><h1 className="mt16">Self Fit 챌린지</h1><p className="fs14 muted mt8">사용할 화면을 선택해 주세요.</p></div><div className="stack gap12 mt24"><button className="btn primary lg block" onClick={()=>navigate('/web')}>웹 화면</button><button className="btn secondary lg block" onClick={()=>navigate('/mobile')}>모바일 화면</button></div></main>;}
function App(){const location=useLocation();const {user,loading,error}=useSession();const pathname=location.split('?')[0];const match=pathname.match(/^\/(web|mobile)(\/.*)?$/);const design=pathname.match(/^\/design\/([MW][ST]-\d{2})$/);const mode=match?.[1];const path=match?.[2]||'/';
  async function logout(){await api('/auth/logout',{method:'POST',body:{}});window.location.assign(`/${mode}/login`);}
  useEffect(()=>{document.title=design?`${design[1]} · Self Fit 디자인 검수`:'Self Fit 챌린지';},[pathname]);
  if(design)return <DesignPreview id={design[1]}/>;
  if(pathname==='/design')return <DesignPreview id="MS-09"/>;
  if(!mode)return <ModePicker/>;
  if(loading)return <Loading/>;
  if(error)return <div className="mode-picker"><ErrorNotice error={error} retry={()=>window.location.reload()}/></div>;
  if(!user)return <Login mode={mode} teacher={path.startsWith('/admin')}/>;
  if(user.mustChangePassword||path==='/password/setup'||path==='/password')return <PasswordChange mode={mode} first={user.mustChangePassword}/>;
  if(user.role==='teacher')return <TeacherApp {...{mode,user}} onLogout={logout}/>;
  return <StudentApp {...{mode,user,path}} onLogout={logout}/>;
}
createRoot(document.getElementById('root')).render(<SessionProvider><App/></SessionProvider>);
