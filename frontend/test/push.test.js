import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePush,enablePush,logoutWithPush} from '../src/push.js';

const student={id:'student-b',role:'student',mustChangePassword:false};
const settings={pushPublicKey:'AQID'};

function replaceGlobal(t,name,value){
  const previous=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{configurable:true,value});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});
}

// Browser delivery is external; keep its lifecycle state and the API boundary observable.
function browser(t,{endpoint='https://push.example/old',unsubscribeError,unsubscribeResult=true}={}){
  const events=[];let current;
  const subscription=address=>({endpoint:address,toJSON:()=>({endpoint:address,keys:{p256dh:'key',auth:'auth'}}),async unsubscribe(){events.push(['unsubscribe',address]);if(unsubscribeError)throw unsubscribeError;if(unsubscribeResult)current=null;return unsubscribeResult;}});
  current=endpoint?subscription(endpoint):null;
  const registration={pushManager:{async getSubscription(){return current;},async subscribe(options){events.push(['subscribe',options.userVisibleOnly,[...options.applicationServerKey]]);current=subscription('https://push.example/new');return current;}}};
  replaceGlobal(t,'navigator',{serviceWorker:{async getRegistration(){return registration;},async register(path){events.push(['register',path]);return registration;},ready:Promise.resolve(registration)}});
  replaceGlobal(t,'window',{PushManager:class{}});
  replaceGlobal(t,'Notification',{async requestPermission(){events.push(['permission']);return 'granted';}});
  return {events,registration,endpoint:()=>current?.endpoint};
}

function deferred(){let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};}
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));

function service(browser,{registered=false,statusError,logoutError,registrationError}={}){
  return async(path,options)=>{
    assert.equal(options.method,'POST');
    browser.events.push([path,options.body]);
    if(path==='/student/push-subscriptions/status'){if(statusError)throw statusError;return {registered};}
    if(path==='/student/push-subscriptions'){if(registrationError)throw registrationError;return {ok:true};}
    if(path==='/auth/logout'){if(logoutError)throw logoutError;return {ok:true};}
    throw new Error(`Unexpected API request: ${path}`);
  };
}

test('an owned subscription is enabled only after the current session confirms its endpoint',async t=>{
  const state=browser(t);
  assert.equal(await reconcilePush(service(state,{registered:true}),student),true);
  assert.deepEqual(state.events,[['/student/push-subscriptions/status',{endpoint:'https://push.example/old'}]]);
  assert.equal(state.endpoint(),'https://push.example/old');
});

test('a different account detaches the old endpoint and stays disabled',async t=>{
  const state=browser(t);
  assert.equal(await reconcilePush(service(state),student),false);
  assert.equal(state.endpoint(),undefined);
  assert.deepEqual(state.events,[['/student/push-subscriptions/status',{endpoint:'https://push.example/old'}],['unsubscribe','https://push.example/old']]);
});

for(const user of [{id:'teacher',role:'teacher'},{...student,mustChangePassword:true}])test(`${user.role} ${user.mustChangePassword?'password setup':'login'} detaches student delivery without using protected student routes`,async t=>{
  const state=browser(t);
  assert.equal(await reconcilePush(service(state),user),false);
  assert.equal(state.endpoint(),undefined);
  assert.deepEqual(state.events,[['unsubscribe','https://push.example/old']]);
});

test('an ownership lookup failure detaches possible previous-account delivery and remains visible',async t=>{
  const state=browser(t),error=new Error('offline');
  await assert.rejects(reconcilePush(service(state,{statusError:error}),student),error);
  assert.equal(state.endpoint(),undefined);
  assert.deepEqual(state.events.at(-1),['unsubscribe','https://push.example/old']);
});

test('an ownership lookup failure during enable detaches the existing endpoint without registering it',async t=>{
  const state=browser(t),error=new Error('offline');
  await assert.rejects(enablePush(service(state,{statusError:error}),settings),error);
  assert.equal(state.endpoint(),undefined);
  assert.deepEqual(state.events.at(-1),['unsubscribe','https://push.example/old']);
  assert.equal(state.events.some(([path])=>path==='/student/push-subscriptions'),false);
});

test('provider cleanup failure keeps the ownership error visible and permits later logout',async t=>{
  const state=browser(t,{unsubscribeError:new Error('provider offline')}),error=new Error('ownership unavailable');
  await assert.rejects(reconcilePush(service(state,{statusError:error}),student),error);
  assert.deepEqual(state.events.at(-1),['unsubscribe','https://push.example/old']);
  await assert.doesNotReject(logoutWithPush(service(state)));
  assert.deepEqual(state.events.slice(-2),[['/auth/logout',{pushEndpoint:'https://push.example/old'}],['unsubscribe','https://push.example/old']]);
});

test('a failed obsolete ownership request cannot detach the new account browser binding',async t=>{
  const state=browser(t),error=new Error('offline');let rejectStatus,active=true;
  const pending=reconcilePush(()=>new Promise((resolve,reject)=>{rejectStatus=reject;}),student,{isCurrent:()=>active});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof rejectStatus,'function');active=false;rejectStatus(error);
  await assert.rejects(pending,error);
  assert.equal(state.endpoint(),'https://push.example/old');
  assert.deepEqual(state.events,[]);
});

