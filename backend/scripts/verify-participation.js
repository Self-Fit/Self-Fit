import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LEGACY_CHALLENGE_ID } from './participation-data.js';
const directory = path.resolve(process.argv[2]);
const credentials = JSON.parse(await fs.readFile(path.join(directory,'accounts.private.json'),'utf8'));
const result = JSON.parse(await fs.readFile(path.join(directory,'import-result.json'),'utf8'));
const origin='http://127.0.0.1:4000/api';
async function request(route,{cookie,body,raw=false}={}) {
  const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{
    ...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:raw?Buffer.from(await response.arrayBuffer()):await response.json(),
    cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
const teacher=credentials.accounts.find(a=>a.role==='teacher');
const login=await request('/auth/login',{body:{studentNumber:teacher.studentNumber,password:teacher.password}});
assert.equal(login.status,200);assert.equal(login.body.user.name,'서승범');assert.equal(login.body.user.mustChangePassword,false);
try {
  const start=performance.now();
  const overview=await request(`/teacher/overview?challengeId=${LEGACY_CHALLENGE_ID}`,{cookie:login.cookie});
  const overviewMilliseconds=Math.round(performance.now()-start);
  assert.equal(overview.status,200);assert.equal(overview.body.students.length,194);
  assert.equal(overview.body.stats.participants,194);assert.equal(overview.body.program.weeks.length,12);
  assert.equal(overview.body.students.reduce((sum,s)=>sum+s.records.length,0),result.records);
  assert(overview.body.students.every(s=>s.summary.weeks[11].status==='pending'));
  assert(!JSON.stringify(overview.body).includes('fitnessJson'));
  assert(!JSON.stringify(overview.body).includes('passwordHash'));
  const representatives=[];
  for(const studentNumber of ['30111','10101','30406']) {
    const student=overview.body.students.find(s=>s.studentNumber===studentNumber);
    const detail=await request(`/teacher/students/${student.id}?challengeId=${LEGACY_CHALLENGE_ID}`,{cookie:login.cookie});
    assert.equal(detail.status,200);assert.equal(detail.body.records.length,student.records.length);
    const account=credentials.accounts.find(a=>a.studentNumber===studentNumber);
    const signed=await request('/auth/login',{body:{studentNumber,password:account.password}});
    assert.equal(signed.status,200);assert.equal(signed.body.user.mustChangePassword,true);
    const protectedRoute=await request('/student/dashboard',{cookie:signed.cookie});
    assert.equal(protectedRoute.status,403);assert.equal(protectedRoute.body.error.code,'PASSWORD_CHANGE_REQUIRED');
    await request('/auth/logout',{cookie:signed.cookie,body:{}});
    representatives.push({studentNumber,name:student.name,targetType:student.targetType,records:student.records.length,completedWeeks:student.summary.completedWeeks});
  }
  const exported=await request(`/teacher/export?challengeId=${LEGACY_CHALLENGE_ID}`,{cookie:login.cookie,raw:true});
  assert.equal(exported.status,200);assert.equal(exported.body.subarray(0,2).toString(),'PK');
  await fs.writeFile(path.join(directory,'service-export.xlsx'),exported.body,{mode:0o600});
  const report={students:194,accounts:195,records:result.records,teacherLogin:true,studentLogins:3,
    firstPasswordChangeRequired:true,overviewMilliseconds,representatives,exportBytes:exported.body.length,
    programWeeks:12,dumbbellPending:true,verifiedAt:new Date().toISOString()};
  await fs.writeFile(path.join(directory,'api-verification.json'),JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify(report));
} finally {await request('/auth/logout',{cookie:login.cookie,body:{}});}
