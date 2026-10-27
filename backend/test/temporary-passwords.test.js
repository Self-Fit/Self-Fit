import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {temporaryCredential,revealTemporaryPassword} from '../src/temporary-passwords.js';
import {verifyPassword,validatePassword,temporaryPassword} from '../src/password.js';
test('temporary vault binds ciphertext to a hash and never reveals changed passwords',async()=>{
 const old=process.env.TEMPORARY_PASSWORD_KEY;
 try{
  process.env.TEMPORARY_PASSWORD_KEY=randomBytes(32).toString('hex');
  const password='test-only-Password123',user=await temporaryCredential(password);
  assert(await verifyPassword(password,user.passwordHash));
  assert(!user.temporaryPasswordCiphertext.includes(password));
  assert.equal(revealTemporaryPassword(user),password);
  assert.throws(()=>revealTemporaryPassword({...user,passwordHash:'different'}),{code:'PASSWORD_VAULT_UNAVAILABLE'});
  assert.throws(()=>revealTemporaryPassword({...user,mustChangePassword:false}),{code:'TEMPORARY_PASSWORD_UNAVAILABLE'});
  process.env.TEMPORARY_PASSWORD_KEY=randomBytes(32).toString('hex');
  assert.throws(()=>revealTemporaryPassword(user),{code:'PASSWORD_VAULT_UNAVAILABLE'});
  delete process.env.TEMPORARY_PASSWORD_KEY;
  await assert.rejects(temporaryCredential(password),{code:'PASSWORD_VAULT_UNAVAILABLE'});
 }finally{if(old===undefined)delete process.env.TEMPORARY_PASSWORD_KEY;else process.env.TEMPORARY_PASSWORD_KEY=old;}
});
test('issued passwords always meet the student password policy',()=>{
 for(let i=0;i<100;i++)assert.doesNotThrow(()=>validatePassword(temporaryPassword()));
});