test('an obsolete account check cannot unsubscribe after its view has been discarded',async t=>{
  const state=browser(t);let resolveStatus,active=true;
  const pending=reconcilePush(()=>new Promise(resolve=>{resolveStatus=resolve;}),student,{isCurrent:()=>active});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof resolveStatus,'function');active=false;resolveStatus({registered:false});
  assert.equal(await pending,false);
  assert.equal(state.endpoint(),'https://push.example/old');
  assert.deepEqual(state.events,[]);
});

test('enabling reuses a subscription already owned by the current account',async t=>{
  const state=browser(t);
  assert.equal(await enablePush(service(state,{registered:true}),settings),true);
  assert.equal(state.endpoint(),'https://push.example/old');
  assert.deepEqual(state.events,[['permission'],['register','/service-worker.js'],['/student/push-subscriptions/status',{endpoint:'https://push.example/old'}]]);
});

test('enabling removes the previous account endpoint before registering a fresh one',async t=>{
  const state=browser(t);
  assert.equal(await enablePush(service(state),settings),true);
  assert.equal(state.endpoint(),'https://push.example/new');
  assert.deepEqual(state.events,[['permission'],['register','/service-worker.js'],['/student/push-subscriptions/status',{endpoint:'https://push.example/old'}],['unsubscribe','https://push.example/old'],['subscribe',true,[1,2,3]],['/student/push-subscriptions',{endpoint:'https://push.example/new',keys:{p256dh:'key',auth:'auth'}}]]);
});

test('failed old endpoint removal prevents registering the old account endpoint for a new account',async t=>{
  const state=browser(t,{unsubscribeResult:false});
  await assert.rejects(enablePush(service(state),settings));
  assert.equal(state.endpoint(),'https://push.example/old');
  assert.equal(state.events.some(([path])=>path==='/student/push-subscriptions'),false);
});

test('a fresh browser subscription is cleaned up if server registration fails',async t=>{
  const state=browser(t,{endpoint:null}),error=new Error('registration failed');
  await assert.rejects(enablePush(service(state,{registrationError:error}),settings),error);
  assert.equal(state.endpoint(),undefined);
  assert.deepEqual(state.events.at(-1),['unsubscribe','https://push.example/new']);
});

test('an in-flight ownership check finishes before enabling creates a replacement',async t=>{
  const state=browser(t);let resolveStatus;
  const api=service(state);
  const checking=reconcilePush(async(path,options)=>{state.events.push([path,options.body]);return new Promise(resolve=>{resolveStatus=resolve;});},student);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof resolveStatus,'function');
  const enabling=enablePush(api,settings);
  resolveStatus({registered:false});
  assert.deepEqual(await Promise.all([checking,enabling]),[false,true]);
  assert.equal(state.endpoint(),'https://push.example/new');
  assert.equal(state.events.filter(([kind])=>kind==='unsubscribe').length,1);
});

test('an enable request discarded while permission is open cannot change account delivery',async t=>{
  const state=browser(t);let grant,active=true;
  Notification.requestPermission=()=>new Promise(resolve=>{grant=resolve;});
  const enabling=enablePush(service(state),settings,{isCurrent:()=>active});
  active=false;grant('granted');
  assert.equal(await enabling,false);
  assert.equal(state.endpoint(),'https://push.example/old');
  assert.deepEqual(state.events,[]);
});

test('logout sends the browser endpoint for server revocation before unsubscribing locally',async t=>{
  const state=browser(t);
  await logoutWithPush(service(state));
  assert.deepEqual(state.events,[['/auth/logout',{pushEndpoint:'https://push.example/old'}],['unsubscribe','https://push.example/old']]);
  assert.equal(state.endpoint(),undefined);
});

test('local unsubscribe failure does not reject a successful server logout',async t=>{
  const state=browser(t,{unsubscribeError:new Error('browser failure')});
  await assert.doesNotReject(logoutWithPush(service(state)));
  assert.deepEqual(state.events,[['/auth/logout',{pushEndpoint:'https://push.example/old'}],['unsubscribe','https://push.example/old']]);
});

test('a server logout failure preserves normal failure handling and the local subscription',async t=>{
  const state=browser(t),error=new Error('server logout failed');
  await assert.rejects(logoutWithPush(service(state,{logoutError:error})),error);
  assert.equal(state.endpoint(),'https://push.example/old');
  assert.deepEqual(state.events,[['/auth/logout',{pushEndpoint:'https://push.example/old'}]]);
});

test('logout reaches the server while an optional ownership lookup is still unresolved',async t=>{
  const state=browser(t),status=deferred();
  const checking=reconcilePush(()=>status.promise,student);
  await nextTurn();
  const loggingOut=logoutWithPush(service(state));
  await nextTurn();
  const requested=state.events.some(([path])=>path==='/auth/logout');
  status.resolve({registered:true});
  const [enabled]=await Promise.all([checking,loggingOut]);
  assert.equal(requested,true,'optional ownership lookup must not delay the logout request');
  assert.equal(enabled,false,'an old ownership response must not enable push after logout');
});

