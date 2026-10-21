// Isolated browser QA only. Never creates accounts or records in the application database.
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { createApp } from '../backend/src/app.js';
import { hashPassword } from '../backend/src/password.js';
import { LEGACY_WEEKS, activityDates, koreanDate } from '../backend/src/domain/index.js';
import { createChallenge, publish } from '../backend/src/challenges.js';
import { addMembers } from '../backend/src/memberships.js';
const run=promisify(execFile),require=createRequire(import.meta.url);
if(!process.env.TEST_DATABASE_URL)throw new Error('TEST_DATABASE_URL required');
const url=new URL(process.env.TEST_DATABASE_URL);
if(!url.pathname.endsWith('_test'))throw new Error('Only dedicated _test database allowed');
const schema=`browser_${randomUUID().replaceAll('-','')}`;
const admin=new PrismaClient({datasourceUrl:url.toString()});
await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
url.searchParams.set('schema',schema);
const temporary=await mkdtemp(path.join(tmpdir(),'self-fit-browser-'));
let db,apiServer,vite,cleaning=false;
async function cleanup(){if(cleaning)return;cleaning=true;await vite?.close();if(apiServer)await new Promise(resolve=>apiServer.close(resolve));await db?.$disconnect();await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.$disconnect();await rm(temporary,{recursive:true,force:true});}
try {
  await run(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{cwd:path.resolve('backend'),env:{...process.env,DATABASE_URL:url.toString()}});
  db=new PrismaClient({datasourceUrl:url.toString()});
  // The challenges migration creates the legacy challenge; records and memberships belong to it.
  const legacy='challenge-2026-self-fit';
  const passwordHash=await hashPassword('QaOnly1234!');
  const teacher=await db.user.create({data:{role:'teacher',studentNumber:'qa-teacher',name:'검증 교사',passwordHash,mustChangePassword:false}});
  const student=await db.user.create({data:{role:'student',studentNumber:'qa-student',name:'검증 학생',grade:2,classNumber:3,targetType:'required',passwordHash,mustChangePassword:false}});
  const second=await db.user.create({data:{role:'student',studentNumber:'qa-zero',name:'기록 구분 검증',grade:1,classNumber:1,targetType:'required',passwordHash,mustChangePassword:false}});
  for(const user of [student,second])await db.challengeMembership.create({data:{challengeId:legacy,userId:user.id,mode:'forced',status:'active'}});
  // A student with no current challenge (dashboard program:null).
  const optional=await db.user.create({data:{role:'student',studentNumber:'qa-optional',name:'미참여 검증',grade:1,classNumber:2,targetType:'optional',passwordHash,mustChangePassword:false}});
  for(const week of LEGACY_WEEKS.filter(w=>!w.deferred))for(const date of activityDates(LEGACY_WEEKS,week).slice(0,5))await db.dailyRecord.create({data:{challengeId:legacy,userId:student.id,date,value:week.inputType==='walking'?5:week.inputType==='check'?true:week.inputType==='dumbbell'?Object.fromEntries(week.exercises.map(exercise=>[exercise.id,exercise.targetSets])):week.weeklyTarget/5}});
  await db.dailyRecord.create({data:{challengeId:legacy,userId:second.id,date:'2026-06-08',value:0}});
  await db.dailyRecord.create({data:{challengeId:legacy,userId:second.id,date:'2026-05-04',value:0}});
  await db.dailyRecord.create({data:{challengeId:legacy,userId:second.id,date:'2026-06-01',value:false}});
  // Challenges around today's Korean date, created through the real services, so enrolment, invitations and
  // same-day records can be checked without moving the clock: qa-student is in the running one (forced),
  // qa-zero is invited to the upcoming one, qa-optional is invited to both (legacy enroll must ask to choose).
  const today=koreanDate(),day=offset=>{const date=new Date(`${today}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);};
  const running=await createChallenge(db,{title:'QA 진행 중 챌린지',description:'오늘이 포함된 검증용 챌린지',startDate:today,enrollmentDeadline:day(3),weeks:[
    {title:'만보 걷기',startDate:today,endDate:day(6),inputType:'walking',weeklyTarget:5,dailyTarget:null,unit:'일',dailyUnit:'보',color:'#E07A2E',description:'하루 10,000보 이상 5일'},
    {title:'줄넘기',startDate:day(14),endDate:day(20),inputType:'count',weeklyTarget:1000,dailyTarget:200,unit:'회',dailyUnit:'회',color:'#2F7FD8',description:'하루 200회, 주간 합계 1,000회'},
  ]},teacher.id);
  const upcoming=await createChallenge(db,{title:'QA 예정 챌린지',description:'아직 시작 전인 검증용 챌린지',startDate:day(30),weeks:[
    {title:'플랭크',startDate:day(30),endDate:day(36),inputType:'check',weeklyTarget:5,dailyTarget:1,unit:'일',dailyUnit:'분',color:'#8A5CD6',description:'1분 이상, 기준을 충족한 5일'},
  ]},teacher.id);
  for(const challenge of [running,upcoming])await publish(db,challenge.id);
  await addMembers(db,{challenge:running,teacher,mode:'forced',students:[student]});
  await addMembers(db,{challenge:running,teacher,mode:'invited',students:[optional]});
  await addMembers(db,{challenge:upcoming,teacher,mode:'invited',students:[second,optional]});
  process.env.APP_ORIGIN='http://127.0.0.1:5178';
  apiServer=(await createApp(db,{storageDir:temporary})).listen(4001,'127.0.0.1');
  await new Promise(resolve=>apiServer.once('listening',resolve));
  const existingTerminationListeners=new Set(process.listeners('SIGTERM'));
  vite=await createServer({configFile:false,root:path.resolve('frontend'),server:{host:'127.0.0.1',port:5178,strictPort:true,proxy:{'/api':'http://127.0.0.1:4001'}}});
  await vite.listen();
  // This process must drop its temporary schema before exiting. Vite's default
  // signal handler otherwise exits as soon as its HTTP server has closed.
  for(const listener of process.listeners('SIGTERM'))if(!existingTerminationListeners.has(listener))process.removeListener('SIGTERM',listener);
  console.log('Isolated browser QA ready: http://127.0.0.1:5178 (synthetic test fixtures only; application database unchanged)');
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>cleanup().then(()=>process.exit(0)));
} catch(error){await cleanup();throw error;}
