import React, {useEffect,useRef,useState} from 'react';
import {api,ErrorNotice,Loading,Modal,useResource} from './shared.jsx';

export function PasswordState({student}) {
  return <span className={'chip '+(student.mustChangePassword?'warn':'g')}>{student.mustChangePassword?'변경 필요':'변경 완료'}</span>;
}
export function StudentPasswords({student,onClose}) {
  const base='/teacher/students/'+encodeURIComponent(student.id);
  const status=useResource(base+'/password-status');
  const [password,setPassword]=useState(null),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(null),[copied,setCopied]=useState(false);
  const lock=useRef(false);
  useEffect(()=>{
    if(!password)return;
    const hide=()=>{if(document.hidden)setPassword(null);};
    const timer=setTimeout(()=>setPassword(null),60000);
    document.addEventListener('visibilitychange',hide);
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',hide);};
  },[password]);
  async function run(reset=false){
    if(lock.current)return;
    lock.current=true;setBusy(true);setError(null);setPassword(null);setCopied(false);
    try{
      const data=await api(base+(reset?'/reset-password':'/temporary-password'),reset?{method:'POST',body:{}}:{});
      setPassword(data.temporaryPassword);setConfirm(false);status.refresh();
    }catch(e){setError(e);status.refresh();}
    finally{lock.current=false;setBusy(false);}
  }
  const date=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):null;
  return <Modal title="학생 비밀번호 관리" onClose={busy?undefined:onClose} footer={<button className="btn primary" disabled={busy} onClick={onClose}>닫기</button>}>
    <p className="fw7 mt16">{student.name} · {student.studentNumber}</p>
    {status.loading?<Loading/>:status.error?<ErrorNotice error={status.error} retry={status.refresh}/>:<>
      <div className="row gap8 mt16"><span className={'chip '+(status.data.changed?'g':'warn')}>{status.data.changed?'변경 완료':'변경 필요'}</span><span className="fs13 muted">{status.data.changed?'학생이 직접 설정한 비밀번호를 사용하고 있어요.':'초기·임시 비밀번호를 변경해야 해요.'}</span></div>
      {status.data.changedAt&&<p className="fs13 muted mt8">변경 시각 · {date(status.data.changedAt)}</p>}
      {!status.data.changed&&status.data.issuedAt&&<p className="fs13 muted mt8">임시 비밀번호 발급 · {date(status.data.issuedAt)}</p>}
      <p className="fs13 muted mt12">{status.data.changed?'학생이 직접 정한 비밀번호는 확인할 수 없어요. 잊었다면 새 임시 비밀번호를 발급해 주세요.':status.data.temporaryPasswordAvailable?'학생이 변경하기 전까지 초기·임시 비밀번호를 다시 확인할 수 있어요.':'이전에 발급된 비밀번호의 보관본이 없어요. 초기화하면 새 임시 비밀번호를 확인할 수 있어요.'}</p>
      <div className="row gap8 mt16" style={{flexWrap:'wrap'}}><button className="btn secondary" disabled={busy||!status.data.temporaryPasswordAvailable} onClick={()=>run()}>초기·임시 비밀번호 확인</button><button className="btn secondary" disabled={busy} onClick={()=>{setPassword(null);setConfirm(true)}}>비밀번호 초기화</button></div>
    </>}
    {confirm&&<div className="card pad mt16"><p className="fs14">기존 비밀번호를 사용할 수 없게 되고, 학생의 모든 로그인이 종료돼요. 새 임시 비밀번호를 발급할까요?</p><div className="row gap8 mt12"><button className="btn secondary" disabled={busy} onClick={()=>setConfirm(false)}>취소</button><button className="btn primary" disabled={busy} onClick={()=>run(true)}>{busy?'발급 중…':'초기화하고 발급'}</button></div></div>}
    {password&&<div className="card pad mt16"><p className="fs13 muted">현재 유효한 초기·임시 비밀번호</p><code style={{display:'block',fontSize:20,userSelect:'all',overflowWrap:'anywhere',marginTop:8}}>{password}</code><div className="row gap8 mt12"><button className="btn secondary sm" onClick={async()=>{try{await navigator.clipboard.writeText(password);setCopied(true)}catch{setError(new Error('복사하지 못했어요. 비밀번호를 선택해서 복사해 주세요.'))}}}>{copied?'복사했어요':'복사'}</button><button className="btn ghost sm" onClick={()=>setPassword(null)}>숨기기</button></div><p className="fs12 muted mt8">학생에게 전달해 주세요. 1분 뒤 화면에서 숨겨져요.</p></div>}
    {error&&<ErrorNotice error={error}/>}
  </Modal>;
}
