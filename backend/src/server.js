import { initializePasswordVault } from './password-vault-key.js';
import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';
import { configurePush,startScheduler } from './notifications.js';
if(!process.env.DATABASE_URL) {console.error('DATABASE_URL이 없습니다. backend/.env에서 전용 PostgreSQL 연결을 설정해 주세요.');process.exit(1);}
const db=new PrismaClient();
let server;let stopScheduler;
try {
  await db.$connect();
  await initializePasswordVault();
  configurePush();
  const app=await createApp(db);
  server=app.listen(Number(process.env.PORT || 4000),process.env.HOST || '127.0.0.1',()=>console.log(`Self Fit API ready on port ${process.env.PORT || 4000}`));
  server.requestTimeout=5*60*1000;
  stopScheduler=startScheduler(db);
} catch(error) {
  console.error(JSON.stringify({event:'startup_failed',code:error.code || error.name,message:'PostgreSQL 연결·마이그레이션·서버 환경 설정을 확인해 주세요.'}));
  await db.$disconnect();process.exitCode=1;
}
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
  stopScheduler?.();server?.close(async()=>{await db.$disconnect();process.exit(0);});
});
