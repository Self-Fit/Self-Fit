import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPassword, validatePassword, verifyPassword } from '../src/password.js';
import { buildParticipationData, legacyChallengeId, ensureLegacyMemberships } from './participation-data.js';

// Import is deliberately separate from student date-entry APIs. The supplied
// historical dummy workbook does not authorize changing the live date or rules.
const [sourcePath, ...flags] = process.argv.slice(2);
assert(sourcePath, 'Usage: node --env-file=.env scripts/import-participation.js source.json [--apply]');
assert(flags.every(flag => flag === '--apply'), 'Unknown argument');
const directory = path.dirname(path.resolve(sourcePath));
assert(directory.includes(`${path.sep}.local${path.sep}`), 'Use the private .local import directory');
const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const workbookHash = createHash('sha256').update(await fs.readFile(path.join(directory, 'source.xlsx'))).digest('hex');
assert.equal(workbookHash, source.sha256, 'Workbook fingerprint does not match extracted data');
const prepared = buildParticipationData(source);
const summary = { sourceHash: source.sha256, ...prepared.summary, students: prepared.students.length,
  records: prepared.records.length, teacher: { studentNumber: 'seoseungbeom', name: '서승범' } };
await fs.writeFile(path.join(directory, 'mapping.json'), JSON.stringify({summary, mapping:prepared.mapping}, null, 2), {mode:0o600});
console.log(JSON.stringify({mode:flags.includes('--apply') ? 'apply' : 'preview', ...summary}));
if (!flags.includes('--apply')) process.exit(0);

