import { randomBytes, createHash } from 'node:crypto';
import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { fail, requiredText } from './errors.js';
import { hashPassword, validatePassword, verifyPassword } from './password.js';
import { userDto } from './dto.js';
const COOKIE = 'self_fit_session';
const sessionId = token => createHash('sha256').update(token).digest('hex');
const cookieOptions = () => ({httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV === 'production',path:'/api',maxAge:8*60*60*1000});
export function authMiddleware(db) {
  return async (req,res,next) => {
    const token = req.cookies?.[COOKIE];
    if (!token || typeof token !== 'string' || token.length > 200) return next();
    const session = await db.session.findUnique({where:{id:sessionId(token)},include:{user:true}});
    if (session && session.expiresAt > new Date()) { req.user = session.user; req.sessionId = session.id; }
    next();
  };
}
export function requireUser(req,res,next) {
  if (!req.user) return next(Object.assign(new Error('로그인이 필요합니다.'),{status:401,code:'UNAUTHENTICATED'}));
  next();
}
export function requireChangedPassword(req,res,next) {
  if (req.user?.mustChangePassword) return next(Object.assign(new Error('임시 비밀번호를 먼저 변경해 주세요.'),{status:403,code:'PASSWORD_CHANGE_REQUIRED'}));
  next();
}
export const requireRole = role => (req,res,next) => req.user?.role === role ? next() : next(Object.assign(new Error('접근 권한이 없습니다.'),{status:403,code:'FORBIDDEN'}));
export function authRouter(db) {
  const router = Router();
  // Failed attempts are limited per account so one shared school/NAT address cannot lock
  // everyone out, plus a looser per-address ceiling against enumeration. Successful logins
  // never count. Set TRUST_PROXY when the API runs behind a reverse proxy.
  const limited={error:{code:'RATE_LIMITED',message:'로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.'}};
  const common={windowMs:15*60*1000,skipSuccessfulRequests:true,standardHeaders:'draft-8',legacyHeaders:false,message:limited};
  const accountLimiter=rateLimit({...common,limit:10,keyGenerator:req=>`account:${String(req.body?.studentNumber ?? '').trim().toLowerCase().slice(0,64)}`});
  const addressLimiter=rateLimit({...common,limit:300,keyGenerator:req=>`address:${ipKeyGenerator(req.ip)}`});
  router.post('/login', accountLimiter, addressLimiter, async (req,res) => {
    const studentNumber = requiredText(req.body?.studentNumber, '학번', 64);
    const user = await db.user.findUnique({where:{studentNumber}});
    // A real scrypt check also runs for unknown identifiers to reduce account enumeration.
    const valid = await verifyPassword(req.body?.password, user?.passwordHash || 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64));
    if (!user || !valid) fail(401,'INVALID_CREDENTIALS','학번 또는 비밀번호를 확인해 주세요.');
    const token = randomBytes(32).toString('base64url');
    const expiry = new Date(Date.now()+8*60*60*1000);
    const loggedInUser=await db.$transaction(async tx => {
      const stillValid=await tx.user.updateMany({where:{id:user.id,passwordHash:user.passwordHash},data:{lastLoginAt:new Date()}});
      if(!stillValid.count) fail(401,'INVALID_CREDENTIALS','비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.');
      if (req.sessionId) await tx.session.deleteMany({where:{id:req.sessionId}});
      await tx.session.create({data:{id:sessionId(token),userId:user.id,expiresAt:expiry}});
      return tx.user.findUnique({where:{id:user.id}});
    });
    res.cookie(COOKIE,token,cookieOptions()).json({user:userDto(loggedInUser)});
  });
  router.get('/me',requireUser,(req,res)=>res.json({user:userDto(req.user)}));
  router.post('/logout',async(req,res)=>{
    if(req.sessionId) await db.session.deleteMany({where:{id:req.sessionId}});
    res.clearCookie(COOKIE,{...cookieOptions(),maxAge:undefined}).json({ok:true});
  });
  router.post('/change-password',requireUser,async(req,res)=>{
    validatePassword(req.body?.newPassword,req.user.studentNumber);
    if ((!req.user.mustChangePassword || req.body?.currentPassword) && !await verifyPassword(req.body?.currentPassword,req.user.passwordHash)) fail(400,'WRONG_PASSWORD','현재 비밀번호를 확인해 주세요.');
    if (await verifyPassword(req.body.newPassword,req.user.passwordHash)) fail(400,'SAME_PASSWORD','현재 비밀번호와 다른 비밀번호를 사용해 주세요.');
    const passwordHash=await hashPassword(req.body.newPassword);
    const user=await db.$transaction(async tx=>{
      const updated=await tx.user.updateMany({where:{id:req.user.id,passwordHash:req.user.passwordHash},data:{passwordHash,mustChangePassword:false}});
      if(!updated.count) fail(409,'PASSWORD_CHANGED','비밀번호가 변경되었습니다. 다시 로그인해 주세요.');
      await tx.session.deleteMany({where:{userId:req.user.id,id:{not:req.sessionId}}});
      return tx.user.findUnique({where:{id:req.user.id}});
    });
    res.json({user:userDto(user)});
  });
  return router;
}
