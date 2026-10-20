import { activityDates, challengePhase, koreanDate, summarizeProgram } from './domain/index.js';
export function userDto(user) {
  return Object.fromEntries(['id','role','studentNumber','name','grade','classNumber','targetType','participating','mustChangePassword','lastLoginAt','createdAt'].map(key=>[key,user[key] ?? null]));
}
export function attachmentDto(file) {
  return {id:file.id,name:file.name,kind:file.kind,size:file.size,url:`/api/attachments/${file.id}`,...(file.duration == null ? {} : {duration:file.duration})};
}
export function recordDto(record) {
  if (!record) return null;
  const history=(record.revisions || []).map(revision=>({id:revision.id,beforeValue:revision.value,afterValue:record.revisions.find(next=>next.version===revision.version+1)?.value ?? record.value,reason:record.corrections?.find(correction=>correction.baseVersion===revision.version&&correction.status==='approved')?.reason || '당일 직접 수정',createdAt:revision.createdAt,actorId:revision.actorId,source:revision.source}));
  return {id:record.id,date:record.date,value:record.value,version:record.version,attachments:(record.attachments || []).map(attachmentDto),history,updatedAt:record.updatedAt};
}
export function correctionDto(correction) {
  return {id:correction.id,challengeId:correction.record?.challengeId ?? null,recordId:correction.recordId,date:correction.record?.date,beforeValue:correction.beforeValue,requestedValue:correction.requestedValue,baseVersion:correction.baseVersion,reason:correction.reason,status:correction.status,decisionReason:correction.decisionReason,createdAt:correction.createdAt,decidedAt:correction.decidedAt,preview:correction.preview || null,...(correction.requester ? {student:userDto(correction.requester)} : {}),...(correction.record ? {record:recordDto(correction.record)} : {}),...(correction.decider ? {decider:{id:correction.decider.id,name:correction.decider.name}} : {})};
}
export function programDto(challenge) {
  if (!challenge) return null;
  const today = koreanDate();
  return {challengeId:challenge.id,year:challenge.year,today,status:challengePhase(challenge,today),startDate:challenge.startDate,endDate:challenge.endDate,weeks:challenge.weeks,activityDates:activityDates(challenge.weeks),week12Pending:Boolean(challenge.weeks.find(week=>week.week===12)?.deferred)};
}
export const recordsWithAttachments = {include:{attachments:true},orderBy:{date:'asc'}};
export function studentSummary(user,challenge) { return {...userDto(user),summary:summarizeProgram(challenge.weeks,user.records || []),records:(user.records || []).map(recordDto)}; }