const db = new PrismaClient();
const credentialPath = path.join(directory, 'accounts.private.json');
async function preserveExactSource(tx, datasetId, userIds) {
  // Bind JSON as text before PostgreSQL's cast: Prisma's Json-number serializer
  // rounds long source decimals. JSONB retains the original serialized number.
  const metadata = {transform:'same-exercise-week-block-v1',summary,mapping:prepared.mapping,
    sourceSheets:source.sheets,timeMeaning:'Account and record timestamps are import time; historical event times were not supplied.'};
  await tx.$executeRaw`UPDATE "SourceDataset" SET "metadataJson" = ${JSON.stringify(metadata)}::jsonb WHERE "id" = ${datasetId}`;
  const rows = prepared.students.map(s=>({userId:userIds.get(s.studentNumber),roster:s.rosterRow,fitness:s.fitness}));
  const updated = await tx.$executeRaw`UPDATE "StudentSource" AS target
    SET "rosterJson" = source.row->'roster', "fitnessJson" = source.row->'fitness'
    FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS source(row)
    WHERE target."datasetId" = ${datasetId} AND target."userId" = source.row->>'userId'`;
  assert.equal(updated,prepared.students.length,'Original roster archive count does not match');
}
async function finish(credentials, datasetId, importedAt, passwordHashesVerified) {
  assert.equal(credentials.sourceHash, source.sha256);
  assert.deepEqual(credentials.accounts.map(a=>a.studentNumber), [...prepared.students.map(s=>s.studentNumber), 'seoseungbeom']);
  const lines = ['Self-Fit 로그인 계정',`생성일시: ${importedAt.toISOString()}`,
    '교사: http://127.0.0.1:5173/web/login','학생: http://127.0.0.1:5173/mobile',
    '학생 계정은 최초 로그인 후 비밀번호를 변경합니다. 교사 비밀번호는 설정에서 변경할 수 있습니다.',
    '이 목록은 생성 당시 초기 비밀번호입니다. 나중에 변경한 비밀번호로 갱신되지는 않습니다.',
    '서비스 DB에는 비밀번호 해시를 저장합니다.','', '구분\t이름\t로그인 아이디\t초기 비밀번호',
    ...[...credentials.accounts].sort((a,b)=>a.role===b.role ? a.studentNumber.localeCompare(b.studentNumber) : a.role==='teacher' ? -1 : 1)
      .map(a=>`${a.role==='teacher' ? '관리교사' : a.targetType==='required' ? '학생(필수)' : '학생(선택)'}\t${a.name}\t${a.studentNumber}\t${a.password}`),''];
  await fs.writeFile(path.join(directory,'accounts.txt'),lines.join('\n'),{mode:0o600});
  await fs.writeFile(path.join(directory,'import-result.json'),JSON.stringify({
    ...summary,datasetId,importedAt:importedAt.toISOString(),accounts:credentials.accounts.length,
    passwordHashesVerified,sourceWorkbookRetained:true,sourceRowsRetained:true,
    notificationsCreated:0,correctionsCreated:0,attachmentsCreated:0,
  },null,2),{mode:0o600});
}
try {
  const challengeId = await legacyChallengeId(db);
  const existing = await db.sourceDataset.findUnique({where:{hash:source.sha256}});
  if (existing) {
    assert.equal(existing.metadataJson.transform, 'same-exercise-week-block-v1', 'Source already exists with a different transformation');
    const rows = await db.studentSource.count({where:{datasetId:existing.id}});
    const records = await db.dailyRecord.count({where:{challengeId,sourceDatasetId:existing.id}});
    assert.equal(rows, prepared.students.length, 'Existing student import is incomplete');
    assert.equal(records, prepared.records.length, 'Existing record import is incomplete');
    const credentials = JSON.parse(await fs.readFile(credentialPath,'utf8'));
    const existingUsers = await db.user.findMany({where:{studentNumber:{in:prepared.students.map(s=>s.studentNumber)}},select:{id:true,studentNumber:true,role:true,targetType:true,participating:true}});
    await db.$transaction(async tx=>{
      await ensureLegacyMemberships(tx, existingUsers);
      await preserveExactSource(tx,existing.id,new Map(existingUsers.map(u=>[u.studentNumber,u.id])));
    },{timeout:120000});
    await finish(credentials, existing.id, existing.importedAt, null);
    console.log(JSON.stringify({alreadyImported:true, students:rows, records}));
    process.exitCode=0;
  } else {
    const teacherNumber = 'seoseungbeom';
    const identifiers = [...prepared.students.map(s=>s.studentNumber), teacherNumber];
    assert.equal(new Set(identifiers).size, identifiers.length, 'Duplicate login identifier');
    assert.equal(await db.user.count({where:{studentNumber:{in:identifiers}}}),0,'An account already exists; refusing to reset passwords or overwrite records');
    let credentials;
    try {
      credentials = JSON.parse(await fs.readFile(credentialPath,'utf8'));
      assert.equal(credentials.sourceHash, source.sha256);
      assert.deepEqual(credentials.accounts.map(a=>a.studentNumber),identifiers);
    } catch(error) {
      if(error.code !== 'ENOENT') throw error;
      credentials = {sourceHash:source.sha256, accounts: [
        ...prepared.students.map(s=>({studentNumber:s.studentNumber,name:s.name,role:'student',targetType:s.targetType})),
        {studentNumber:teacherNumber,name:'서승범',role:'teacher'},
      ].map(a=>({...a,password:`Sf1${randomBytes(10).toString('base64url')}`}))};
      await fs.writeFile(credentialPath,JSON.stringify(credentials,null,2),{mode:0o600,flag:'wx'});
    }
    const importedAt = new Date();
    const users = [];
    for(const account of credentials.accounts) {
      validatePassword(account.password, account.studentNumber);
      const student = prepared.students.find(s=>s.studentNumber===account.studentNumber);
      users.push({id:randomUUID(),role:account.role,studentNumber:account.studentNumber,name:account.name,
        grade:student?.grade ?? null,classNumber:student?.classNumber ?? null,targetType:student?.targetType ?? null,
        participating:student?.participating ?? false,weekendReminder:student?.weekendReminder ?? false,
        passwordHash:await hashPassword(account.password),mustChangePassword:account.role==='student',
        createdAt:importedAt,updatedAt:importedAt});
    }
    const userIds = new Map(users.map(u=>[u.studentNumber,u.id]));
    const datasetId = randomUUID();
    await db.$transaction(async tx=>{
      await tx.sourceDataset.create({data:{id:datasetId,hash:source.sha256,filename:source.filename,
        metadataJson:{transform:'same-exercise-week-block-v1'}}});
      await tx.user.createMany({data:users});
      await ensureLegacyMemberships(tx, users);
      await tx.studentSource.createMany({data:prepared.students.map(s=>({id:randomUUID(),datasetId,userId:userIds.get(s.studentNumber),
        rosterJson:[],metadataJson:{sourceSheet:'학생명단',sourceRow:s.sourceRow,
          participation:'synthetic',fitness:'source-marked-actual',historicalRegistrationTime:null}}))});
      await preserveExactSource(tx,datasetId,userIds);
      for(let index=0;index<prepared.records.length;index+=500) {
        await tx.dailyRecord.createMany({data:prepared.records.slice(index,index+500).map(r=>({
          id:randomUUID(),challengeId,userId:userIds.get(r.studentNumber),date:r.date,value:r.value,
          sourceDatasetId:datasetId,sourceMetadata:r.sourceMetadata,createdAt:importedAt,updatedAt:importedAt,
        }))});
      }
      assert.equal(await tx.user.count({where:{id:{in:users.map(u=>u.id)}}}),users.length);
      assert.equal(await tx.dailyRecord.count({where:{challengeId,sourceDatasetId:datasetId}}),prepared.records.length);
    }, {timeout:120000});
    const saved = await db.user.findMany({where:{id:{in:users.map(u=>u.id)}}});
    for(const account of credentials.accounts) {
      assert(await verifyPassword(account.password,saved.find(u=>u.studentNumber===account.studentNumber).passwordHash), 'Stored password check failed');
    }
    await finish(credentials,datasetId,importedAt,saved.length);
    console.log(JSON.stringify({imported:true,accounts:users.length,records:prepared.records.length,passwordHashesVerified:saved.length}));
  }
} finally {await db.$disconnect();}
