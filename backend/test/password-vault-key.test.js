import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initializePasswordVault} from '../src/password-vault-key.js';
test('persistent vault key survives release restarts and rejects corrupted storage',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'self-fit-key-'));
 const before=process.env.TEMPORARY_PASSWORD_KEY,oldFile=process.env.TEMPORARY_PASSWORD_KEY_FILE;
 try{
  delete process.env.TEMPORARY_PASSWORD_KEY;delete process.env.TEMPORARY_PASSWORD_KEY_FILE;
  await initializePasswordVault({storageDir:dir});const first=process.env.TEMPORARY_PASSWORD_KEY;
  assert.match(first,/^[a-f0-9]{64}$/);
  const file=path.join(dir,'.secrets/temporary-password.key');assert.equal((await fs.stat(file)).mode&0o777,0o600);
  delete process.env.TEMPORARY_PASSWORD_KEY;await initializePasswordVault({storageDir:dir});assert.equal(process.env.TEMPORARY_PASSWORD_KEY,first);
  delete process.env.TEMPORARY_PASSWORD_KEY;await fs.writeFile(file,'bad-key');
  await assert.rejects(initializePasswordVault({storageDir:dir}));assert.equal(await fs.readFile(file,'utf8'),'bad-key');
 }finally{
  if(before===undefined)delete process.env.TEMPORARY_PASSWORD_KEY;else process.env.TEMPORARY_PASSWORD_KEY=before;
  if(oldFile===undefined)delete process.env.TEMPORARY_PASSWORD_KEY_FILE;else process.env.TEMPORARY_PASSWORD_KEY_FILE=oldFile;
  await fs.rm(dir,{recursive:true,force:true});
 }
});
