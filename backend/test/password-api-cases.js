import {recoverTemporaryPasswords} from '../scripts/recover-temporary-passwords.js';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
export async function runPasswordApiCases(t,{db,request,login,teacherCookie,aCookie,teacherId}) {
 await t.test('teacher password lifecycle: create, reveal, reset, student change and access controls',async()=>{
  const created=await request('/teacher/students',{method:'POST',cookie:teacherCookie,body:{studentNumber:'test-password-manager',name:'PASSWORD TEST',grade:1,classNumber:1,targetType:'optional'}});
  assert.equal(created.status,201);
  const id=created.data.user.id,base='/teacher/students/'+id;
  try{
   const credential=created.data.temporaryPassword;
   assert(!JSON.stringify(created.data.user).includes('Ciphertext'));
   const stored=await db.user.findUnique({where:{id}});
   assert(stored.temporaryPasswordCiphertext);assert(!stored.temporaryPasswordCiphertext.includes(credential));
   for(const suffix of ['/password-status','/temporary-password']){
    assert.equal((await request(base+suffix)).status,401);
    assert.equal((await request(base+suffix,{cookie:aCookie})).status,403);
    assert.equal((await request('/teacher/students/'+teacherId+suffix,{cookie:teacherCookie})).status,404);
   }
   const status=await request(base+'/password-status',{cookie:teacherCookie});
   assert.equal(status.data.changed,false);assert.equal(status.data.temporaryPasswordAvailable,true);assert(status.data.issuedAt);
   assert(!JSON.stringify(status.data).includes(credential));
   const revealed=await request(base+'/temporary-password',{cookie:teacherCookie});
   assert.equal(revealed.data.temporaryPassword,credential);assert.equal(revealed.headers.get('cache-control'),'no-store');
   const session=await login('test-password-manager',credential);assert.equal(session.status,200);
   const reset=await request(base+'/reset-password',{method:'POST',cookie:teacherCookie,body:{}});
   assert.equal(reset.status,200);assert.notEqual(reset.data.temporaryPassword,credential);
   assert.equal((await request('/auth/me',{cookie:session.cookie})).status,401);
   assert.equal((await login('test-password-manager',credential)).status,401);
   assert.equal((await request(base+'/temporary-password',{cookie:teacherCookie})).data.temporaryPassword,reset.data.temporaryPassword);
   const newSession=await login('test-password-manager',reset.data.temporaryPassword);
   assert.equal((await request('/auth/change-password',{cookie:newSession.cookie,method:'POST',body:{newPassword:'student-chosen-password123'}})).status,200);
   const changed=await request(base+'/password-status',{cookie:teacherCookie});
   assert.equal(changed.data.changed,true);assert.equal(changed.data.temporaryPasswordAvailable,false);assert(changed.data.changedAt);
   assert.equal((await request(base+'/temporary-password',{cookie:teacherCookie})).data.error.code,'TEMPORARY_PASSWORD_UNAVAILABLE');
   assert.equal((await db.user.findUnique({where:{id}})).temporaryPasswordCiphertext,null);
   const resetAgain=await request(base+'/reset-password',{cookie:teacherCookie,method:'POST',body:{}});assert.equal(resetAgain.status,200);
   const again=await request(base+'/password-status',{cookie:teacherCookie});assert.equal(again.data.changed,false);assert.equal(again.data.changedAt,null);
   const key=process.env.TEMPORARY_PASSWORD_KEY;
   try{
    process.env.TEMPORARY_PASSWORD_KEY=randomBytes(32).toString('hex');
    const unreadable=await request(base+'/temporary-password',{cookie:teacherCookie});assert.equal(unreadable.status,503);assert.equal(unreadable.data.error.code,'PASSWORD_VAULT_UNAVAILABLE');
    delete process.env.TEMPORARY_PASSWORD_KEY;
    const before=await db.user.findUnique({where:{id}});
    assert.equal((await request(base+'/reset-password',{cookie:teacherCookie,method:'POST',body:{}})).status,503);
    assert.deepEqual(await db.user.findUnique({where:{id}}),before);
   }finally{process.env.TEMPORARY_PASSWORD_KEY=key;}
   await db.user.update({where:{id},data:{temporaryPasswordCiphertext:null,temporaryPasswordIssuedAt:null}});
   const legacy=await request(base+'/password-status',{cookie:teacherCookie});assert.equal(legacy.data.changed,false);assert.equal(legacy.data.temporaryPasswordAvailable,false);
   assert.equal((await request(base+'/temporary-password',{cookie:teacherCookie})).status,409);
   const source=[{role:'student',studentNumber:'test-password-manager',name:'PASSWORD TEST',password:resetAgain.data.temporaryPassword}];
   const original=await db.user.findUnique({where:{id}});
   assert.equal((await recoverTemporaryPasswords(db,source)).eligible,1);
   assert.equal((await db.user.findUnique({where:{id}})).temporaryPasswordCiphertext,null);
   assert.equal((await recoverTemporaryPasswords(db,[{...source[0],password:'wrong-password123'}],{apply:true})).recovered,0);
   assert.equal((await recoverTemporaryPasswords(db,source,{apply:true})).recovered,1);
   const recovered=await db.user.findUnique({where:{id}});
   assert.equal(recovered.passwordHash,original.passwordHash);assert.deepEqual(recovered.updatedAt,original.updatedAt);
   assert.equal((await request(base+'/temporary-password',{cookie:teacherCookie})).data.temporaryPassword,resetAgain.data.temporaryPassword);
   assert.equal((await recoverTemporaryPasswords(db,source,{apply:true})).recovered,0);
  }finally{await db.user.delete({where:{id}});}
 });
}
