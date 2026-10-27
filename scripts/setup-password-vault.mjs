import fs from 'node:fs';
import {initializePasswordVault} from '../backend/src/password-vault-key.js';
import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('../backend/.env',import.meta.url));
const text=fs.readFileSync(file,'utf8');
const existing=text.match(/^TEMPORARY_PASSWORD_KEY=(.*)$/m);
if(existing){
  if(!/^[a-fA-F0-9]{64}$/.test(existing[1].trim()))throw new Error('기존 TEMPORARY_PASSWORD_KEY 설정을 확인해 주세요. 자동으로 덮어쓰지 않습니다.');
}else if(process.env.TEMPORARY_PASSWORD_KEY){
  if(!/^[a-fA-F0-9]{64}$/.test(process.env.TEMPORARY_PASSWORD_KEY))throw new Error('TEMPORARY_PASSWORD_KEY 형식이 올바르지 않습니다.');
}else{
  process.loadEnvFile(file);
  await initializePasswordVault();
  fs.appendFileSync(file,'\nTEMPORARY_PASSWORD_KEY='+process.env.TEMPORARY_PASSWORD_KEY+'\n');
  fs.chmodSync(file,0o600);
}
console.log('임시 비밀번호 보관 키 준비 완료 (비공개 환경 설정).');
