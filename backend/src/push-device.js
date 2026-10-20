import { randomBytes, createHash } from 'node:crypto';
import { fail } from './errors.js';

const COOKIE='self_fit_push_device';
const hash=token=>createHash('sha256').update(token).digest('hex');

export function pushDeviceHash(req) {
  const token=req.cookies?.[COOKIE];
  return typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)?hash(token):null;
}

export function ensurePushDeviceHash(req,res) {
  const existing=pushDeviceHash(req);
  if(existing) return existing;
  const token=randomBytes(32).toString('base64url');
  res.cookie(COOKIE,token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/api',maxAge:365*24*60*60*1000});
  return hash(token);
}

export async function lockPushSession(tx,id) {
  if(!id) return null;
  const rows=await tx.$queryRaw`SELECT "id", "userId", "expiresAt", "pushDeviceKeyHash" FROM "Session" WHERE "id"=${id} FOR UPDATE`;
  return rows[0] || null;
}

export async function requirePushSession(tx,req) {
  const session=await lockPushSession(tx,req.sessionId);
  if(!session||session.userId!==req.user?.id||session.expiresAt<=new Date()) fail(401,'UNAUTHENTICATED','로그인이 필요합니다.');
  return session;
}
