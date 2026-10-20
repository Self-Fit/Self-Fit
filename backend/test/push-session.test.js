import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/password.js';
import { deliverPendingPush } from '../src/notifications.js';

const run=promisify(execFile);
const require=createRequire(import.meta.url);
const backendDir=fileURLToPath(new URL('../',import.meta.url));

test('device push ownership and logout with isolated PostgreSQL', {skip:!process.env.TEST_DATABASE_URL,timeout:120000}, async t=>{
  const baseUrl=new URL(process.env.TEST_DATABASE_URL);
  assert.match(baseUrl.pathname,/_test$/,'Push tests require a dedicated database name ending in _test');
  const schema=`test_${randomUUID().replaceAll('-','')}`;
  const admin=new PrismaClient({datasourceUrl:baseUrl.toString()});
  let db,server,temp,schemaCreated=false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);schemaCreated=true;
    baseUrl.searchParams.set('schema',schema);
    await run(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{cwd:backendDir,env:{...process.env,DATABASE_URL:baseUrl.toString()},timeout:60000});
    db=new PrismaClient({datasourceUrl:baseUrl.toString()});
    temp=await mkdtemp(path.join(tmpdir(),'self-fit-push-test-'));
    let sessionReadHook=null;
    const sessionDelegate=new Proxy(db.session,{get(target,key){if(key==='findUnique')return args=>sessionReadHook?sessionReadHook(args):target.findUnique(args);return target[key];}});
    const apiDb=new Proxy(db,{get(target,key){if(key==='session')return sessionDelegate;const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    const app=await createApp(apiDb,{storageDir:temp});
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const origin=`http://127.0.0.1:${server.address().port}/api`;
    const request=async(route,{cookie,body,method='GET'}={})=>{
      const response=await fetch(origin+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],setCookies:response.headers.getSetCookie()};
    };
    const password='push-test-only-password123';
    const passwordHash=await hashPassword(password);
    const student=async name=>db.user.create({data:{role:'student',studentNumber:`test-${name}`,name:`TEST ${name}`,grade:1,classNumber:1,targetType:'required',participating:true,passwordHash,mustChangePassword:false}});
    const login=async(user,cookie)=>{
      const response=await request('/auth/login',{cookie,method:'POST',body:{studentNumber:user.studentNumber,password}});
      assert.equal(response.status,200);return response.cookie;
    };
    const endpoint=name=>`https://fcm.googleapis.com/test-only-${name}`;
    const keys={p256dh:Buffer.alloc(65,1).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')};
    const register=async(cookie,address)=>{
      const response=await request('/student/push-subscriptions',{cookie,method:'POST',body:{endpoint:address,keys}});
      assert.equal(response.status,201);return response;
    };
    const a=await student('push-a');const b=await student('push-b');

    await t.test('a generated HttpOnly device cookie binds only a hash and survives logout',async()=>{
      const user=await student('device-cookie');const session=await login(user);const address=endpoint('device-cookie');
      const registered=await register(session,address);
      const device=registered.setCookies.find(value=>value.startsWith('self_fit_push_device='));
      assert.ok(device,'registration creates the browser device cookie');
      assert.match(device,/; HttpOnly(?:;|$)/);assert.match(device,/; SameSite=Lax(?:;|$)/);assert.match(device,/; Path=\/api(?:;|$)/);
      const cookie=device.split(';')[0];const token=cookie.split('=')[1];assert.match(token,/^[A-Za-z0-9_-]{43}$/);
      const stored=await db.pushSubscription.findUnique({where:{endpoint:address}});
      assert.equal(stored.deviceKeyHash,createHash('sha256').update(token).digest('hex'));
      assert.ok(!JSON.stringify(registered.data).includes(token));
      const loggedOut=await request('/auth/logout',{cookie:`${session}; ${cookie}`,method:'POST',body:{}});
      assert.equal(loggedOut.status,200);
      assert.ok(loggedOut.setCookies.every(value=>!value.startsWith('self_fit_push_device=')));
    });

    await t.test('logout without provider endpoint revokes its cookie-bound device and preserves other devices and accounts',async()=>{
      const current=await student('bound-logout');const other=await student('bound-other');
      const device=`self_fit_push_device=${Buffer.alloc(32,3).toString('base64url')}`;
      const otherDevice=`self_fit_push_device=${Buffer.alloc(32,4).toString('base64url')}`;
      const session=await login(current);const currentAddress=endpoint('bound-current');const secondAddress=endpoint('bound-second');const foreignAddress=endpoint('bound-foreign');
      await register(`${session}; ${device}`,currentAddress);await register(`${await login(current)}; ${otherDevice}`,secondAddress);await register(await login(other),foreignAddress);
      const response=await request('/auth/logout',{cookie:`${session}; ${device}`,method:'POST',body:{}});
      assert.equal(response.status,200);assert.equal((await request('/auth/me',{cookie:session})).status,401);
      assert.equal(await db.pushSubscription.findUnique({where:{endpoint:currentAddress}}),null);
      assert.equal((await db.pushSubscription.findUnique({where:{endpoint:secondAddress}})).userId,current.id);
      assert.equal((await db.pushSubscription.findUnique({where:{endpoint:foreignAddress}})).userId,other.id);
    });

    await t.test('successful account switch revokes the same device even after its prior session expires',async()=>{
      const current=await student('switch-old');const next=await student('switch-new');
      const device=`self_fit_push_device=${Buffer.alloc(32,5).toString('base64url')}`;
      const otherDevice=`self_fit_push_device=${Buffer.alloc(32,6).toString('base64url')}`;
      const session=await login(current);const address=endpoint('switch-current');const preserved=endpoint('switch-other-device');
      await register(`${session}; ${device}`,address);await register(`${await login(current)}; ${otherDevice}`,preserved);
      await db.session.updateMany({where:{userId:current.id},data:{expiresAt:new Date(0)}});
      assert.equal((await request('/auth/me',{cookie:`${session}; ${device}`})).status,401);
      assert.equal((await request('/auth/login',{cookie:`${session}; ${device}`,method:'POST',body:{studentNumber:next.studentNumber,password:'wrong'}})).status,401);
      assert.ok(await db.pushSubscription.findUnique({where:{endpoint:address}}),'a failed login cannot revoke a device');
      const nextSession=await login(next,`${session}; ${device}`);
      assert.equal((await request('/auth/me',{cookie:nextSession})).data.user.id,next.id);
      assert.equal(await db.pushSubscription.findUnique({where:{endpoint:address}}),null);
      assert.equal((await db.pushSubscription.findUnique({where:{endpoint:preserved}})).userId,current.id);
    });

    await t.test('ownership status binds an existing owned endpoint without allowing a foreign account to bind it',async()=>{
      const owner=await student('status-owner');const other=await student('status-other');
      const device=`self_fit_push_device=${Buffer.alloc(32,7).toString('base64url')}`;
      const foreignDevice=`self_fit_push_device=${Buffer.alloc(32,8).toString('base64url')}`;
      const address=endpoint('status-legacy');const ownedCookie=await login(owner);const otherCookie=await login(other);
      await db.pushSubscription.create({data:{userId:owner.id,endpoint:address,p256dh:keys.p256dh,auth:keys.auth}});
      const foreign=await request('/student/push-subscriptions/status',{cookie:`${otherCookie}; ${foreignDevice}`,method:'POST',body:{endpoint:address}});
      assert.deepEqual(foreign.data,{registered:false});
      await request('/auth/logout',{cookie:`${otherCookie}; ${foreignDevice}`,method:'POST',body:{}});
      assert.ok(await db.pushSubscription.findUnique({where:{endpoint:address}}));
      const owned=await request('/student/push-subscriptions/status',{cookie:`${ownedCookie}; ${device}`,method:'POST',body:{endpoint:address}});
      assert.deepEqual(owned.data,{registered:true});
      assert.equal((await request('/auth/logout',{cookie:`${ownedCookie}; ${device}`,method:'POST',body:{}})).status,200);
      assert.equal(await db.pushSubscription.findUnique({where:{endpoint:address}}),null);
    });

    await t.test('anonymous and expired-session logout can revoke only the device capability they possess',async()=>{
      for(const expired of [false,true]) {
        const user=await student(`anonymous-device-${expired}`);
        const device=`self_fit_push_device=${Buffer.alloc(32,expired?9:10).toString('base64url')}`;
        const otherDevice=`self_fit_push_device=${Buffer.alloc(32,expired?11:12).toString('base64url')}`;
        const session=await login(user);const address=endpoint(`anonymous-current-${expired}`);const preserved=endpoint(`anonymous-preserved-${expired}`);
        await register(`${session}; ${device}`,address);await register(`${await login(user)}; ${otherDevice}`,preserved);
        if(expired) await db.session.updateMany({where:{userId:user.id},data:{expiresAt:new Date(0)}});
        const response=await request('/auth/logout',{cookie:expired?`${session}; ${device}`:device,method:'POST',body:{pushEndpoint:preserved}});
        assert.equal(response.status,200);
        assert.equal(await db.pushSubscription.findUnique({where:{endpoint:address}}),null);
        assert.equal((await db.pushSubscription.findUnique({where:{endpoint:preserved}})).userId,user.id);
      }
    });

    await t.test('an authenticated old account cannot revoke a device now owned by another account',async()=>{
      const previous=await student('old-device-owner');const current=await student('current-device-owner');
      const device=`self_fit_push_device=${Buffer.alloc(32,13).toString('base64url')}`;
      const previousSession=await login(previous);const address=endpoint('current-device-owner');
      await register(`${await login(current)}; ${device}`,address);
      assert.equal((await request('/auth/logout',{cookie:`${previousSession}; ${device}`,method:'POST',body:{}})).status,200);
      assert.equal((await request('/auth/me',{cookie:previousSession})).status,401);
      assert.equal((await db.pushSubscription.findUnique({where:{endpoint:address}}))?.userId,current.id);
    });

    await t.test('logout remembers the current session device before its new cookie reaches the browser',async()=>{
      const user=await student('unreceived-cookie');const session=await login(user);const address=endpoint('unreceived-cookie');
      await register(session,address);
      assert.equal((await request('/auth/logout',{cookie:session,method:'POST',body:{}})).status,200);
      assert.equal(await db.pushSubscription.findUnique({where:{endpoint:address}}),null);
    });

    await t.test('registration and status cannot bind after logout invalidates their cached session',async()=>{
      for(const statusOnly of [false,true]) {
        const user=await student(`late-binding-${statusOnly}`);const session=await login(user);const address=endpoint(`late-binding-${statusOnly}`);
        if(statusOnly) await db.pushSubscription.create({data:{userId:user.id,endpoint:address,p256dh:keys.p256dh,auth:keys.auth}});
        let release,read;
        const blocked=new Promise(resolve=>{release=resolve;});const entered=new Promise(resolve=>{read=resolve;});
        sessionReadHook=async args=>{sessionReadHook=null;const cached=await db.session.findUnique(args);read();await blocked;return cached;};
        const pending=request(statusOnly?'/student/push-subscriptions/status':'/student/push-subscriptions',{cookie:session,method:'POST',body:statusOnly?{endpoint:address}:{endpoint:address,keys}});
        try {
          await entered;
          assert.equal((await request('/auth/logout',{cookie:session,method:'POST',body:{}})).status,200);
        } finally {sessionReadHook=null;release();}
        const response=await pending;assert.equal(response.status,401);
        const stored=await db.pushSubscription.findUnique({where:{endpoint:address}});
        if(statusOnly) assert.equal(stored.deviceKeyHash,null);
        else assert.equal(stored,null);
      }
    });

    await t.test('status reports only the current account ownership and keeps the registration ownership guard',async()=>{
      const aCookie=await login(a);const bCookie=await login(b);const address=endpoint('ownership');
      await register(aCookie,address);
      assert.equal((await request('/student/push-subscriptions/status',{method:'POST',body:{endpoint:address}})).status,401);
      const conflict=await request('/student/push-subscriptions',{cookie:bCookie,method:'POST',body:{endpoint:address,keys}});
      assert.equal(conflict.status,409);assert.equal(conflict.data.error.code,'PUSH_IN_USE');
      for(const [cookie,addressToCheck,registered] of [[aCookie,address,true],[bCookie,address,false],[bCookie,endpoint('unknown'),false]]) {
        const response=await request('/student/push-subscriptions/status',{cookie,method:'POST',body:{endpoint:addressToCheck}});
        assert.equal(response.status,200);assert.deepEqual(response.data,{registered});
      }
      assert.equal((await request('/student/push-subscriptions/status',{cookie:aCookie,method:'POST',body:{}})).status,400);
    });

    await t.test('logout revokes this owned device, preserves other devices, and allows a new account to register it',async()=>{
      const aCookie=await login(a);const bCookie=await login(b);
      const current=endpoint('logout-current');const otherDevice=endpoint('logout-other-device');const otherAccount=endpoint('logout-other-account');
      await register(aCookie,current);await register(await login(a),otherDevice);await register(bCookie,otherAccount);
      const response=await request('/auth/logout',{cookie:aCookie,method:'POST',body:{pushEndpoint:current}});
      assert.equal(response.status,200);assert.deepEqual(response.data,{ok:true});
      assert.equal((await request('/auth/me',{cookie:aCookie})).status,401);
      assert.equal(await db.pushSubscription.findUnique({where:{endpoint:current}}),null);
      assert.equal((await db.pushSubscription.findUnique({where:{endpoint:otherDevice}})).userId,a.id);
      assert.equal((await db.pushSubscription.findUnique({where:{endpoint:otherAccount}})).userId,b.id);
      await register(bCookie,current);
      assert.equal((await db.pushSubscription.findUnique({where:{endpoint:current}})).userId,b.id);
    });

    await t.test('logout cannot revoke another account device and remains compatible without a device endpoint',async()=>{
      const address=endpoint('logout-protected');const bCookie=await login(b);await register(bCookie,address);
      const ownAddress=endpoint('logout-backward-compatible');let aCookie=await login(a);await register(aCookie,ownAddress);
      for(const body of [{pushEndpoint:address},{},undefined]) {
        aCookie=await login(a);
        const response=await request('/auth/logout',{cookie:aCookie,method:'POST',body});
        assert.equal(response.status,200);assert.equal((await request('/auth/me',{cookie:aCookie})).status,401);
        assert.equal((await db.pushSubscription.findUnique({where:{endpoint:address}})).userId,b.id);
        assert.equal((await db.pushSubscription.findUnique({where:{endpoint:ownAddress}})).userId,a.id);
      }
      assert.equal((await request('/auth/logout',{method:'POST',body:{pushEndpoint:address}})).status,200);
      assert.equal((await db.pushSubscription.findUnique({where:{endpoint:address}})).userId,b.id);
    });

    await t.test('a failed session deletion rolls back device revocation',async()=>{
      const aCookie=await login(a);const address=endpoint('logout-atomic');await register(aCookie,address);
      await db.$executeRawUnsafe(`CREATE FUNCTION "${schema}".reject_test_logout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only session deletion failure'; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER reject_test_logout BEFORE DELETE ON "${schema}"."Session" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_test_logout()`);
      try {
        assert.equal((await request('/auth/logout',{cookie:aCookie,method:'POST',body:{pushEndpoint:address}})).status,500);
        assert.equal((await request('/auth/me',{cookie:aCookie})).status,200);
        assert.equal((await db.pushSubscription.findUnique({where:{endpoint:address}})).userId,a.id);
      } finally {await db.$executeRawUnsafe(`DROP FUNCTION "${schema}".reject_test_logout() CASCADE`);}
    });

    await t.test('queued delivery skips a device revoked after subscriptions were loaded',async()=>{
      const first=await student('dispatch-first');const next=await student('dispatch-revoked');
      const firstAddress=endpoint('dispatch-first');const revokedAddress=endpoint('dispatch-revoked');
      await register(await login(first),firstAddress);const nextCookie=await login(next);await register(nextCookie,revokedAddress);
      const firstEvent=await db.notification.create({data:{userId:first.id,eventKey:'test-only-dispatch-first',type:'correction',title:'test-only',body:'test-only',createdAt:new Date('2020-01-01')}});
      const revokedEvent=await db.notification.create({data:{userId:next.id,eventKey:'test-only-dispatch-revoked',type:'correction',title:'test-only',body:'test-only',createdAt:new Date('2020-01-02')}});
      const deliveries=[];let revokeResponse;
      await deliverPendingPush(db,async(subscription,payload)=>{
        const {id}=JSON.parse(payload);deliveries.push({id,endpoint:subscription.endpoint});
        if(id===firstEvent.id) revokeResponse=await request('/student/push-subscriptions',{cookie:nextCookie,method:'DELETE',body:{endpoint:revokedAddress}});
        return {statusCode:201};
      });
      assert.equal(revokeResponse.status,200);
      assert.equal(await db.pushSubscription.findUnique({where:{endpoint:revokedAddress}}),null);
      assert.deepEqual(deliveries,[{id:firstEvent.id,endpoint:firstAddress}]);
      assert.equal((await db.notification.findUnique({where:{id:revokedEvent.id}})).pushState,'no_subscription');
    });
  } finally {
    if(server) await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    const cleanup=[];
    try {await db?.$disconnect();} catch(error) {cleanup.push(error);}
    if(schemaCreated) try {await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);} catch(error) {cleanup.push(error);}
    try {await admin.$disconnect();} catch(error) {cleanup.push(error);}
    if(temp) try {await rm(temp,{recursive:true,force:true});} catch(error) {cleanup.push(error);}
    if(cleanup.length) throw new AggregateError(cleanup,'Push test cleanup failed');
  }
});
