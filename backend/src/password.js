import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fail } from './errors.js';
const scrypt = promisify(scryptCallback);
export function validatePassword(password,studentNumber) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) fail(400, 'INVALID_PASSWORD', '비밀번호는 영문과 숫자를 포함해 8자 이상 128자 이하로 입력해 주세요.');
  if(studentNumber&&password===studentNumber) fail(400,'INVALID_PASSWORD','학번과 다른 비밀번호를 사용해 주세요.');
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [algorithm,salt,digest] = String(encoded).split(':');
  if (algorithm !== 'scrypt' || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = await scrypt(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const temporaryPassword = () => randomBytes(12).toString('base64url');
