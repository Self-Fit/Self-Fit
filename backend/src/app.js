import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authMiddleware,authRouter,requireUser,requireChangedPassword,requireRole } from './auth.js';
import { studentRouter } from './student.js';
import { teacherRouter } from './teacher.js';
import { attachmentRouters } from './attachments.js';
import { programDto } from './dto.js';
import { errorHandler } from './errors.js';
export async function createApp(db,options={}) {
  const app=express();app.disable('x-powered-by');
  const trustProxy=(process.env.TRUST_PROXY || '').trim();
  if(trustProxy&&!['false','0'].includes(trustProxy.toLowerCase())) app.set('trust proxy',/^\d+$/.test(trustProxy)?Number(trustProxy):['true','1'].includes(trustProxy.toLowerCase())?true:trustProxy);
  const appOrigin=process.env.APP_ORIGIN || 'http://localhost:5173';
  const allowedOrigins=new Set(appOrigin.split(',').map(value=>value.trim()));
  const storageDir=path.resolve(options.storageDir || process.env.STORAGE_DIR || fileURLToPath(new URL('../../.data/attachments',import.meta.url)));
  app.use(helmet({crossOriginResourcePolicy:{policy:'same-origin'}}));
  app.use((req,res,next)=>{
    const origin=req.get('Origin');
    if(origin&&allowedOrigins.has(origin)) {res.set('Access-Control-Allow-Origin',origin);res.set('Access-Control-Allow-Credentials','true');res.vary('Origin');}
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&origin&&!allowedOrigins.has(origin)) return res.status(403).json({error:{code:'INVALID_ORIGIN',message:'허용되지 않은 요청 출처입니다.'}});
    if(req.method==='OPTIONS') {
      if(origin&&!allowedOrigins.has(origin)) return res.sendStatus(403);
      res.set('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');res.set('Access-Control-Allow-Headers','Content-Type');return res.sendStatus(204);
    }
    res.set('Cache-Control','no-store');next();
  });
  app.use(express.json({limit:'128kb'}));app.use(cookieParser());
  app.get('/api/health',async(req,res)=>{
    try {await db.$queryRaw`SELECT 1`;res.json({status:'ok',database:'ready'});}
    catch {res.status(503).json({status:'unavailable',database:'unavailable',error:{code:'DATABASE_UNAVAILABLE',message:'데이터베이스 연결을 확인해 주세요.'}});}
  });
  app.use('/api',authMiddleware(db));
  app.use('/api/auth',authRouter(db));
  app.use('/api',requireUser,requireChangedPassword);
  app.get('/api/program',(req,res)=>res.json(programDto()));
  app.use('/api/student',requireRole('student'),studentRouter(db));
  const attachment=await attachmentRouters(db,storageDir);
  app.use('/api/student',requireRole('student'),attachment.student);
  app.use('/api/attachments',attachment.files);
  app.use('/api/teacher',requireRole('teacher'),teacherRouter(db));
  app.use((req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'요청한 API를 찾을 수 없습니다.'}}));
  app.use(errorHandler);return app;
}
