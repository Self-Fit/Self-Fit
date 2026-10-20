import ExcelJS from 'exceljs';
import multer from 'multer';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { fail, requiredText } from './errors.js';
import { temporaryPassword, hashPassword } from './password.js';
import { validateXlsxArchive } from './xlsx-safety.js';
export function studentFields(input,partial=false) {
  const fields={};
  for(const key of ['studentNumber','name']) {
    if(partial&&input[key]===undefined) continue;
    fields[key]=requiredText(input[key],key==='name'?'이름':'학번',key==='name'?100:64);
  }
  for(const key of ['grade','classNumber']) {
    if(partial&&input[key]===undefined) continue;
    if(!Number.isInteger(input[key])||input[key]<1||input[key]>2147483647) fail(400,'INVALID_INPUT',`${key==='grade'?'학년':'반'}은 양의 정수로 입력해 주세요.`);
    fields[key]=input[key];
  }
  if(!partial||input.targetType!==undefined) {
    if(!['required','optional'].includes(input.targetType)) fail(400,'INVALID_INPUT','대상 구분은 필수 또는 선택이어야 합니다.');
    fields.targetType=input.targetType;
  }
  return fields;
}
export function formatWorkbook(workbook) {
  for(const sheet of workbook.worksheets) {
    sheet.views=[{state:'frozen',ySplit:1}];
    sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
    sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF159B80'}};
    sheet.getRow(1).height=24;
    for(const col of sheet.columns) if(!col.width) col.width=20;
    if(sheet.columnCount) sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:sheet.columnCount}};
  }
}
export async function sendWorkbook(res,workbook,filename) {
  formatWorkbook(workbook);
  res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'no-store'});
  await workbook.xlsx.write(res);res.end();
}
export function rosterRouter(db) {
  const router=Router();
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:0}});
  router.get('/template',async(req,res)=>{
    const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('학생 명단');
    sheet.columns=[{header:'학번',key:'studentNumber',width:20},{header:'이름',key:'name',width:20},{header:'학년',key:'grade',width:12},{header:'반',key:'classNumber',width:12},{header:'대상구분',key:'targetType',width:16}];
    sheet.getColumn(1).numFmt='@';
    sheet.getCell('E2').dataValidation={type:'list',allowBlank:true,formulae:['"필수,선택"']};
    const guide=workbook.addWorksheet('작성 안내');
    guide.addRows([['항목','안내'],['학번','문자열로 입력합니다. 선행 0을 유지하세요.'],['대상구분','필수 또는 선택'],['주의','첫 시트의 2행부터 실제 학생만 입력하세요. 기존 학번과 중복되면 등록하지 않습니다.'],['비밀번호','등록 완료 시 개인별 임시 비밀번호를 한 번 제공합니다.']]);
    await sendWorkbook(res,workbook,'self-fit-roster-template.xlsx');
  });
  router.post('/validate',upload.single('file'),async(req,res)=>{
    if(!req.file||!req.file.originalname.toLowerCase().endsWith('.xlsx')) fail(400,'XLSX_REQUIRED','엑셀 .xlsx 명단 파일을 선택해 주세요.');
    validateXlsxArchive(req.file.buffer);
    const workbook=new ExcelJS.Workbook();
    try {await workbook.xlsx.load(req.file.buffer);} catch {fail(400,'INVALID_XLSX','엑셀 파일을 읽을 수 없습니다. 명단 양식의 .xlsx 파일을 사용해 주세요.');}
    const sheet=workbook.worksheets[0];
    if(!sheet) fail(400,'EMPTY_XLSX','명단 시트가 없습니다.');
    if(sheet.rowCount>20001) fail(400,'ROSTER_TOO_LARGE','한 번에 20,000명 이하로 나누어 등록해 주세요.');
    const expected=['학번','이름','학년','반','대상구분'];
    if(expected.some((header,index)=>sheet.getRow(1).getCell(index+1).text.trim()!==header)) fail(400,'INVALID_HEADERS','첫 행은 학번, 이름, 학년, 반, 대상구분 순서로 입력해 주세요.');
    const rows=[];const errors=[];const seen=new Set();
    sheet.eachRow((row,rowNumber)=>{
      if(rowNumber===1||row.values.slice(1).every(cell=>cell==null||cell==='')) return;
      try {
        const cells=expected.map((_,index)=>row.getCell(index+1));
        if(cells.some(cell=>cell.type===ExcelJS.ValueType.Formula||cell.type===ExcelJS.ValueType.Hyperlink||cell.type===ExcelJS.ValueType.RichText)) fail(400,'INVALID_CELL','수식·링크 대신 일반 값으로 입력해 주세요.');
        const data=studentFields({studentNumber:cells[0].text.trim(),name:cells[1].text.trim(),grade:Number(cells[2].value),classNumber:Number(cells[3].value),targetType:({'필수':'required','선택':'optional',required:'required',optional:'optional'})[cells[4].text.trim()]});
        if(seen.has(data.studentNumber)) fail(400,'DUPLICATE_NUMBER','파일 안에 같은 학번이 중복되어 있습니다.');
        seen.add(data.studentNumber);rows.push({...data,row:rowNumber});
      } catch(error) {errors.push({row:rowNumber,message:error.message});}
    });
    if(!rows.length&&!errors.length) errors.push({row:2,message:'등록할 학생 정보가 없습니다.'});
    const existing=await db.user.findMany({where:{studentNumber:{in:rows.map(row=>row.studentNumber)}},select:{studentNumber:true}});
    const existingIds=new Set(existing.map(user=>user.studentNumber));
    for(const row of rows) if(existingIds.has(row.studentNumber)) errors.push({row:row.row,message:`이미 등록된 학번입니다: ${row.studentNumber}`});
    const expiresAt=new Date(Date.now()+30*60*1000);
    const validRows=rows.map(({row,...data})=>data);
    let importId=null;
    if(!errors.length) importId=(await db.rosterImport.create({data:{teacherId:req.user.id,rows:validRows,expiresAt}})).id;
    res.json({importId,rows:validRows,errors,expiresAt});
  });
  router.post('/commit',async(req,res)=>{
    const importId=requiredText(req.body?.importId,'검증 명단 ID',100);
    const item=await db.rosterImport.findFirst({where:{id:importId,teacherId:req.user.id}});
    if(!item||item.consumed||item.expiresAt<new Date()) fail(409,'IMPORT_EXPIRED','명단 검증이 만료되었거나 이미 등록되었습니다. 파일을 다시 검증해 주세요.');
    const credentials=[];const prepared=[];
    for(const row of item.rows) {
      const password=temporaryPassword();
      prepared.push({...row,role:'student',participating:row.targetType==='required',passwordHash:await hashPassword(password),mustChangePassword:true});
      credentials.push({studentNumber:row.studentNumber,name:row.name,temporaryPassword:password});
    }
    await db.$transaction(async tx=>{
      const taken=await tx.rosterImport.updateMany({where:{id:importId,teacherId:req.user.id,consumed:false,expiresAt:{gt:new Date()}},data:{consumed:true}});
      if(!taken.count) fail(409,'IMPORT_EXPIRED','이미 등록되었거나 만료된 명단입니다.');
      await tx.user.createMany({data:prepared}).catch(error=>{if(error.code==='P2002') fail(409,'DUPLICATE_NUMBER','검증 이후에 등록된 학번이 있습니다. 파일을 다시 검증해 주세요.');throw error;});
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30_000});
    res.status(201).json({created:prepared.length,credentials});
  });
  return router;
}
