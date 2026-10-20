import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough,Readable,Writable } from 'node:stream';
import { promptTeacherDetails,readTeacherInput } from '../scripts/teacher-input.js';

test('interactive teacher password never echoes to terminal output',async()=>{
  const input=new PassThrough();input.isTTY=true;input.setRawMode=()=>{};
  let rendered='';let index=0;
  const prompts=['교사 로그인 ID: ','교사 이름: ','비밀번호 (입력 내용 숨김): ','비밀번호 확인 (입력 내용 숨김): '];
  const answers=['test-only-id','TEST ONLY','S3cretNeverEcho','S3cretNeverEcho'];
  const output=new Writable({write(chunk,encoding,callback){rendered+=chunk.toString();if(index<prompts.length&&rendered.includes(prompts[index])) {const answer=answers[index++];setImmediate(()=>input.write(answer+'\r'));}callback();}});output.isTTY=true;
  const result=await promptTeacherDetails({input,output});
  assert.equal(result.password,'S3cretNeverEcho');assert.equal(result.studentNumber,'test-only-id');assert.equal(index,4);
  assert.ok(!rendered.includes('S3cretNeverEcho'));assert.ok(!rendered.includes('S3cret'));
  input.destroy();output.destroy();
});

test('stdin JSON remains supported and overrides explicitly supplied environment fields',async()=>{
  const result=await readTeacherInput({input:Readable.from(['{"studentNumber":"stdin-id","name":"TEST ONLY","password":"Hidden123"}']),env:{TEACHER_ID:'env-id'}});
  assert.deepEqual(result,{studentNumber:'stdin-id',name:'TEST ONLY',password:'Hidden123'});
  await assert.rejects(()=>readTeacherInput({input:Readable.from(['[]']),env:{}}),/JSON 객체/);
});

test('interactive cancellation rejects without returning account data',async()=>{
  const input=new PassThrough();input.isTTY=true;input.setRawMode=()=>{};
  const output=new Writable({write(chunk,encoding,callback){if(chunk.toString().includes('교사 로그인 ID')) setImmediate(()=>input.write('\u0003'));callback();}});output.isTTY=true;
  await assert.rejects(()=>promptTeacherDetails({input,output}),{name:'AbortError'});
  input.destroy();output.destroy();
});
