import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { fail, isForeignKeyViolation, requiredText } from './errors.js';
import { userDto, studentSummary, recordDto, correctionDto, programDto, recordsWithAttachments } from './dto.js';
import { temporaryPassword } from './password.js';
import { temporaryCredential, passwordStatus, revealTemporaryPassword } from './temporary-passwords.js';
import { studentFields, rosterRouter } from './roster.js';
import { summarizeProgram, summarizeWeek,getWeekForDate } from './domain/index.js';
import { checkValue,checkProspectiveTotals } from './student.js';
import { exportStudents,exportCorrections } from './export.js';
import { challengeRouter, challengeDto, loadChallenge, resolveCurrentChallenge } from './challenges.js';
import { teacherChallenge } from './challenge-context.js';
import { parseFilters } from './filters.js';
import { buildParticipation } from './participation.js';
const correctionInclude={record:{include:{attachments:true}},requester:true,decider:true};
const duplicateNumber=(error,studentNumber)=>{if(error.code==='P2002') fail(409,'DUPLICATE_NUMBER',`이미 등록된 학번입니다: ${studentNumber}`);throw error;};
export { parseFilters } from './filters.js';
export async function filteredStudents(db,query,challenge=null,{records=true}={}) {
  const filters=parseFilters(query),where={role:'student'};
  for(const key of ['grade','classNumber','targetType']) if(filters[key]!==undefined) where[key]=filters[key];
  if(filters.fitnessGrade!==undefined) where.fitnessGrade=filters.fitnessGrade==='unmeasured'?null:filters.fitnessGrade;
  if(filters.search) where.OR=[{name:{contains:filters.search,mode:'insensitive'}},{studentNumber:{contains:filters.search,mode:'insensitive'}}];
  if(filters.studentIds) where.id={in:filters.studentIds};
  if(challenge && filters.week && !challenge.weeks.some(week=>week.week===filters.week)) fail(400,'INVALID_FILTER','해당 챌린지의 주차를 선택해 주세요.');
  let students=await db.user.findMany({where,include:challenge?{
    memberships:{where:{challengeId:challenge.id}},
    ...(records?{records:{where:{challengeId:challenge.id},...recordsWithAttachments,include:{attachments:true,corrections:{orderBy:{createdAt:'desc'}}}}}:{}),
  }:undefined,orderBy:[{grade:'asc'},{classNumber:'asc'},{studentNumber:'asc'}]});
  // Participation is an active membership in the given challenge; without a challenge nobody participates.
  students=students.map(user=>({...user,participating:!!challenge&&user.memberships.some(member=>member.status==='active')}));
  if(filters.participating!==undefined) students=students.filter(user=>user.participating===filters.participating);
  if(filters.achievement && challenge && records) students=students.filter(student=>student.participating&&(filters.week?summarizeWeek(challenge.weeks.find(week=>week.week===filters.week),student.records):summarizeProgram(challenge.weeks,student.records)).status===filters.achievement);
  return {students,filters};
}
export function teacherRouter(db) {
  const router=Router();
  router.use('/roster',rosterRouter(db));
  router.use('/challenges',challengeRouter(db));
  router.get('/overview',async(req,res)=>{
    const challenge=await teacherChallenge(db,req);
    const {students,filters}=await filteredStudents(db,req.query,challenge);const rows=students.map(user=>studentSummary(user,challenge));
    const participants=rows.filter(user=>user.participating);
    res.json({students:rows,challenge:challengeDto(challenge,undefined,{detail:false}),program:programDto(challenge),stats:{students:rows.length,participants:participants.length,completed:participants.filter(user=>user.summary.complete===true).length,denominator:participants.length},filters});
  });
  router.get('/participation',async(req,res)=>{
    const challenge=await teacherChallenge(db,req);
    const filters=parseFilters(Object.fromEntries(['grade','classNumber','targetType']
      .filter(key=>req.query[key]!==undefined).map(key=>[key,req.query[key]])));
    const [students,registeredClasses]=await Promise.all([
      db.user.findMany({
        where:{role:'student',memberships:{some:{challengeId:challenge.id,status:'active'}},...filters},
        select:{grade:true,classNumber:true,targetType:true,records:{where:{challengeId:challenge.id},select:{date:true,value:true}}},
      }),
      db.user.findMany({
        where:{role:'student'},select:{grade:true,classNumber:true},
        distinct:['grade','classNumber'],orderBy:[{grade:'asc'},{classNumber:'asc'}],
      }),
    ]);
    const validNumber=value=>Number.isSafeInteger(value)&&value>0;
    const filterOptions={
      grades:[...new Set(registeredClasses.map(row=>row.grade).filter(validNumber))].sort((a,b)=>a-b),
      classes:registeredClasses.filter(row=>validNumber(row.grade)&&validNumber(row.classNumber))
        .map(({grade,classNumber})=>({grade,classNumber})),
    };
    res.json({...buildParticipation(challenge.weeks,students.map(user=>({...user,participating:true}))),challenge:challengeDto(challenge,undefined,{detail:false}),filters,filterOptions});
  });
  // The roster is account-level; its participating flag (and filter) follow the given challenge, else the current one.
  router.get('/students',async(req,res)=>{const challenge=req.query.challengeId?await teacherChallenge(db,req):await resolveCurrentChallenge(db,req.user);res.json({students:(await filteredStudents(db,req.query,challenge,{records:false})).students.map(userDto)});});
  router.post('/students',async(req,res)=>{
    const fields=studentFields(req.body || {});const password=temporaryPassword();
    const user=await db.user.create({data:{...fields,role:'student',...await temporaryCredential(password)}}).catch(error=>duplicateNumber(error,fields.studentNumber));
    res.status(201).json({user:userDto(user),temporaryPassword:password});
  });
  const getStudent=async(id,options={})=>{
    const user=await db.user.findFirst({where:{id,role:'student'},...options});if(!user) fail(404,'NOT_FOUND','학생을 찾을 수 없습니다.');return user;
  };
  router.get('/students/:id',async(req,res)=>{
    const challenge=await teacherChallenge(db,req);
    const user=await getStudent(req.params.id,{include:{memberships:{where:{challengeId:challenge.id}},records:{where:{challengeId:challenge.id},...recordsWithAttachments,include:{attachments:true,revisions:{orderBy:{createdAt:'desc'}},corrections:{where:{status:'approved'}}}},requestedCorrections:{where:{record:{challengeId:challenge.id}},include:correctionInclude,orderBy:{createdAt:'desc'}},fitnessAssessments:{select:{year:true,semester:true,grade:true,score:true},orderBy:[{year:'desc'},{semester:'desc'}]}}});
    res.json({challenge:challengeDto(challenge,undefined,{detail:false}),user:userDto({...user,participating:user.memberships.some(member=>member.status==='active')}),records:user.records.map(record=>({...recordDto(record),revisions:record.revisions})),summary:summarizeProgram(challenge.weeks,user.records),corrections:user.requestedCorrections.map(correctionDto),fitnessHistory:user.fitnessAssessments});
  });
  router.patch('/students/:id',async(req,res)=>{
    await getStudent(req.params.id);const fields=studentFields(req.body || {},true);
    if(!Object.keys(fields).length) fail(400,'INVALID_INPUT','변경할 학생 정보를 입력해 주세요.');
    res.json({user:userDto(await db.user.update({where:{id:req.params.id},data:fields}).catch(error=>duplicateNumber(error,fields.studentNumber)))});
  });
  router.delete('/students/:id',async(req,res)=>{
    const student=await getStudent(req.params.id,{select:{id:true,_count:{select:{records:true,sourceRows:true,fitnessAssessments:true}}}});
    if(student._count.records) fail(409,'HAS_RECORDS','운동 기록이 있는 학생은 삭제할 수 없습니다. 기록 보존을 위해 명단 정보를 수정해 주세요.');
    if(student._count.sourceRows||student._count.fitnessAssessments) fail(409,'HAS_SOURCE_DATA','가져온 원본 자료가 있는 학생은 삭제할 수 없습니다. 자료 보존을 위해 명단 정보를 수정해 주세요.');
    try {await db.user.delete({where:{id:req.params.id}});}
    catch(error) {
      // Evidence may be inserted after the pre-check; the foreign key remains authoritative.
      if(isForeignKeyViolation(error)) fail(409,'HAS_EVIDENCE','보존해야 할 자료가 있는 학생은 삭제할 수 없습니다. 명단 정보를 수정해 주세요.');
      throw error;
    }
    res.json({ok:true});
  });
  router.get('/students/:id/password-status',async(req,res)=>res.json(passwordStatus(await getStudent(req.params.id))));
  router.get('/students/:id/temporary-password',async(req,res)=>{
    const password=await db.$transaction(async tx=>{
      // Serialize reveal with password change/reset without changing the account.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.params.id} FOR UPDATE`;
      const user=await tx.user.findFirst({where:{id:req.params.id,role:'student'}});
      if(!user) fail(404,'NOT_FOUND','학생을 찾을 수 없어요.');
      return revealTemporaryPassword(user);
    });
    res.json({temporaryPassword:password});
  });
  router.post('/students/:id/reset-password',async(req,res)=>{
    await getStudent(req.params.id);const password=temporaryPassword();const credential=await temporaryCredential(password);
    await db.$transaction(async tx=>{
      await tx.user.update({where:{id:req.params.id},data:credential});
      await tx.session.deleteMany({where:{userId:req.params.id}});
    });
    res.json({temporaryPassword:password});
  });
  router.get('/corrections',async(req,res)=>{
    const challenge=await teacherChallenge(db,req);
    const status=req.query.status || 'pending';if(!['pending','approved','rejected','all'].includes(status)) fail(400,'INVALID_FILTER','정정 상태를 확인해 주세요.');
    const rows=await db.correction.findMany({where:{record:{challengeId:challenge.id},...(status==='all'?{}:{status})},include:correctionInclude,orderBy:{createdAt:'desc'}});
    const records=await db.dailyRecord.findMany({where:{challengeId:challenge.id,userId:{in:[...new Set(rows.filter(row=>row.status==='pending').map(row=>row.requesterId))]}},select:{id:true,userId:true,date:true,value:true,version:true}});
    for(const row of rows) {
      const current=records.find(record=>record.id===row.recordId);
      if(row.status!=='pending'||current?.version!==row.baseVersion) continue;
      const studentRecords=records.filter(record=>record.userId===row.requesterId);
      const week=getWeekForDate(challenge.weeks,row.record.date);
      try {row.preview={before:summarizeWeek(week,studentRecords),after:summarizeWeek(week,studentRecords.map(record=>record.id===row.recordId?{...record,value:row.requestedValue}:record))};}
      catch {row.preview=null;}
    }
    res.json({challenge:challengeDto(challenge,undefined,{detail:false}),corrections:rows.map(correctionDto)});
  });
  router.get('/corrections/export',async(req,res)=>{
    const challenge=await teacherChallenge(db,req);
    const status=req.query.status || 'all';if(!['pending','approved','rejected','all'].includes(status)) fail(400,'INVALID_FILTER','정정 상태를 확인해 주세요.');
    const rows=await db.correction.findMany({where:{record:{challengeId:challenge.id},...(status==='all'?{}:{status})},include:correctionInclude,orderBy:{createdAt:'desc'}});
    await exportCorrections(res,rows,status,challenge);
  });
  router.post('/corrections/:id/approve',async(req,res)=>{
    const result=await db.$transaction(async tx=>{
      const correction=await tx.correction.findUnique({where:{id:req.params.id},include:{record:true}});
      if(!correction) fail(404,'NOT_FOUND','정정 요청을 찾을 수 없습니다.');
      if(correction.status!=='pending') fail(409,'ALREADY_DECIDED','이미 처리된 정정 요청입니다.');
      // Share-lock the challenge until commit, as record writes do, so archiving cannot land between this check and the update.
      await tx.$queryRaw`SELECT id FROM "Challenge" WHERE id = ${correction.record.challengeId} FOR SHARE`;
      const challenge=await loadChallenge(tx,correction.record.challengeId);
      if(challenge.lifecycle==='archived') fail(409,'CHALLENGE_ARCHIVED','보관된 챌린지의 기록은 바꿀 수 없어요. 정정 요청은 반려만 할 수 있어요.');
      checkValue(challenge,correction.record.date,correction.requestedValue);
      await checkProspectiveTotals(tx,challenge,correction.requesterId,correction.record.date,correction.requestedValue);
      const updated=await tx.dailyRecord.updateMany({where:{id:correction.recordId,version:correction.baseVersion},data:{value:correction.requestedValue,version:{increment:1}}});
      if(!updated.count) fail(409,'STALE_CORRECTION','요청 이후 원기록이 변경되었습니다. 현재 기록을 확인하고 반려 후 다시 요청해 주세요.');
      await tx.recordRevision.create({data:{recordId:correction.recordId,value:correction.record.value,version:correction.record.version,actorId:req.user.id,source:'correction'}});
      const decided=await tx.correction.updateMany({where:{id:correction.id,status:'pending'},data:{status:'approved',deciderId:req.user.id,decidedAt:new Date()}});
      if(!decided.count) fail(409,'ALREADY_DECIDED','다른 처리자가 이미 처리한 요청입니다.');
      await tx.notification.create({data:{userId:correction.requesterId,eventKey:`correction:${correction.id}`,type:'correction',title:'정정 요청이 승인됐어요',body:`${correction.record.date} 기록이 요청한 값으로 변경됐어요.`}});
      return {correction:await tx.correction.findUnique({where:{id:correction.id},include:correctionInclude}),record:await tx.dailyRecord.findUnique({where:{id:correction.recordId},include:{attachments:true}})};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    res.json({correction:correctionDto(result.correction),record:recordDto(result.record)});
  });
  router.post('/corrections/:id/reject',async(req,res)=>{
    const reason=requiredText(req.body?.reason,'반려 사유',2000);
    const correction=await db.$transaction(async tx=>{
      const current=await tx.correction.findUnique({where:{id:req.params.id},include:{record:true}});
      if(!current) fail(404,'NOT_FOUND','정정 요청을 찾을 수 없습니다.');
      const updated=await tx.correction.updateMany({where:{id:current.id,status:'pending'},data:{status:'rejected',decisionReason:reason,deciderId:req.user.id,decidedAt:new Date()}});
      if(!updated.count) fail(409,'ALREADY_DECIDED','이미 처리된 정정 요청입니다.');
      await tx.notification.create({data:{userId:current.requesterId,eventKey:`correction:${current.id}`,type:'correction',title:'정정 요청이 반려됐어요',body:`${current.record.date} 기록의 반려 사유: ${reason}`}});
      return tx.correction.findUnique({where:{id:current.id},include:correctionInclude});
    });
    res.json({correction:correctionDto(correction)});
  });
  router.get('/export',async(req,res)=>{const challenge=await teacherChallenge(db,req);const {students,filters}=await filteredStudents(db,req.query,challenge);await exportStudents(res,students,filters,challenge);});
  return router;
}