test('logout bypasses a service worker readiness wait and cancels its later enable work',async t=>{
  const state=browser(t,{endpoint:null}),ready=deferred();
  navigator.serviceWorker.ready=ready.promise;
  const enabling=enablePush(service(state),settings);
  await nextTurn();
  const loggingOut=logoutWithPush(service(state));
  await nextTurn();
  const requested=state.events.some(([path])=>path==='/auth/logout');
  ready.resolve(state.registration);
  const [enabled]=await Promise.all([enabling,loggingOut]);
  assert.equal(requested,true,'service worker readiness must not delay logout');
  assert.equal(enabled,false);
  assert.equal(state.events.some(([kind])=>kind==='subscribe'),false);
});

test('logout resolves after server revocation even when provider unsubscribe remains pending',async t=>{
  const state=browser(t),unsubscribed=deferred();
  const current=await state.registration.pushManager.getSubscription();
  current.unsubscribe=()=>{state.events.push(['unsubscribe',current.endpoint]);return unsubscribed.promise;};
  let completed=false;
  const loggingOut=logoutWithPush(service(state)).then(()=>{completed=true;});
  await nextTurn();
  const completedWhileProviderPending=completed;
  unsubscribed.resolve(true);
  await loggingOut;
  assert.equal(completedWhileProviderPending,true,'local unsubscribe must not delay redirect after server logout');
  assert.deepEqual(state.events,[['/auth/logout',{pushEndpoint:'https://push.example/old'}],['unsubscribe','https://push.example/old']]);
});

test('permission granted after logout cannot register delivery for the departed account',async t=>{
  const state=browser(t,{endpoint:null}),permission=deferred();
  Notification.requestPermission=()=>permission.promise;
  const enabling=enablePush(service(state),settings);
  await logoutWithPush(service(state));
  permission.resolve('granted');
  assert.equal(await enabling,false);
  assert.deepEqual(state.events,[['/auth/logout',{}]]);
});

test('a permission rejection arriving after logout does not surface a stale view error',async t=>{
  const state=browser(t,{endpoint:null}),permission=deferred();
  Notification.requestPermission=()=>permission.promise;
  const enabling=enablePush(service(state),settings);
  await logoutWithPush(service(state));
  permission.reject(new Error('permission request canceled'));
  assert.equal(await enabling,false);
  assert.deepEqual(state.events,[['/auth/logout',{}]]);
});

test('a subscription created after logout is cleaned up without server registration',async t=>{
  const state=browser(t,{endpoint:null}),subscribed=deferred();
  state.registration.pushManager.subscribe=()=>{state.events.push(['subscribe']);return subscribed.promise;};
  const enabling=enablePush(service(state),settings);
  await nextTurn();
  const loggingOut=logoutWithPush(service(state));
  await nextTurn();
  const requested=state.events.some(([path])=>path==='/auth/logout');
  subscribed.resolve({endpoint:'https://push.example/late',toJSON:()=>({endpoint:'https://push.example/late',keys:{p256dh:'key',auth:'auth'}}),async unsubscribe(){state.events.push(['unsubscribe','https://push.example/late']);return true;}});
  const [enabled]=await Promise.all([enabling,loggingOut]);
  assert.equal(requested,true,'a pending browser subscribe request must not delay logout');
  assert.equal(enabled,false);
  assert.equal(state.events.some(([path])=>path==='/student/push-subscriptions'),false);
  assert.deepEqual(state.events.at(-1),['unsubscribe','https://push.example/late']);
});

test('a failed server logout leaves the current binding usable by a fresh enable request',async t=>{
  const state=browser(t),status=deferred(),error=new Error('logout unavailable');
  const checking=reconcilePush(()=>status.promise,student);
  await nextTurn();
  let logoutError;
  const loggingOut=logoutWithPush(service(state,{logoutError:error})).catch(failure=>{logoutError=failure;});
  await nextTurn();
  const failedWhileOwnershipPending=logoutError;
  status.resolve({registered:true});
  await Promise.all([checking,loggingOut]);
  assert.equal(failedWhileOwnershipPending,error);
  assert.equal(state.endpoint(),'https://push.example/old');
  assert.equal(await enablePush(service(state,{registered:true}),settings),true);
  assert.equal(state.events.some(([kind])=>kind==='unsubscribe'),false);
});

test('logout has a bounded browser lookup when the provider never reveals its endpoint',async t=>{
  const state=browser(t),registration=deferred();
  navigator.serviceWorker.getRegistration=()=>registration.promise;
  const loggingOut=logoutWithPush(service(state));
  let timer;
  const completed=await Promise.race([loggingOut.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1200);})]);
  clearTimeout(timer);
  registration.resolve(state.registration);
  await loggingOut;
  assert.equal(completed,true,'browser endpoint lookup must not prevent session logout');
  assert.deepEqual(state.events,[['/auth/logout',{}]]);
});
