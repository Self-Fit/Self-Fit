// Settings checks, account changes, and logout must not mutate the browser endpoint concurrently.
let pending=Promise.resolve();
function serial(operation){const result=pending.then(operation);pending=result.catch(()=>{});return result;}

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
  return serial(async()=>{
    if(!isCurrent())return false;
    const current=await subscription();
    if(!current||!isCurrent())return false;
    if(user.role==='student'&&!user.mustChangePassword){
      const registered=await owned(api,current,isCurrent);
      if(!isCurrent())return false;
      if(registered)return true;
    }
    await detach(current);
    return false;
  });
}

export async function enablePush(api,settings,{isCurrent=()=>true}={}){
  if(!settings.pushPublicKey)throw new Error('운동 알림을 준비 중이에요. 앱 안 알림은 계속 확인할 수 있어요.');
  if(!globalThis.navigator?.serviceWorker||!globalThis.window?.PushManager||!globalThis.Notification)throw new Error('이 브라우저에서는 푸시 알림을 지원하지 않아요. 아이폰은 홈 화면에 추가한 뒤 열어 주세요.');
  if(await Notification.requestPermission()!=='granted')throw new Error('브라우저 설정에서 알림을 허용해 주세요.');
  return serial(async()=>{
    if(!isCurrent())return false;
    const registration=await navigator.serviceWorker.register('/service-worker.js');
    await navigator.serviceWorker.ready;
    const current=await registration.pushManager.getSubscription();
    if(!isCurrent())return false;
    if(current){
      const registered=await owned(api,current,isCurrent);
      if(!isCurrent())return false;
      if(registered)return true;
      await detach(current);
    }
    if(!isCurrent())return false;
    const applicationServerKey=Uint8Array.from(atob(settings.pushPublicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const created=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey});
    if(!isCurrent()){try{await created.unsubscribe();}catch{}return false;}
    try{await api('/student/push-subscriptions',{method:'POST',body:created.toJSON()});}
    catch(error){try{await created.unsubscribe();}catch{}throw error;}
    return true;
  });
}

export function logoutWithPush(api){
  return serial(async()=>{
    let current;
    try{current=await subscription();}catch{}
    await api('/auth/logout',{method:'POST',body:current?{pushEndpoint:current.endpoint}:{}});
    // The server already revoked delivery. A local browser failure must not prevent logout.
    if(current)try{await current.unsubscribe();}catch{}
  });
}
