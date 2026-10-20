import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
    const app=await createApp(db,{storageDir:temp});
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const origin=`http://127.0.0.1:${server.address().port}/api`;
    const request=async(route,{cookie,body,method='GET'}={})=>{
      const response=await fetch(origin+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
    };
    const password='push-test-only-password123';
    const passwordHash=await hashPassword(password);
    const student=async name=>db.user.create({data:{role:'student',studentNumber:`test-${name}`,name:`TEST ${name}`,grade:1,classNumber:1,targetType:'required',participating:true,passwordHash,mustChangePassword:false}});
    const login=async user=>{
      const response=await request('/auth/login',{method:'POST',body:{studentNumber:user.studentNumber,password}});
      assert.equal(response.status,200);return response.cookie;
    };
    const endpoint=name=>`https://fcm.googleapis.com/test-only-${name}`;
    const keys={p256dh:Buffer.alloc(65,1).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')};
    const register=async(cookie,address)=>{
      const response=await request('/student/push-subscriptions',{cookie,method:'POST',body:{endpoint:address,keys}});
      assert.equal(response.status,201);
    };
    const a=await student('push-a');const b=await student('push-b');

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
      await register(aCookie,current);await register(aCookie,otherDevice);await register(bCookie,otherAccount);
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
