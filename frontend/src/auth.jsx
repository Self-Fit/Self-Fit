import React,{useCallback,useState} from 'react';
import {api,navigate,useSession,DesignTemplate} from './shared';
import {logoutWithPush} from './push.js';

function showError(root,error,before){let notice=root.querySelector('[data-auth-error]');if(!notice){notice=document.createElement('div');notice.className='banner red mt16';notice.dataset.authError='true';notice.setAttribute('role','alert');before.before(notice);}notice.textContent=error.message;}
function cleanContact(root){root.querySelectorAll('.auth-foot').forEach(node=>{node.innerHTML='경북소프트웨어마이스터고 · 체육부';});}
function revealPassword(input){const toggle=input.parentElement.querySelector('span');if(!toggle)return;toggle.setAttribute('role','button');toggle.tabIndex=0;toggle.setAttribute('aria-label','비밀번호 표시');const reveal=()=>{input.type=input.type==='password'?'text':'password';toggle.setAttribute('aria-label',input.type==='password'?'비밀번호 표시':'비밀번호 숨기기');};toggle.onclick=reveal;toggle.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();reveal();}};}

export function Login({mode='web',teacher=false}){
  const {setUser}=useSession();const [role,setRole]=useState(teacher?'teacher':'student');
  const id=mode==='web'?(role==='teacher'?'WT-01':'WS-01'):(role==='teacher'?'MT-01':'MS-01');
  const setup=useCallback(root=>{
    cleanContact(root);
    // The design copy names the first 12-week program; challenges now vary in length.
    root.querySelectorAll('.fs15.t2').forEach(node=>{if(node.textContent.includes('12주'))node.textContent='챌린지 운동 기록, 학번으로 시작해요.';});
    const inputs=[...root.querySelectorAll('input')];const [account,password]=inputs;const submit=root.querySelector('.btn.primary');let busy=false;
    account.value='';password.value='';account.autocomplete='username';password.autocomplete='current-password';account.name='username';password.name='password';account.required=password.required=true;account.id='login-account';password.id='login-password';account.closest('.field').querySelector('label').htmlFor=account.id;password.closest('.field').querySelector('label').htmlFor=password.id;revealPassword(password);
    const refresh=()=>{submit.disabled=busy||!account.value.trim()||!password.value;submit.classList.toggle('disabled',submit.disabled);};inputs.forEach(input=>input.addEventListener('input',refresh));refresh();
    const run=async()=>{if(submit.disabled)return;busy=true;refresh();submit.textContent='로그인 중…';root.querySelector('[data-auth-error]')?.remove();try{const {user}=await api('/auth/login',{method:'POST',body:{studentNumber:account.value.trim(),password:password.value}});setUser(user);navigate(`/${mode}${user.mustChangePassword?'/password/setup':user.role==='teacher'?'/admin':''}`,true);}catch(error){showError(root,error,submit);}finally{busy=false;submit.textContent='로그인';refresh();}};
    submit.onclick=run;inputs.forEach(input=>input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();run();}});
    root.querySelectorAll('.seg button').forEach((tab,index)=>tab.onclick=()=>setRole(index===0?'student':'teacher'));
    if(!root.querySelector('.seg')){const other=role==='teacher'?'student':'teacher';const link=document.createElement('a');link.href=`/${mode}${other==='teacher'?'/admin':''}/login`;link.className='fs13 fw7';link.style.cssText='display:block;text-align:center;margin-top:16px;text-decoration:underline;color:var(--t2)';link.textContent=other==='teacher'?'교사로 로그인':'학생으로 로그인';link.onclick=event=>{event.preventDefault();setRole(other);navigate(link.getAttribute('href'),true);};(root.querySelector('.help.center')||submit).after(link);}
  },[mode,role,setUser]);
  return <DesignTemplate {...{id,setup}}/>;
}

export function PasswordChange({mode='web',first=false}){
  const {user,setUser}=useSession();const id=mode==='web'?'WS-02':first?'MS-03':'MS-37';
  const setup=useCallback(root=>{
    cleanContact(root);let fields=[...root.querySelectorAll('.field')];
    if(!first&&mode==='web'){const current=fields[0].cloneNode(true);current.querySelector('label').textContent='현재 비밀번호';current.querySelectorAll('.help, .row, .stack').forEach(el=>el.remove());current.querySelector('.input').classList.remove('focus');current.querySelector('input').value='';fields[0].before(current);fields=[...root.querySelectorAll('.field')];root.querySelector('.hd h1').textContent='비밀번호 변경';root.querySelector('.hd p').textContent='현재 비밀번호를 확인하고 새 비밀번호로 바꿔 주세요.';}
    const inputs=[...root.querySelectorAll('input')];inputs.forEach((input,index)=>{input.value='';input.name=first?(index===0?'newPassword':'confirm'):['currentPassword','newPassword','confirm'][index];input.id=`change-${input.name}`;input.autocomplete=input.name==='currentPassword'?'current-password':'new-password';input.required=true;input.closest('.field').querySelector('label').htmlFor=input.id;input.parentElement.classList.remove('err');revealPassword(input);});
    const current=first?null:inputs[0];const password=inputs[first?0:1],confirmation=inputs[first?1:2];const button=root.querySelector('.btn.primary');button.textContent=first?'변경하고 시작하기':'변경하기';const help=[...password.closest('.field').querySelectorAll('.help')];let busy=false;
    const valid=()=>password.value.length>=8&&password.value.length<=128&&/[A-Za-z]/.test(password.value)&&/[0-9]/.test(password.value)&&password.value!==user.studentNumber;
    const refresh=()=>{const checks=[password.value.length>=8,/[A-Za-z]/.test(password.value)&&/[0-9]/.test(password.value),password.value.length>0&&password.value!==user.studentNumber];help.forEach((element,index)=>{element.classList.toggle('ok',checks[index]);element.classList.remove('err');});button.disabled=busy||!valid()||password.value!==confirmation.value||(!first&&!current.value);button.classList.toggle('disabled',button.disabled);};inputs.forEach(input=>input.addEventListener('input',refresh));refresh();
    const run=async()=>{if(button.disabled)return;busy=true;refresh();root.querySelector('[data-auth-error]')?.remove();try{const {user:updated}=await api('/auth/change-password',{method:'POST',body:{newPassword:password.value,...(first?{}:{currentPassword:current.value})}});setUser(updated);navigate(`/${mode}${updated.role==='teacher'?'/admin':first?'':'/me'}`,true);}catch(error){showError(root,error,button.closest('.bottom-bar')||button);}finally{busy=false;refresh();}};button.onclick=run;inputs.forEach(input=>input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();run();}});
    const back=root.querySelector('[aria-label="뒤로"]');if(back)back.onclick=async()=>{if(first){try{await logoutWithPush(api);setUser(null);navigate(`/${mode}/login`,true);}catch(error){showError(root,error,button.closest('.bottom-bar')||button);}}else navigate(`/${mode}${user.role==='teacher'?'/admin/more':'/me'}`);};
  },[mode,first,user.studentNumber,user.role,setUser]);
  return <DesignTemplate {...{id,setup}}/>;
}
