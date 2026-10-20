import { PrismaClient,Prisma } from '@prisma/client';
import { hashPassword,validatePassword } from '../src/password.js';
import { ApiError,requiredText } from '../src/errors.js';
import { readTeacherInput } from './teacher-input.js';
const db=new PrismaClient();
try {
  if(await db.user.count({where:{role:'teacher'}})) throw new Error('교사 계정이 이미 있습니다. 기존 계정은 변경하지 않았습니다.');
  const input=await readTeacherInput();
  const studentNumber=requiredText(input.studentNumber,'교사 로그인 ID',64);
  const name=requiredText(input.name,'교사 이름',100);
  const password=input.password;
  validatePassword(password,studentNumber);
  const passwordHash=await hashPassword(password);
  await db.$transaction(async tx=>{
    if(await tx.user.count({where:{role:'teacher'}})) throw new Error('교사 계정이 이미 있습니다. 기존 계정은 변경하지 않았습니다.');
    await tx.user.create({data:{role:'teacher',studentNumber,name,passwordHash,mustChangePassword:false}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  console.log('교사 계정을 생성했습니다. 학생 명단과 활동 기록은 추가하지 않았습니다.');
} catch(error) {
  const message=error.name==='AbortError'?'교사 계정 생성을 취소했습니다.':error instanceof ApiError?error.message:error.code==='P2002'?'이미 사용 중인 계정 ID이거나 교사 계정이 존재합니다.':error.code||error.name?.startsWith('Prisma')?'데이터베이스 연결·마이그레이션을 확인해 주세요.':error instanceof SyntaxError?'stdin JSON 형식을 확인해 주세요.':error.message;
  console.error(message);process.exitCode=1;
} finally {await db.$disconnect();}
