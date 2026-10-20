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
import { WEEKS, activityDates } from '../backend/src/domain/index.js';
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
  const passwordHash=await hashPassword('QaOnly1234!');
  await db.user.create({data:{role:'teacher',studentNumber:'qa-teacher',name:'검증 교사',passwordHash,mustChangePassword:false}});
  const student=await db.user.create({data:{role:'student',studentNumber:'qa-student',name:'검증 학생',grade:2,classNumber:3,targetType:'required',participating:true,passwordHash,mustChangePassword:false}});
  const second=await db.user.create({data:{role:'student',studentNumber:'qa-zero',name:'기록 구분 검증',grade:1,classNumber:1,targetType:'required',participating:true,passwordHash,mustChangePassword:false}});
  for(const week of WEEKS.filter(w=>!w.deferred))for(const date of activityDates(week).slice(0,5))await db.dailyRecord.create({data:{userId:student.id,date,value:week.inputType==='walking'?5:week.inputType==='check'?true:week.inputType==='dumbbell'?Object.fromEntries(week.exercises.map(exercise=>[exercise.id,exercise.targetSets])):week.weeklyTarget/5}});
  await db.dailyRecord.create({data:{userId:second.id,date:'2026-06-08',value:0}});
  await db.dailyRecord.create({data:{userId:second.id,date:'2026-05-04',value:0}});
  await db.dailyRecord.create({data:{userId:second.id,date:'2026-06-01',value:false}});
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
