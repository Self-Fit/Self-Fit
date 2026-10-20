import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { fail, requiredText } from './errors.js';
import { userDto, studentSummary, recordDto, correctionDto, programDto, recordsWithAttachments } from './dto.js';
import { hashPassword, temporaryPassword } from './password.js';
import { studentFields, rosterRouter } from './roster.js';
import { summarizeProgram, summarizeWeek,getWeekForDate } from './domain/index.js';
import { checkValue,checkProspectiveTotals } from './student.js';
import { exportStudents,exportCorrections } from './export.js';
import { buildParticipation } from './participation.js';
const correctionInclude={record:{include:{attachments:true}},requester:true,decider:true};
const duplicateNumber=(error,studentNumber)=>{if(error.code==='P2002') fail(409,'DUPLICATE_NUMBER',`이미 등록된 학번입니다: ${studentNumber}`);throw error;};
export function parseFilters(query) {
  const filters={};
  if(typeof query.search==='string'&&query.search.trim()) filters.search=requiredText(query.search,'검색어',200);
  for(const key of ['grade','classNumber','week']) if(query[key]!==undefined&&query[key]!=='') {
    const number=Number(query[key]);
    if(!Number.isSafeInteger(number)||number<1||number>2147483647||(key==='week'&&number>12)) fail(400,'INVALID_FILTER','검색 조건을 확인해 주세요.');
    filters[key]=number;
  }
  if(query.targetType) {if(!['required','optional'].includes(query.targetType)) fail(400,'INVALID_FILTER','대상 구분을 확인해 주세요.');filters.targetType=query.targetType;}
  if(query.participating!==undefined&&query.participating!=='') {if(!['true','false'].includes(query.participating)) fail(400,'INVALID_FILTER','참여 필터를 확인해 주세요.');filters.participating=query.participating==='true';}
  if(query.achievement) {if(!['complete','incomplete','pending'].includes(query.achievement)) fail(400,'INVALID_FILTER','달성 상태를 확인해 주세요.');filters.achievement=query.achievement;}
  if(query.studentIds) filters.studentIds=requiredText(query.studentIds,'선택 학생',100000).split(',').filter(Boolean);
  return filters;
}
export async function filteredStudents(db,query) {
  const filters=parseFilters(query);
  const where={role:'student'};
  for(const key of ['grade','classNumber','targetType','participating']) if(filters[key]!==undefined) where[key]=filters[key];
  if(filters.search) where.OR=[{name:{contains:filters.search,mode:'insensitive'}},{studentNumber:{contains:filters.search,mode:'insensitive'}}];
  if(filters.studentIds) where.id={in:filters.studentIds};
  let students=await db.user.findMany({where,include:{records:{...recordsWithAttachments,include:{attachments:true,corrections:{orderBy:{createdAt:'desc'}}}}},orderBy:[{grade:'asc'},{classNumber:'asc'},{studentNumber:'asc'}]});
  if(filters.achievement) students=students.filter(student=>student.participating&&(filters.week?summarizeWeek(filters.week,student.records):summarizeProgram(student.records)).status===filters.achievement);
  return {students,filters};
}
export function teacherRouter(db) {
  const router=Router();
  router.use('/roster',rosterRouter(db));
  router.get('/overview',async(req,res)=>{
    const {students,filters}=await filteredStudents(db,req.query);const rows=students.map(studentSummary);
    const participants=rows.filter(user=>user.participating);
    res.json({students:rows,program:programDto(),stats:{students:rows.length,participants:participants.length,completed:participants.filter(user=>user.summary.complete===true).length,denominator:participants.length},filters});
  });
  router.get('/participation',async(req,res)=>{
    const filters=parseFilters(Object.fromEntries(['grade','classNumber','targetType']
      .filter(key=>req.query[key]!==undefined).map(key=>[key,req.query[key]])));
    const [students,registeredClasses]=await Promise.all([
      db.user.findMany({
        where:{role:'student',participating:true,...filters},
        select:{grade:true,classNumber:true,targetType:true,participating:true,records:{select:{date:true,value:true}}},
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
    res.json({...buildParticipation(students),filters,filterOptions});
  });
  router.get('/students',async(req,res)=>res.json({students:(await filteredStudents(db,req.query)).students.map(userDto)}));
  router.post('/students',async(req,res)=>{
    const fields=studentFields(req.body || {});const password=temporaryPassword();
    const user=await db.user.create({data:{...fields,role:'student',participating:fields.targetType==='required',passwordHash:await hashPassword(password),mustChangePassword:true}}).catch(error=>duplicateNumber(error,fields.studentNumber));
    res.status(201).json({user:userDto(user),temporaryPassword:password});
  });
  const getStudent=async(id,options={})=>{
    const user=await db.user.findFirst({where:{id,role:'student'},...options});if(!user) fail(404,'NOT_FOUND','학생을 찾을 수 없습니다.');return user;
  };
  router.get('/students/:id',async(req,res)=>{
    const user=await getStudent(req.params.id,{include:{records:{...recordsWithAttachments,include:{attachments:true,revisions:{orderBy:{createdAt:'desc'}},corrections:{where:{status:'approved'}}}},requestedCorrections:{include:correctionInclude,orderBy:{createdAt:'desc'}}}});
    res.json({user:userDto(user),records:user.records.map(record=>({...recordDto(record),revisions:record.revisions})),summary:summarizeProgram(user.records),corrections:user.requestedCorrections.map(correctionDto)});
  });
  router.patch('/students/:id',async(req,res)=>{
    await getStudent(req.params.id);const fields=studentFields(req.body || {},true);
    if(!Object.keys(fields).length) fail(400,'INVALID_INPUT','변경할 학생 정보를 입력해 주세요.');
    if(fields.targetType==='required') fields.participating=true;
    res.json({user:userDto(await db.user.update({where:{id:req.params.id},data:fields}).catch(error=>duplicateNumber(error,fields.studentNumber)))});
  });
  router.delete('/students/:id',async(req,res)=>{
    const student=await getStudent(req.params.id,{select:{id:true,_count:{select:{records:true,sourceRows:true}}}});
    if(student._count.records) fail(409,'HAS_RECORDS','운동 기록이 있는 학생은 삭제할 수 없습니다. 기록 보존을 위해 명단 정보를 수정해 주세요.');
    if(student._count.sourceRows) fail(409,'HAS_SOURCE_DATA','가져온 원본 자료가 있는 학생은 삭제할 수 없습니다. 자료 보존을 위해 명단 정보를 수정해 주세요.');
    try {await db.user.delete({where:{id:req.params.id}});}
    catch(error) {
      // Evidence may be inserted after the pre-check; the foreign key remains authoritative.
      if(error.code==='P2003') fail(409,'HAS_EVIDENCE','보존해야 할 자료가 있는 학생은 삭제할 수 없습니다. 명단 정보를 수정해 주세요.');
      throw error;
    }
    res.json({ok:true});
  });
  router.post('/students/:id/reset-password',async(req,res)=>{
    await getStudent(req.params.id);const password=temporaryPassword();const passwordHash=await hashPassword(password);
    await db.$transaction(async tx=>{
      await tx.user.update({where:{id:req.params.id},data:{passwordHash,mustChangePassword:true}});
      await tx.session.deleteMany({where:{userId:req.params.id}});
    });
    res.json({temporaryPassword:password});
  });
  router.get('/corrections',async(req,res)=>{
    const status=req.query.status || 'pending';if(!['pending','approved','rejected','all'].includes(status)) fail(400,'INVALID_FILTER','정정 상태를 확인해 주세요.');
    const rows=await db.correction.findMany({where:status==='all'?{}:{status},include:correctionInclude,orderBy:{createdAt:'desc'}});
    const records=await db.dailyRecord.findMany({where:{userId:{in:[...new Set(rows.filter(row=>row.status==='pending').map(row=>row.requesterId))]}},select:{id:true,userId:true,date:true,value:true,version:true}});
    for(const row of rows) {
      const current=records.find(record=>record.id===row.recordId);
      if(row.status!=='pending'||current?.version!==row.baseVersion) continue;
      const studentRecords=records.filter(record=>record.userId===row.requesterId);
      const week=getWeekForDate(row.record.date);
      try {row.preview={before:summarizeWeek(week,studentRecords),after:summarizeWeek(week,studentRecords.map(record=>record.id===row.recordId?{...record,value:row.requestedValue}:record))};}
      catch {row.preview=null;}
    }
    res.json({corrections:rows.map(correctionDto)});
  });
  router.get('/corrections/export',async(req,res)=>{
    const status=req.query.status || 'all';if(!['pending','approved','rejected','all'].includes(status)) fail(400,'INVALID_FILTER','정정 상태를 확인해 주세요.');
    const rows=await db.correction.findMany({where:status==='all'?{}:{status},include:correctionInclude,orderBy:{createdAt:'desc'}});
    await exportCorrections(res,rows,status);
  });
  router.post('/corrections/:id/approve',async(req,res)=>{
    const result=await db.$transaction(async tx=>{
      const correction=await tx.correction.findUnique({where:{id:req.params.id},include:{record:true}});
      if(!correction) fail(404,'NOT_FOUND','정정 요청을 찾을 수 없습니다.');
      if(correction.status!=='pending') fail(409,'ALREADY_DECIDED','이미 처리된 정정 요청입니다.');
      checkValue(correction.record.date,correction.requestedValue);
      await checkProspectiveTotals(tx,correction.requesterId,correction.record.date,correction.requestedValue);
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
  router.get('/export',async(req,res)=>{const {students,filters}=await filteredStudents(db,req.query);await exportStudents(res,students,filters);});
  return router;
}
