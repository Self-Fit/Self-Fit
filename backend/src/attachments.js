import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, rename, unlink, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileTypeFromFile } from 'file-type';
import { fail, dateParam } from './errors.js';
import { attachmentDto } from './dto.js';
import { checkEditable } from './student.js';
const run=promisify(execFile);
const IMAGE_MIMES=new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif']);
const VIDEO_MIMES=new Set(['video/mp4','video/webm','video/quicktime']);
export async function attachmentRouters(db,storageDir) {
  const staging=path.join(storageDir,'.staging');
  await mkdir(staging,{recursive:true,mode:0o700});
  const upload=multer({dest:staging,limits:{fileSize:100*1024*1024,files:1,fields:0}});
  const student=Router(); const files=Router();
  const ownRecord=async(req,res,next)=>{
    const date=dateParam(req.params.date); checkEditable(req.user,date);
    const record=await db.dailyRecord.findUnique({where:{userId_date:{userId:req.user.id,date}}});
    if(!record) fail(404,'SAVE_RECORD_FIRST','운동 기록을 먼저 저장한 뒤 파일을 첨부해 주세요.');
    req.activityRecord=record; req.uploadStartedAt=new Date(); next();
  };
  student.post('/records/:date/attachments',ownRecord,upload.single('file'),async(req,res,next)=>{
    let storedPath; let committed=false;
    try {
      if(!req.file) fail(400,'FILE_REQUIRED','첨부할 파일을 선택해 주세요.');
      const detected=await fileTypeFromFile(req.file.path);
      if(!detected) fail(415,'UNSUPPORTED_FILE','파일 형식을 확인할 수 없습니다. JPG·PNG·WebP 사진 또는 MP4·WebM 영상을 사용해 주세요.');
      const kind=IMAGE_MIMES.has(detected.mime)?'image':VIDEO_MIMES.has(detected.mime)?'video':null;
      if(!kind) fail(415,'UNSUPPORTED_FILE','지원하지 않는 사진·영상 형식입니다.');
      if(kind==='image'&&req.file.size>10*1024*1024) fail(413,'IMAGE_TOO_LARGE','사진은 파일당 10MB까지 첨부할 수 있습니다.');
      let duration;
      if(kind==='video') {
        let result;
        try {result=await run(process.env.FFPROBE_PATH || 'ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,duration','-of','json',req.file.path],{timeout:30_000,maxBuffer:1_000_000});}
        catch(error) {if(error.code==='ENOENT') fail(503,'VIDEO_VERIFIER_UNAVAILABLE','서버의 영상 검사 도구가 준비되지 않았습니다. 기록은 저장되어 있으니 사진 첨부 또는 나중에 재시도해 주세요.');fail(400,'INVALID_VIDEO','영상 길이를 확인할 수 없습니다. MP4 또는 WebM으로 다시 저장해 주세요.');}
        let metadata; try {metadata=JSON.parse(result.stdout);} catch {fail(400,'INVALID_VIDEO','올바른 영상 파일이 아닙니다.');}
        const durations=[metadata.format?.duration,...(metadata.streams||[]).map(stream=>stream.duration)].map(Number).filter(Number.isFinite);
        duration=Math.max(...durations);
        if(!metadata.streams?.some(stream=>stream.codec_type==='video')||!Number.isFinite(duration)||duration<=0) fail(400,'INVALID_VIDEO','재생 가능한 영상과 길이를 확인할 수 없습니다.');
        if(duration>60) fail(400,'VIDEO_TOO_LONG','영상은 60초 이하만 첨부할 수 있습니다.');
      }
      const storageKey=`${randomUUID()}.${detected.ext}`; storedPath=path.join(storageDir,storageKey);
      await rename(req.file.path,storedPath);
      const file=await db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${req.activityRecord.id}))::text`;
        const count=await tx.attachment.count({where:{recordId:req.activityRecord.id,kind}});
        if(count >= (kind==='image'?3:1)) fail(409,'ATTACHMENT_LIMIT',kind==='image'?'하루 기록에는 사진을 최대 3장 첨부할 수 있습니다.':'하루 기록에는 영상을 최대 1개 첨부할 수 있습니다.');
        return tx.attachment.create({data:{recordId:req.activityRecord.id,name:path.basename(req.file.originalname).slice(0,200),storageKey,kind,mimeType:detected.mime,size:req.file.size,duration}});
      });
      committed=true; res.status(201).json({attachment:attachmentDto(file)});
    } catch(error) {next(error);} finally {
      if(!committed) {if(req.file) await unlink(req.file.path).catch(()=>{});if(storedPath) await unlink(storedPath).catch(()=>{});}
    }
  });
  student.delete('/records/:date/attachments/:id',ownRecord,async(req,res)=>{
    const file=await db.attachment.findFirst({where:{id:req.params.id,recordId:req.activityRecord.id}});
    if(!file) fail(404,'NOT_FOUND','첨부 파일을 찾을 수 없습니다.');
    checkEditable(req.user,req.params.date);
    await db.attachment.delete({where:{id:file.id}});
    await unlink(path.join(storageDir,file.storageKey)).catch(error=>{if(error.code!=='ENOENT') console.error(JSON.stringify({event:'attachment_unlink_failed',id:file.id}));});
    res.json({ok:true});
  });
  files.get('/:id',async(req,res)=>{
    const file=await db.attachment.findUnique({where:{id:req.params.id},include:{record:true}});
    if(!file) fail(404,'NOT_FOUND','첨부 파일을 찾을 수 없습니다.');
    if(req.user.role!=='teacher'&&file.record.userId!==req.user.id) fail(403,'FORBIDDEN','이 첨부 파일을 열람할 수 없습니다.');
    const filePath=path.join(storageDir,file.storageKey);
    try {await stat(filePath);} catch {fail(404,'FILE_MISSING','파일이 저장소에 없습니다. 관리자에게 문의해 주세요.');}
    res.set({'Content-Type':file.mimeType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="attachment.${file.storageKey.split('.').pop()}"`});
    res.sendFile(filePath);
  });
  return {student,files};
}
