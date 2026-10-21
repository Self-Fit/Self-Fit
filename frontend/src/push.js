// Optional work is ordered, but logout invalidates it and takes priority.
let pending=Promise.resolve(),epoch=0,loggingOut=0;
function serial(operation,started){const result=pending.then(operation).catch(error=>{if(started!==epoch)return false;throw error;});pending=result.catch(()=>{});return result;}

function unsubscribeLater(current){try{Promise.resolve(current.unsubscribe()).catch(()=>{});}catch{}}

async function subscription(){
  if(!globalThis.navigator?.serviceWorker)return null;
  const registration=await navigator.serviceWorker.getRegistration();
  return await registration?.pushManager?.getSubscription()||null;
}

async function detach(current){
  if(!await current.unsubscribe())throw new Error('이전 계정의 브라우저 알림을 해제하지 못했어요. 다시 시도해 주세요.');
}

async function owned(api,current,isCurrent){
  try{
    const status=await api('/student/push-subscriptions/status',{method:'POST',body:{endpoint:current.endpoint}});
    return status.registered===true;
  }catch(error){
    // Unverified delivery may belong to the previous account. Keep the API error visible.
    if(isCurrent())try{await current.unsubscribe();}catch{}
    throw error;
  }
}

export function reconcilePush(api,user,{isCurrent=()=>true}={}){
  const started=epoch,active=()=>started===epoch&&!loggingOut&&isCurrent();
  return serial(async()=>{
    if(!active())return false;
    const current=await subscription();
    if(!current||!active())return false;
    if(user.role==='student'&&!user.mustChangePassword){
      const registered=await owned(api,current,active);
      if(!active())return false;
      if(registered)return true;
    }
    await detach(current);
    return false;
  },started);
}

export async function enablePush(api,settings,{isCurrent=()=>true}={}){
  const started=epoch,active=()=>started===epoch&&!loggingOut&&isCurrent();
  if(!active())return false;
  if(!settings.pushPublicKey)throw new Error('운동 알림을 준비 중이에요. 앱 안 알림은 계속 확인할 수 있어요.');
  if(!globalThis.navigator?.serviceWorker||!globalThis.window?.PushManager||!globalThis.Notification)throw new Error('이 브라우저에서는 푸시 알림을 지원하지 않아요. 아이폰은 홈 화면에 추가한 뒤 열어 주세요.');
  let permission;
  try{permission=await Notification.requestPermission();}catch(error){if(!active())return false;throw error;}
  if(!active())return false;
  if(permission!=='granted')throw new Error('브라우저 설정에서 알림을 허용해 주세요.');
  return serial(async()=>{
    if(!active())return false;
    const registration=await navigator.serviceWorker.register('/service-worker.js');
    if(!active())return false;
    await navigator.serviceWorker.ready;
    if(!active())return false;
    const current=await registration.pushManager.getSubscription();
    if(!active())return false;
    if(current){
      const registered=await owned(api,current,active);
      if(!active())return false;
      if(registered)return true;
      await detach(current);
    }
    if(!active())return false;
    const applicationServerKey=Uint8Array.from(atob(settings.pushPublicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const created=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey});
    if(!active()){unsubscribeLater(created);return false;}
    try{await api('/student/push-subscriptions',{method:'POST',body:created.toJSON()});}
    catch(error){unsubscribeLater(created);throw error;}
    if(!active()){unsubscribeLater(created);return false;}
    return true;
  },started);
}

export async function logoutWithPush(api){
  epoch++;loggingOut++;pending=Promise.resolve();
  let current,timer;
  try{
    // A stuck provider must not prevent the server from ending the session.
    try{current=await Promise.race([subscription(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1000);})]);}catch{}
    finally{clearTimeout(timer);}
    await api('/auth/logout',{method:'POST',body:current?{pushEndpoint:current.endpoint}:{}});
    // Server revocation is complete; local cleanup must not delay navigation.
    if(current)unsubscribeLater(current);
  }finally{loggingOut--;}
}
