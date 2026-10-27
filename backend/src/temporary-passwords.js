import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { fail } from './errors.js';
import { hashPassword } from './password.js';
function vaultKey() {
  const key=process.env.TEMPORARY_PASSWORD_KEY;
  if(!/^[a-fA-F0-9]{64}$/.test(key || '')) fail(503,'PASSWORD_VAULT_UNAVAILABLE','임시 비밀번호 보관 키 설정을 확인해 주세요.');
  return Buffer.from(key,'hex');
}
export function encryptTemporaryPassword(password,passwordHash) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',vaultKey(),iv);
  cipher.setAAD(Buffer.from(passwordHash));
  const encrypted=Buffer.concat([cipher.update(password,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
export function revealTemporaryPassword(user) {
  if(!user.mustChangePassword || !user.temporaryPasswordCiphertext) fail(409,'TEMPORARY_PASSWORD_UNAVAILABLE','확인할 수 있는 임시 비밀번호가 없어요. 필요한 경우 새로 초기화해 주세요.');
  const key=vaultKey();
  try {
    const [version,iv,tag,encrypted,...extra]=user.temporaryPasswordCiphertext.split('.');
    if(version!=='v1'||extra.length||!iv||!tag||!encrypted) throw new Error('Invalid envelope');
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));
    decipher.setAAD(Buffer.from(user.passwordHash));
    decipher.setAuthTag(Buffer.from(tag,'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted,'base64url')),decipher.final()]).toString('utf8');
  } catch { fail(503,'PASSWORD_VAULT_UNAVAILABLE','임시 비밀번호 보관 키와 데이터를 확인해 주세요.'); }
}
export async function temporaryCredential(password) {
  const passwordHash=await hashPassword(password);
  return {passwordHash,mustChangePassword:true,temporaryPasswordCiphertext:encryptTemporaryPassword(password,passwordHash),temporaryPasswordIssuedAt:new Date(),passwordChangedAt:null};
}
export function passwordStatus(user) {
  return {changed:!user.mustChangePassword,changedAt:user.passwordChangedAt,issuedAt:user.temporaryPasswordIssuedAt,temporaryPasswordAvailable:Boolean(user.mustChangePassword&&user.temporaryPasswordCiphertext)};
}
