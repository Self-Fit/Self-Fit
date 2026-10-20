import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { fail, requiredText, dateParam } from './errors.js';
import { canWriteDate, getWeekForDate, koreanDate, dailyStatus, summarizeProgram, validateValue } from './domain/index.js';
import { studentContext } from './challenge-context.js';
import { acceptOnlyInvitation, membershipSelf } from './memberships.js';
import { challengeDto } from './challenges.js';
import { userDto, recordDto, correctionDto, programDto, recordsWithAttachments } from './dto.js';
export function checkValue(challenge,date,value) {
  const week=getWeekForDate(challenge.weeks,date);
  if(!week) fail(400,'INACTIVE_DATE','활동 기간에 포함되지 않는 날짜입니다.');
  const result=validateValue(week,value);
  if(!result.valid) fail(400,result.code || 'INVALID_VALUE',result.error || '입력값을 확인해 주세요.');
  return week;
}
export function checkEditable(user,challenge,date) {
  if(!challenge || !user.participating) fail(403,'NOT_MEMBER','참여 중인 챌린지가 아니에요.');
  if(challenge.lifecycle!=='published'||!canWriteDate(challenge.weeks,date)) fail(403,'DATE_CLOSED','운동 기록은 한국 시간 기준 해당 활동일에만 입력·수정할 수 있습니다.');
}
export async function checkProspectiveTotals(tx,challenge,userId,date,value) {
  const records=await tx.dailyRecord.findMany({where:{userId,challengeId:challenge.id},select:{date:true,value:true}});
  try {summarizeProgram(challenge.weeks,[...records.filter(record=>record.date!==date),{date,value}]);}
  catch(error) {if(error instanceof RangeError) fail(400,'TOTAL_OUT_OF_RANGE','합계를 정확하게 표시할 수 있는 숫자 범위를 넘었습니다. 입력값을 확인해 주세요.');throw error;}
}
function versionOf(value) {
  if(!Number.isInteger(value)||value<1) fail(400,'VERSION_REQUIRED','최신 기록을 불러온 뒤 다시 시도해 주세요.');
  return value;
}
const correctionInclude={record:{include:{attachments:true}},decider:true};
export function studentRecordRouter(db,{legacy=false}={}) {
  const router=Router({mergeParams:true});
  router.use(async(req,res,next)=>{
    if(!/^\/(dashboard|records)(\/|$)/.test(req.path)) return next();
    const context=await studentContext(db,req.user,req.params.challengeId,{allowEmpty:legacy && req.method==='GET'});
    req.challenge=context.challenge;req.membership=context.membership;next();
  });
  router.get('/dashboard',async(req,res)=>{
    const challenge=req.challenge;
    const [records,unreadCount]=await Promise.all([challenge?db.dailyRecord.findMany({where:{userId:req.user.id,challengeId:challenge.id},...recordsWithAttachments}):[],db.notification.count({where:{userId:req.user.id,readAt:null}})]);
    const data={user:userDto({...req.user,participating:Boolean(req.membership?.status==='active')}),summary:summarizeProgram(challenge?.weeks || [],records),records:records.map(recordDto),unreadCount};
    if(legacy) data.program=programDto(challenge);
    else {data.challenge=challengeDto(challenge);data.membership=membershipSelf(req.membership);}
    res.json(data);
  });
  router.get('/records',async(req,res)=>{
    if(!req.challenge) return res.json({records:[],summary:summarizeProgram([],[])});
    const records=await db.dailyRecord.findMany({where:{userId:req.user.id,challengeId:req.challenge.id},...recordsWithAttachments});
    res.json({records:records.map(recordDto),summary:summarizeProgram(req.challenge.weeks,records)});
  });
  router.get('/records/:date',async(req,res)=>{
    const date=dateParam(req.params.date);
    if(!req.challenge) return res.json({record:null,corrections:[],revisions:[],week:null,dailyStatus:'inactive',editable:false});
    const record=await db.dailyRecord.findUnique({where:{challengeId_userId_date:{challengeId:req.challenge.id,userId:req.user.id,date}},include:{attachments:true,corrections:{include:correctionInclude,orderBy:{createdAt:'desc'}},revisions:{orderBy:{createdAt:'desc'}}}});
    const week=getWeekForDate(req.challenge.weeks,date);
    res.json({record:recordDto(record),corrections:(record?.corrections || []).map(correctionDto),revisions:record?.revisions || [],week,dailyStatus:dailyStatus(week,record?.value,date),editable:req.membership?.status==='active' && canWriteDate(req.challenge.weeks,date) && !week?.deferred});
  });
  router.put('/records/:date',async(req,res)=>{
    const date=dateParam(req.params.date); checkEditable({...req.user,participating:req.membership?.status==='active'},req.challenge,date); checkValue(req.challenge,date,req.body?.value);
    const record=await db.$transaction(async tx=>{
      const {challenge,membership}=await studentContext(tx,req.user,req.challenge.id,{lock:true});
      req.challenge=challenge;
      checkValue(challenge,date,req.body.value);
      const current=await tx.dailyRecord.findUnique({where:{challengeId_userId_date:{challengeId:req.challenge.id,userId:req.user.id,date}}});
      await checkProspectiveTotals(tx,challenge,req.user.id,date,req.body.value);
      checkEditable({...req.user,participating:membership.status==='active'},challenge,date);
      if(!current) return tx.dailyRecord.create({data:{challengeId:req.challenge.id,userId:req.user.id,date,value:req.body.value},include:{attachments:true}});
      const version=versionOf(req.body.version);
      const updated=await tx.dailyRecord.updateMany({where:{id:current.id,version},data:{value:req.body.value,version:{increment:1}}});
      if(!updated.count) fail(409,'STALE_RECORD','다른 곳에서 수정된 기록입니다. 새로고침 후 다시 입력해 주세요.');
      await tx.recordRevision.create({data:{recordId:current.id,value:current.value,version:current.version,actorId:req.user.id,source:'direct'}});
      return tx.dailyRecord.findUnique({where:{id:current.id},include:{attachments:true}});
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    const records=await db.dailyRecord.findMany({where:{userId:req.user.id,challengeId:req.challenge.id}});
    res.json({record:recordDto(record),summary:summarizeProgram(req.challenge.weeks,records)});
  });
  router.post('/records/:date/corrections',async(req,res)=>{
    const date=dateParam(req.params.date);
    if(date>=koreanDate()) fail(400,'CORRECTION_NOT_PAST','기한이 지난 기존 기록만 정정을 요청할 수 있습니다.');
    checkValue(req.challenge,date,req.body?.value);
    const reason=requiredText(req.body?.reason,'정정 사유',2000);
    const version=versionOf(req.body?.version);
    const correction=await db.$transaction(async tx=>{
      const {challenge}=await studentContext(tx,req.user,req.challenge.id,{lock:true});
      req.challenge=challenge;
      checkValue(challenge,date,req.body.value);
      const record=await tx.dailyRecord.findUnique({where:{challengeId_userId_date:{challengeId:req.challenge.id,userId:req.user.id,date}}});
      if(!record) fail(404,'NO_EXISTING_RECORD','미입력 날짜에는 정정 요청으로 새 기록을 만들 수 없습니다.');
      if(record.version!==version) fail(409,'STALE_RECORD','기록이 변경되었습니다. 새로고침 후 다시 요청해 주세요.');
      if(isDeepStrictEqual(record.value,req.body.value)) fail(400,'UNCHANGED_VALUE','변경할 값을 입력해 주세요.');
      if(await tx.correction.findFirst({where:{recordId:record.id,status:'pending'}})) fail(409,'PENDING_CORRECTION','이미 처리 중인 정정 요청이 있습니다.');
      return tx.correction.create({data:{recordId:record.id,requesterId:req.user.id,beforeValue:record.value,requestedValue:req.body.value,baseVersion:record.version,reason},include:correctionInclude});
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    res.status(201).json({correction:correctionDto(correction)});
  });
  return router;
}
export function studentRouter(db) {
  const router=Router();
  router.use(studentRecordRouter(db,{legacy:true}));
  router.post('/enroll',async(req,res)=>{
    await acceptOnlyInvitation(db,req.user.id);
    res.json({user:userDto({...req.user,participating:true})});
  });
  router.get('/corrections',async(req,res)=>res.json({corrections:(await db.correction.findMany({where:{requesterId:req.user.id},include:correctionInclude,orderBy:{createdAt:'desc'}})).map(correctionDto)}));
  router.get('/notifications',async(req,res)=>{
    const notifications=await db.notification.findMany({where:{userId:req.user.id},select:{id:true,type:true,title:true,body:true,data:true,readAt:true,createdAt:true},orderBy:{createdAt:'desc'}});
    const unreadCount=await db.notification.count({where:{userId:req.user.id,readAt:null}});
    res.json({notifications,unreadCount});
  });
  router.post('/notifications/read-all',async(req,res)=>{await db.notification.updateMany({where:{userId:req.user.id,readAt:null},data:{readAt:new Date()}});res.json({ok:true});});
  router.post('/notifications/:id/read',async(req,res)=>{
    const updated=await db.notification.updateMany({where:{id:req.params.id,userId:req.user.id,readAt:null},data:{readAt:new Date()}});
    if(!updated.count&&!await db.notification.findFirst({where:{id:req.params.id,userId:req.user.id}})) fail(404,'NOT_FOUND','알림을 찾을 수 없습니다.');
    res.json({ok:true});
  });
  const settings=user=>({weekendReminder:user.weekendReminder,pushEnabled:Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_SUBJECT),pushPublicKey:process.env.VAPID_PUBLIC_KEY || null});
  router.get('/settings',(req,res)=>res.json(settings(req.user)));
  router.patch('/settings',async(req,res)=>{
    if(typeof req.body?.weekendReminder!=='boolean') fail(400,'INVALID_INPUT','주말 보충 알림 설정을 확인해 주세요.');
    res.json(settings(await db.user.update({where:{id:req.user.id},data:{weekendReminder:req.body.weekendReminder}})));
  });
  router.post('/push-subscriptions',async(req,res)=>{
    const endpoint=requiredText(req.body?.endpoint,'푸시 주소',2048);
    let url; try {url=new URL(endpoint);} catch {fail(400,'INVALID_PUSH','푸시 구독 주소가 올바르지 않습니다.');}
    const host=url.hostname;
    const allowed=host==='fcm.googleapis.com'||host==='web.push.apple.com'||host.endsWith('.push.apple.com')||host==='updates.push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com')||host.endsWith('.notify.windows.com');
    if(url.protocol!=='https:'||url.username||url.password||url.port||!allowed) fail(400,'INVALID_PUSH','지원하는 브라우저의 HTTPS 푸시 구독을 사용해 주세요.');
    const p256dh=requiredText(req.body?.keys?.p256dh,'푸시 키',200); const auth=requiredText(req.body?.keys?.auth,'푸시 인증 키',100);
    if(!/^[A-Za-z0-9_-]+={0,2}$/.test(p256dh)||! /^[A-Za-z0-9_-]+={0,2}$/.test(auth)||Buffer.from(p256dh,'base64url').length!==65||Buffer.from(auth,'base64url').length!==16) fail(400,'INVALID_PUSH','푸시 구독 키가 올바르지 않습니다.');
    const existing=await db.pushSubscription.findUnique({where:{endpoint}});
    if(existing&&existing.userId!==req.user.id) fail(409,'PUSH_IN_USE','이 기기의 기존 알림 구독을 해제한 후 다시 등록해 주세요.');
    await db.pushSubscription.upsert({where:{endpoint},create:{userId:req.user.id,endpoint,p256dh,auth},update:{p256dh,auth}});
    res.status(201).json({ok:true});
  });
  router.delete('/push-subscriptions',async(req,res)=>{await db.pushSubscription.deleteMany({where:{userId:req.user.id,endpoint:requiredText(req.body?.endpoint,'푸시 주소',2048)}});res.json({ok:true});});
  return router;
}
