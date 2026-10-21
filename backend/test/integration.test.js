import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm,readFile,readdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { runMembershipApiCases } from './membership-api-cases.js';
import { runChallengeApiCases } from './challenge-api-cases.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/password.js';
import { createReminderEvents,deliverPendingPush } from '../src/notifications.js';
const legacyId='challenge-2026-self-fit';
const run=promisify(execFile);const require=createRequire(import.meta.url);
const backendDir=fileURLToPath(new URL('../',import.meta.url));
test('isolated PostgreSQL API integration', {skip:!process.env.TEST_DATABASE_URL,timeout:180000}, async t=>{
  const baseUrl=new URL(process.env.TEST_DATABASE_URL);
  assert.match(baseUrl.pathname,/_test$/,'Integration tests require a dedicated database name ending in _test');
  const schema=`test_${randomUUID().replaceAll('-','')}`;
  const admin=new PrismaClient({datasourceUrl:baseUrl.toString()});
  let db,server,temp,schemaCreated=false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);schemaCreated=true;
    baseUrl.searchParams.set('schema',schema);
    temp=await mkdtemp(path.join(tmpdir(),'self-fit-test-'));
    await run(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{cwd:backendDir,env:{...process.env,DATABASE_URL:baseUrl.toString()},timeout:60000});
    db=new PrismaClient({datasourceUrl:baseUrl.toString()});
    let loginReadHook=null,transactionHook=null,deletionHook=null;
    const userDelegate=new Proxy(db.user,{get(target,key){if(key==='findUnique')return args=>loginReadHook?loginReadHook(args):target.findUnique(args);if(key==='delete')return args=>deletionHook?deletionHook(args):target.delete(args);return target[key];}});
    const apiDb=new Proxy(db,{get(target,key){if(key==='user')return userDelegate;if(key==='$transaction')return(...args)=>transactionHook?transactionHook(...args):target.$transaction(...args);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    const app=await createApp(apiDb,{storageDir:temp});
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const origin=`http://127.0.0.1:${server.address().port}/api`;
    const request=async(route,{cookie,body,method='GET',raw=false,headers={}}={})=>{
      const response=await fetch(origin+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined||body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
      const data=raw?Buffer.from(await response.arrayBuffer()):await response.json();
      return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
    };
    const login=async(studentNumber,password)=>request('/auth/login',{method:'POST',body:{studentNumber,password}});
    const password='integration-only-password123';const passwordHash=await hashPassword(password);
    const teacher=await db.user.create({data:{role:'teacher',studentNumber:'test-teacher',name:'TEST ONLY',passwordHash,mustChangePassword:false}});
    const a=await db.user.create({data:{role:'student',studentNumber:'test-001',name:'TEST A',grade:1,classNumber:1,targetType:'required',passwordHash,mustChangePassword:false}});
    const b=await db.user.create({data:{role:'student',studentNumber:'test-002',name:'TEST B',grade:1,classNumber:2,targetType:'optional',passwordHash,mustChangePassword:false}});
    await db.challengeMembership.create({data:{challengeId:legacyId,userId:a.id,mode:'forced',status:'active',invitedById:teacher.id}});
    const teacherCookie=(await login(teacher.studentNumber,password)).cookie;
    const aCookie=(await login(a.studentNumber,password)).cookie;
    const bCookie=(await login(b.studentNumber,password)).cookie;
    await t.test('student deletion preserves archived source evidence with a clear conflict',async()=>{
      const student=await db.user.create({data:{role:'student',studentNumber:'test-source-only',name:'SOURCE ONLY',grade:1,classNumber:1,targetType:'optional',passwordHash,mustChangePassword:false}});
      const dataset=await db.sourceDataset.create({data:{hash:randomUUID().replaceAll('-','').padEnd(64,'0'),filename:'synthetic-deletion-test.xlsx',metadataJson:{isSynthetic:true}}});
      try {
        await db.studentSource.create({data:{datasetId:dataset.id,userId:student.id,rosterJson:{isSynthetic:true}}});
        assert.equal(await db.dailyRecord.count({where:{userId:student.id}}),0);
        const result=await request(`/teacher/students/${student.id}`,{method:'DELETE',cookie:teacherCookie});
        assert.equal(result.status,409);
        assert.equal(result.data.error.code,'HAS_SOURCE_DATA');
        assert(await db.user.findUnique({where:{id:student.id}}));
        assert.equal(await db.studentSource.count({where:{userId:student.id}}),1);
      } finally {
        await db.studentSource.deleteMany({where:{userId:student.id}});
        await db.sourceDataset.delete({where:{id:dataset.id}});
        await db.user.delete({where:{id:student.id}});
      }
    });
    await t.test('student deletion preserves evidence added after the pre-check and still deletes an empty account',async()=>{
      const student=await db.user.create({data:{role:'student',studentNumber:'test-source-race',name:'SOURCE RACE',grade:1,classNumber:1,targetType:'optional',passwordHash,mustChangePassword:false}});
      const dataset=await db.sourceDataset.create({data:{hash:randomUUID().replaceAll('-','').padEnd(64,'0'),filename:'synthetic-delete-race.xlsx',metadataJson:{isSynthetic:true}}});
      try {
        deletionHook=async args=>{
          await db.studentSource.create({data:{datasetId:dataset.id,userId:student.id,rosterJson:{isSynthetic:true}}});
          return db.user.delete(args);
        };
        const result=await request(`/teacher/students/${student.id}`,{method:'DELETE',cookie:teacherCookie});
        assert.equal(result.status,409);
        assert.equal(result.data.error.code,'HAS_EVIDENCE');
        assert(await db.user.findUnique({where:{id:student.id}}));
        assert.equal(await db.studentSource.count({where:{userId:student.id}}),1);
        deletionHook=null;
        await db.studentSource.deleteMany({where:{userId:student.id}});
        assert.equal((await request(`/teacher/students/${student.id}`,{method:'DELETE',cookie:teacherCookie})).status,200);
        assert.equal(await db.user.findUnique({where:{id:student.id}}),null);
      } finally {
        deletionHook=null;
        await db.studentSource.deleteMany({where:{userId:student.id}});
        await db.sourceDataset.delete({where:{id:dataset.id}});
        await db.user.deleteMany({where:{id:student.id}});
      }
    });
    await t.test('participation analytics use 12 weeks, filter the participating cohort, and require teacher access',async()=>{
      assert.equal((await request('/teacher/participation')).status,401);
      assert.equal((await request('/teacher/participation',{cookie:aCookie})).status,403);
      const records=await db.dailyRecord.createMany({data:[
        {challengeId:legacyId,userId:a.id,date:'2026-05-25',value:500},
        {challengeId:legacyId,userId:a.id,date:'2026-05-26',value:500},
        {challengeId:legacyId,userId:b.id,date:'2026-05-25',value:1000},
      ]});
      assert.equal(records.count,3);
      try {
        const result=await request('/teacher/participation',{cookie:teacherCookie});
        assert.equal(result.status,200);
        assert.deepEqual(result.data.summary,{participants:1,completedWeeks:1,possibleWeeks:12,completionRate:1/12*100,totalWeeks:12,pendingWeeks:[]});
        assert.equal(result.data.weeks[2].completionRate,100);
        assert.equal(result.data.weeks[11].completionRate,0);
        assert.equal(result.data.weeks[11].pending,false);
        assert.deepEqual(result.data.filterOptions,{grades:[1],classes:[{grade:1,classNumber:1},{grade:1,classNumber:2}]});
        assert.equal(result.data.targets.find(group=>group.targetType==='optional').completionRate,null);
        const filtered=await request('/teacher/participation?grade=1&classNumber=1&targetType=required',{cookie:teacherCookie});
        assert.deepEqual(filtered.data.summary,result.data.summary);
        assert.deepEqual(filtered.data.filters,{grade:1,classNumber:1,targetType:'required'});
        for(const query of ['classNumber=2','targetType=optional','grade=2']) {
          const empty=await request('/teacher/participation?'+query,{cookie:teacherCookie});
          assert.equal(empty.status,200);assert.equal(empty.data.summary.participants,0);
          assert.equal(empty.data.summary.completionRate,null);assert.deepEqual(empty.data.grades,[]);
          assert.deepEqual(empty.data.filterOptions,result.data.filterOptions);
        }
        for(const query of ['grade=0','classNumber=x','targetType=unknown']) {
          assert.equal((await request('/teacher/participation?'+query,{cookie:teacherCookie})).status,400);
        }
        assert.equal((await request('/teacher/participation?participating=false',{cookie:teacherCookie})).data.summary.participants,1);
        for(const privateField of ['studentNumber','passwordHash','records','attachments','sourceMetadata']) assert.ok(!JSON.stringify(result.data).includes('"'+privateField+'"'));
      } finally {
        await db.dailyRecord.deleteMany({where:{userId:{in:[a.id,b.id]},date:{in:['2026-05-25','2026-05-26']}}});
      }
    });
    await t.test('authentication, roles, ended date, and no past record backfill',async()=>{
      assert.equal((await request('/student/dashboard')).status,401);
      assert.equal((await request('/teacher/overview',{cookie:aCookie})).status,403);
      assert.equal((await login(a.studentNumber,'wrong')).status,401);
      const program=await request('/program',{cookie:aCookie});assert.equal(program.data.status,'ended');assert.equal(program.data.activityDates.length,82);
      assert.equal((await request('/student/enroll',{cookie:bCookie,method:'POST',body:{}})).status,403);
      assert.equal((await request('/student/records/2026-06-08',{cookie:aCookie,method:'PUT',body:{value:100}})).status,403);
      assert.equal((await request('/student/records/2026-06-08/corrections',{cookie:aCookie,method:'POST',body:{value:100,version:1,reason:'test'}})).status,404);
      assert.equal((await request('/auth/logout',{cookie:aCookie,method:'POST',body:{},headers:{Origin:'https://untrusted.invalid'}})).status,403);
      assert.equal((await request('/student/push-subscriptions',{cookie:aCookie,method:'POST',body:{endpoint:'https://127.0.0.1/internal',keys:{p256dh:'x',auth:'y'}}})).status,400);
    });
    await t.test('dumbbell input, partial blanks, corrections, analytics, and detailed export stay consistent',async()=>{
      const completed={D12_CURL:2,D12_SQUAT:2,D12_ROW:2};
      const partial={D12_CURL:3,D12_SQUAT:0,D12_ROW:null};
      await db.dailyRecord.createMany({data:['2026-08-31','2026-09-01'].map(date=>({challengeId:legacyId,userId:a.id,date,value:completed}))});
      t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-02T01:00:00Z')});
      try {
        assert.equal((await request('/program',{cookie:aCookie})).data.week12Pending,false);
        for(const value of [6,{D12_CURL:2,D12_SQUAT:2},{D12_CURL:null,D12_SQUAT:null,D12_ROW:null},{...completed,D12_ROW:-1}]) {
          assert.equal((await request('/student/records/2026-09-02',{cookie:aCookie,method:'PUT',body:{value}})).status,400);
        }
        const saved=await request('/student/records/2026-09-02',{cookie:aCookie,method:'PUT',body:{value:partial}});
        assert.equal(saved.status,200);assert.deepEqual(saved.data.record.value,partial);
        assert.equal(saved.data.summary.weeks[11].complete,false);assert.equal(saved.data.summary.weeks[11].total,2);
        const detail=await request('/student/records/2026-09-02',{cookie:aCookie});
        assert.equal(detail.data.dailyStatus,'below_target');assert.equal(detail.data.week.exercises.length,3);
        t.mock.timers.setTime(new Date('2026-09-03T01:00:00Z').getTime());
        const unchanged=await request('/student/records/2026-09-02/corrections',{cookie:aCookie,method:'POST',body:{value:{D12_ROW:null,D12_SQUAT:0,D12_CURL:3},version:1,reason:'same'}});
        assert.equal(unchanged.status,400);assert.equal(unchanged.data.error.code,'UNCHANGED_VALUE');
        const pending=await request('/student/records/2026-09-02/corrections',{cookie:aCookie,method:'POST',body:{value:completed,version:1,reason:'덤벨 세트 정정'}});
        assert.equal(pending.status,201);
        assert.equal((await request('/teacher/participation',{cookie:teacherCookie})).data.weeks[11].completed,0);
        const exportedBefore=await request('/teacher/export?week=12',{cookie:teacherCookie,raw:true});
        const beforeBook=new ExcelJS.Workbook();await beforeBook.xlsx.load(exportedBefore.data);
        const beforeRows=[];beforeBook.getWorksheet('덤벨 상세').eachRow((row,index)=>{if(index>1&&row.getCell(1).value===a.studentNumber&&row.getCell(3).value==='2026-09-02')beforeRows.push(row.values.slice(1));});
        assert.deepEqual(beforeRows.map(row=>[row[3],row[7],row[8]]),[['D12_CURL',3,30],['D12_SQUAT',0,0],['D12_ROW','미입력','미입력']]);
        assert.equal((await request(`/teacher/corrections/${pending.data.correction.id}/approve`,{cookie:teacherCookie,method:'POST',body:{}})).status,200);
        const approved=await request('/student/records',{cookie:aCookie});
        assert.equal(approved.data.summary.weeks[11].complete,true);assert.equal(approved.data.summary.weeks[11].total,3);
        assert.deepEqual(approved.data.summary.pendingWeeks,[]);
        const analytics=await request('/teacher/participation',{cookie:teacherCookie});
        assert.equal(analytics.data.weeks[11].completed,1);assert.equal(analytics.data.weeks[11].completionRate,100);
        assert.equal(analytics.data.summary.completedWeeks,1);assert.equal(analytics.data.summary.possibleWeeks,12);
        assert.equal((await request('/student/records/2026-09-02',{cookie:aCookie})).data.record.history.length,1);
      } finally {
        t.mock.timers.reset();
        await db.notification.deleteMany({where:{userId:a.id,type:'correction'}});
        const where={record:{challengeId:legacyId,userId:a.id,date:{gte:'2026-08-31',lte:'2026-09-04'}}};
        await db.correction.deleteMany({where});
        await db.recordRevision.deleteMany({where});
        await db.dailyRecord.deleteMany({where:{challengeId:legacyId,userId:a.id,date:{gte:'2026-08-31',lte:'2026-09-04'}}});
      }
    });
    await t.test('password reset racing with an in-flight old-password login cannot mint a session',async()=>{
      const raceUser=await db.user.create({data:{role:'student',studentNumber:'test-race',name:'TEST RACE',grade:1,classNumber:1,targetType:'optional',passwordHash,mustChangePassword:false}});
      const original=db.user.findUnique.bind(db.user);let release;let arrived;
      const paused=new Promise(resolve=>{arrived=resolve;});const resume=new Promise(resolve=>{release=resolve;});
      loginReadHook=async args=>{const result=await original(args);if(args.where.studentNumber===raceUser.studentNumber){arrived();await resume;}return result;};
      try {
        const pendingLogin=login(raceUser.studentNumber,password);await paused;
        const reset=await request(`/teacher/students/${raceUser.id}/reset-password`,{cookie:teacherCookie,method:'POST',body:{}});assert.equal(reset.status,200);
        release();assert.equal((await pendingLogin).status,401);assert.equal(await db.session.count({where:{userId:raceUser.id}}),0);
      } finally {release();loginReadHook=null;await db.user.delete({where:{id:raceUser.id}});}
    });
    await t.test('correction preserves current value, owner isolation, approval audit, notification dedupe',async()=>{
      const record=await db.dailyRecord.create({data:{challengeId:legacyId,userId:a.id,date:'2026-06-08',value:100}});
      const pending=await request('/student/records/2026-06-08/corrections',{cookie:aCookie,method:'POST',body:{value:250,version:1,reason:'입력 오류'}});
      assert.equal(pending.status,201);assert.equal((await db.dailyRecord.findUnique({where:{id:record.id}})).value,100);
      const preview=(await request('/teacher/corrections',{cookie:teacherCookie})).data.corrections[0].preview;
      assert.equal(preview.before.total,100);assert.equal(preview.after.total,250);
      assert.equal((await request('/student/records/2026-06-08',{cookie:bCookie})).data.record,null);
      assert.equal((await request('/student/records/2026-06-08/corrections',{cookie:aCookie,method:'POST',body:{value:200,version:1,reason:'중복'}})).status,409);
      const approved=await request(`/teacher/corrections/${pending.data.correction.id}/approve`,{cookie:teacherCookie,method:'POST',body:{}});
      assert.equal(approved.status,200);assert.equal(approved.data.record.value,250);assert.equal(approved.data.record.version,2);
      assert.equal((await request(`/teacher/corrections/${pending.data.correction.id}/approve`,{cookie:teacherCookie,method:'POST',body:{}})).status,409);
      assert.equal(await db.notification.count({where:{userId:a.id,type:'correction'}}),1);
      const details=await request(`/teacher/students/${a.id}`,{cookie:teacherCookie});assert.equal(details.data.records[0].history[0].beforeValue,100);assert.equal(details.data.records[0].history[0].afterValue,250);
    });
    await t.test('stale approval is atomic; rejection requires reason',async()=>{
      const pending=await request('/student/records/2026-06-08/corrections',{cookie:aCookie,method:'POST',body:{value:300,version:2,reason:'수정'}});
      const id=pending.data.correction.id;
      await db.dailyRecord.update({where:{challengeId_userId_date:{challengeId:legacyId,userId:a.id,date:'2026-06-08'}},data:{value:275,version:{increment:1}}});
      assert.equal((await request(`/teacher/corrections/${id}/approve`,{cookie:teacherCookie,method:'POST',body:{}})).status,409);
      assert.equal((await db.correction.findUnique({where:{id}})).status,'pending');
      assert.equal((await request('/teacher/corrections',{cookie:teacherCookie})).data.corrections[0].preview,null);
      assert.equal((await request(`/teacher/corrections/${id}/reject`,{cookie:teacherCookie,method:'POST',body:{reason:''}})).status,400);
      assert.equal((await request(`/teacher/corrections/${id}/reject`,{cookie:teacherCookie,method:'POST',body:{reason:'현재 기록 확인 필요'}})).status,200);
      assert.equal((await db.dailyRecord.findUnique({where:{challengeId_userId_date:{challengeId:legacyId,userId:a.id,date:'2026-06-08'}}})).value,275);
    });
    await t.test('roster validation and one-time commit, temp password change, reset revokes sessions',async()=>{
      const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('명단');sheet.addRow(['학번','이름','학년','반','대상구분']);sheet.addRow(['test-003','TEST C',2,3,'선택']);
      const form=new FormData();form.append('file',new Blob([await workbook.xlsx.writeBuffer()]),'roster.xlsx');
      const preview=await request('/teacher/roster/validate',{cookie:teacherCookie,method:'POST',body:form});assert.equal(preview.status,200);assert.equal(preview.data.errors.length,0);
      assert.equal(await db.user.count({where:{studentNumber:'test-003'}}),0);
      const committed=await request('/teacher/roster/commit',{cookie:teacherCookie,method:'POST',body:{importId:preview.data.importId}});assert.equal(committed.status,201);assert.equal(committed.data.created,1);
      assert.equal((await request('/teacher/roster/commit',{cookie:teacherCookie,method:'POST',body:{importId:preview.data.importId}})).status,409);
      const credentials=committed.data.credentials[0];const logged=await login(credentials.studentNumber,credentials.temporaryPassword);
      assert.equal(logged.data.user.mustChangePassword,true);assert.equal((await request('/student/dashboard',{cookie:logged.cookie})).status,403);
      const changed=await request('/auth/change-password',{cookie:logged.cookie,method:'POST',body:{newPassword:'new-integration-password123'}});assert.equal(changed.status,200);
      assert.equal((await request('/student/dashboard',{cookie:logged.cookie})).status,200);
      assert.equal((await request(`/teacher/students/${logged.data.user.id}/reset-password`,{cookie:teacherCookie,method:'POST',body:{}})).status,200);
      assert.equal((await request('/auth/me',{cookie:logged.cookie})).status,401);
    });
    await t.test('XLSX formulas and oversized expanded archives are rejected without importing students',async()=>{
      const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('명단');sheet.addRow(['학번','이름','학년','반','대상구분']);sheet.addRow([{formula:'1+1',result:2},'TEST FORMULA',1,1,'필수']);
      const buffer=Buffer.from(await workbook.xlsx.writeBuffer());
      const upload=async bytes=>{const form=new FormData();form.append('file',new Blob([bytes]),'roster.xlsx');return request('/teacher/roster/validate',{cookie:teacherCookie,method:'POST',body:form});};
      const formula=await upload(buffer);assert.equal(formula.status,200);assert.equal(formula.data.importId,null);assert.match(formula.data.errors[0].message,/수식/);
      const oversized=Buffer.from(buffer);const central=oversized.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));oversized.writeUInt32LE(100*1024*1024,central+24);
      assert.equal((await upload(oversized)).status,413);assert.equal(await db.user.count({where:{name:'TEST FORMULA'}}),0);
    });
    await t.test('private attachments, quotas, actual media inspection, and record survives upload error',async()=>{
      t.mock.timers.enable({apis:['Date'],now:new Date('2026-05-19T01:00:00Z')});
      try {
        const saved=await request('/student/records/2026-05-19',{cookie:aCookie,method:'PUT',body:{value:true}});assert.equal(saved.status,200);
        const replaced=await request('/student/records/2026-05-19',{cookie:aCookie,method:'PUT',body:{value:false,version:1}});assert.equal(replaced.status,200);assert.equal(replaced.data.record.value,false);
        assert.equal((await request('/student/records/2026-05-19',{cookie:aCookie,method:'PUT',body:{value:true,version:1}})).status,409);
        const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=','base64');
        const upload=async(buffer,name)=>{const form=new FormData();form.append('file',new Blob([buffer]),name);return request('/student/records/2026-05-19/attachments',{cookie:aCookie,method:'POST',body:form});};
        const first=await upload(png,'test.png');assert.equal(first.status,201);
        assert.equal((await request(`/attachments/${first.data.attachment.id}`,{cookie:bCookie})).status,403);
        assert.equal((await request(`/attachments/${first.data.attachment.id}`,{cookie:teacherCookie,raw:true})).status,200);
        assert.equal((await upload(png,'test2.png')).status,201);assert.equal((await upload(png,'test3.png')).status,201);assert.equal((await upload(png,'test4.png')).status,409);
        assert.equal((await upload(Buffer.from('not an image'),'fake.png')).status,415);
        const ffmpeg=process.env.FFMPEG_PATH || 'ffmpeg';
        const ffmpegAvailable=await run(ffmpeg,['-version'],{timeout:10000}).then(()=>true,error=>{if(error.code==='ENOENT') return false;throw error;});
        if(ffmpegAvailable) {
          const video=path.join(temp,'test-long.mp4');
          await run(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=16x16:r=1','-t','61','-pix_fmt','yuv420p',video],{timeout:30000});
          assert.equal((await upload(await readFile(video),'long.mp4')).data.error.code,'VIDEO_TOO_LONG');
          const validVideo=path.join(temp,'test-short.mp4');await run(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=16x16:r=1','-t','1','-pix_fmt','yuv420p',validVideo],{timeout:30000});
          assert.equal((await upload(await readFile(validVideo),'short.mp4')).status,201);
        } else t.diagnostic('ffmpeg not found (set FFMPEG_PATH); video length checks skipped');
        assert.equal((await db.dailyRecord.findUnique({where:{id:saved.data.record.id}})).value,false);
        const initialCount=await db.attachment.count({where:{recordId:saved.data.record.id}});
        const abortRequest=httpRequest(`${origin}/student/records/2026-05-19/attachments`,{method:'POST',headers:{Cookie:aCookie,'Content-Type':'multipart/form-data; boundary=test-abort'}});
        abortRequest.on('error',()=>{});
        abortRequest.write('--test-abort\r\nContent-Disposition: form-data; name="file"; filename="aborted.png"\r\nContent-Type: image/png\r\n\r\n');abortRequest.write(png);
        for(let attempt=0;attempt<100;attempt++){if((await readdir(path.join(temp,'.staging'))).length)break;await new Promise(resolve=>setTimeout(resolve,10));}
        abortRequest.destroy();
        for(let attempt=0;attempt<100;attempt++){if(!(await readdir(path.join(temp,'.staging'))).length)break;await new Promise(resolve=>setTimeout(resolve,10));}
        assert.deepEqual(await readdir(path.join(temp,'.staging')),[]);assert.equal(await db.attachment.count({where:{recordId:saved.data.record.id}}),initialCount);
      } finally {t.mock.timers.reset();}
    });
    await t.test('writes crossing midnight are rechecked before commit, while accepted uploads may finish',async()=>{
      t.mock.timers.enable({apis:['Date'],now:new Date('2026-05-19T14:59:59Z')});
      const original=db.$transaction.bind(db);let changed=false;
      transactionHook=async(...args)=>{if(!changed){changed=true;t.mock.timers.setTime(new Date('2026-05-19T15:00:00Z').getTime());}return original(...args);};
      try {
        assert.equal((await request('/student/records/2026-05-19',{cookie:aCookie,method:'PUT',body:{value:true,version:2}})).status,403);
        assert.equal((await db.dailyRecord.findUnique({where:{challengeId_userId_date:{challengeId:legacyId,userId:a.id,date:'2026-05-19'}}})).value,false);
      } finally {transactionHook=null;t.mock.timers.reset();}
      t.mock.timers.enable({apis:['Date'],now:new Date('2026-05-20T14:59:59Z')});
      try {
        const saved=await request('/student/records/2026-05-20',{cookie:aCookie,method:'PUT',body:{value:true}});assert.equal(saved.status,200);
        const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=','base64');
        let responsePromise;
        const upload=httpRequest(`${origin}/student/records/2026-05-20/attachments`,{method:'POST',headers:{Cookie:aCookie,'Content-Type':'multipart/form-data; boundary=midnight'}});
        responsePromise=new Promise((resolve,reject)=>{upload.on('response',response=>{let data='';response.on('data',chunk=>data+=chunk);response.on('end',()=>resolve({status:response.statusCode,data:JSON.parse(data)}));});upload.on('error',reject);});
        upload.write('--midnight\r\nContent-Disposition: form-data; name="file"; filename="midnight.png"\r\nContent-Type: image/png\r\n\r\n');upload.write(png);
        for(let attempt=0;attempt<100;attempt++){if((await readdir(path.join(temp,'.staging'))).length)break;await new Promise(resolve=>setTimeout(resolve,10));}
        assert.equal((await readdir(path.join(temp,'.staging'))).length,1);
        t.mock.timers.setTime(new Date('2026-05-20T15:00:01Z').getTime());upload.end('\r\n--midnight--\r\n');
        assert.equal((await responsePromise).status,201);
        const form=new FormData();form.append('file',new Blob([png]),'too-late.png');
        assert.equal((await request('/student/records/2026-05-20/attachments',{cookie:aCookie,method:'POST',body:form})).status,403);
      } finally {t.mock.timers.reset();}
    });
    await t.test('ended reminders disabled, eligible event is unique, export preserves semantics',async()=>{
      assert.equal((await createReminderEvents(db,new Date('2026-10-20T12:00:00Z'))).created,0);
      const first=await createReminderEvents(db,new Date('2026-06-08T11:00:00Z'));assert.equal(first.created,1);
      assert.equal((await createReminderEvents(db,new Date('2026-06-08T12:00:00Z'))).created,0);
      const exported=await request('/teacher/export?week=1',{cookie:teacherCookie,raw:true});assert.equal(exported.status,200);
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(exported.data);assert.equal(workbook.worksheets.length,5);
      assert.equal(workbook.getWorksheet('날짜별 기록').getRow(2).getCell(7).value,'미입력');
      const overview=await request('/teacher/overview',{cookie:teacherCookie});assert.equal(overview.data.stats.denominator,1);
      const historyExport=await request('/teacher/corrections/export?status=all',{cookie:teacherCookie,raw:true});assert.equal(historyExport.status,200);
      const history=new ExcelJS.Workbook();await history.xlsx.load(historyExport.data);assert.equal(history.getWorksheet('정정 처리 이력').rowCount,3);
      const formulaName='=HYPERLINK("https://example.invalid","test")';await db.user.update({where:{id:b.id},data:{name:formulaName}});
      const textExport=await request(`/teacher/export?studentIds=${b.id}`,{cookie:teacherCookie,raw:true});const textBook=new ExcelJS.Workbook();await textBook.xlsx.load(textExport.data);const cell=textBook.getWorksheet('참여자 요약').getRow(2).getCell(2);assert.equal(cell.type,ExcelJS.ValueType.String);assert.equal(cell.value,formulaName);
    });
    await t.test('push dispatch rechecks stale dates, completed goals and excluded days without blocking correction results',async()=>{
      const user=await db.user.create({data:{role:'student',studentNumber:'test-notification-only',name:'TEST NOTIFICATION',grade:1,classNumber:1,targetType:'required',passwordHash,mustChangePassword:false}});
      await db.challengeMembership.create({data:{challengeId:legacyId,userId:user.id,mode:'forced',status:'active',invitedById:teacher.id}});
      await db.pushSubscription.create({data:{userId:user.id,endpoint:'https://fcm.googleapis.com/test-only-no-network',p256dh:'test-only',auth:'test-only'}});
      t.mock.timers.enable({apis:['Date'],now:new Date('2026-06-09T11:00:00Z')});
      const sent=[];
      const transport=async(subscription,payload)=>{const message=JSON.parse(payload);sent.push(message.id);if(message.title==='retry-test') throw new Error('test-only transient failure');return {statusCode:201};};
      const event=async(date,title='reminder-test')=>db.notification.create({data:{userId:user.id,eventKey:`reminder:${legacyId}:${user.id}:${date}`,type:'reminder',title,body:'test-only',nextTryAt:new Date()}});
      const state=async id=>(await db.notification.findUnique({where:{id}})).pushState;
      try {
        await db.dailyRecord.create({data:{challengeId:legacyId,userId:user.id,date:'2026-06-08',value:100}});
        const stale=await event('2026-06-08');const retry=await event('2026-06-09','retry-test');
        await deliverPendingPush(db,transport);
        assert.equal(await state(stale.id),'cancelled');assert.equal(await state(retry.id),'retry');assert.equal(sent.filter(id=>id===retry.id).length,1);
        await db.dailyRecord.create({data:{challengeId:legacyId,userId:user.id,date:'2026-06-09',value:400}});
        t.mock.timers.setTime(new Date('2026-06-09T11:02:00Z').getTime());
        await deliverPendingPush(db,transport);
        assert.equal(await state(retry.id),'cancelled');assert.equal(sent.filter(id=>id===retry.id).length,1);
        assert.ok(await db.notification.findUnique({where:{id:retry.id}}),'cancellation preserves the in-app event');

        t.mock.timers.setTime(new Date('2026-05-19T11:00:00Z').getTime());
        await db.dailyRecord.create({data:{challengeId:legacyId,userId:user.id,date:'2026-05-19',value:true}});
        const dailyMet=await event('2026-05-19');await deliverPendingPush(db,transport);
        assert.equal(await state(dailyMet.id),'cancelled');assert.ok(!sent.includes(dailyMet.id));

        t.mock.timers.setTime(new Date('2026-05-23T11:00:00Z').getTime());
        const weekendOff=await event('2026-05-23');await deliverPendingPush(db,transport);
        assert.equal(await state(weekendOff.id),'cancelled');assert.ok(!sent.includes(weekendOff.id));

        t.mock.timers.setTime(new Date('2026-05-13T11:00:00Z').getTime());
        const excluded=await event('2026-05-13');await deliverPendingPush(db,transport);
        assert.equal(await state(excluded.id),'cancelled');assert.ok(!sent.includes(excluded.id));

        t.mock.timers.setTime(new Date('2026-10-20T11:00:00Z').getTime());
        const ended=await event('2026-10-20');
        const correction=await db.notification.create({data:{userId:user.id,eventKey:`correction:test-only-${user.id}`,type:'correction',title:'correction-test',body:'test-only',nextTryAt:new Date()}});
        await deliverPendingPush(db,transport);
        assert.equal(await state(ended.id),'cancelled');assert.ok(!sent.includes(ended.id));
        assert.equal(await state(correction.id),'sent');assert.equal(sent.filter(id=>id===correction.id).length,1);
      } finally {
        t.mock.timers.reset();await db.dailyRecord.deleteMany({where:{userId:user.id}});await db.user.delete({where:{id:user.id}});
      }
    });
    await runChallengeApiCases(t,{db,request,teacherCookie,a,b,aCookie,bCookie,origin,temp});
    await runMembershipApiCases(t,{db,request,teacherCookie,a,b,aCookie,bCookie,origin,temp});
  } finally {
    if(server) await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    const cleanup=[];
    try {await db?.$disconnect();} catch(error) {cleanup.push(error);}
    if(schemaCreated) try {await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);} catch(error) {cleanup.push(error);}
    try {await admin.$disconnect();} catch(error) {cleanup.push(error);}
    if(temp) try {await rm(temp,{recursive:true,force:true});} catch(error) {cleanup.push(error);}
    if(cleanup.length) throw new AggregateError(cleanup,'Integration cleanup failed');
  }
});
