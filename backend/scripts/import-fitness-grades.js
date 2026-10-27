import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { buildFitnessGradeData, existingFitnessForUser, fitnessCheck, FITNESS_GRADE_TRANSFORM, FITNESS_YEAR, normalizedName, readFitnessWorkbook } from './fitness-grade-data.js';

const metadataFor = (source, prepared) => ({
  transform: FITNESS_GRADE_TRANSFORM, source, summary: prepared.summary,
  matching: '2026 exact school-grade/class/number and name only. 2025 is retained without linking to an account.',
  periodMeaning: 'Year and semester are source labels, not measurement timestamps. Current grade is the latest confirmed second semester.',
});
const sourceRowFor = (student, userId) => ({ userId, rosterJson: student.rosterRow, fitnessJson: student.fitness,
  metadataJson: { transform: FITNESS_GRADE_TRANSFORM, year: FITNESS_YEAR, sourceSheet: student.sourceSheet, sourceRow: student.sourceRow, matching: 'exact-number-and-name' } });

async function verifySource(tx, datasetId, source, prepared, rows) {
  const [archive] = await tx.$queryRaw`SELECT "filename" = ${source.filename} AND "metadataJson" = ${JSON.stringify(metadataFor(source, prepared))}::jsonb AS "exact"
    FROM "SourceDataset" WHERE "id" = ${datasetId} AND "hash" = ${source.sha256}`;
  fitnessCheck(archive?.exact, '이미 적재한 파일의 보존 원본이 다릅니다.');
  const [result] = await tx.$queryRaw`WITH expected AS (SELECT value AS row FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb))
    SELECT count(*) FILTER (WHERE s."id" IS NULL OR s."rosterJson" IS DISTINCT FROM e.row->'rosterJson'
      OR s."fitnessJson" IS DISTINCT FROM e.row->'fitnessJson' OR s."metadataJson" IS DISTINCT FROM e.row->'metadataJson')::int AS "mismatches"
    FROM expected e LEFT JOIN "StudentSource" s ON s."datasetId" = ${datasetId} AND s."userId" = e.row->>'userId'`;
  fitnessCheck(result.mismatches === 0 && await tx.studentSource.count({ where: { datasetId } }) === rows.length, '이미 적재한 학생 원본이 다릅니다.');
}

/** Preview uses a read-only snapshot. Apply changes only assessment/cache and new provenance rows. */
export async function importFitnessGrades(db, source, { apply = false, includeExisting = false } = {}) {
  fitnessCheck(typeof apply === 'boolean' && typeof includeExisting === 'boolean', '적재 옵션을 확인해 주세요.');
  const prepared = buildFitnessGradeData(source);
  return db.$transaction(async tx => {
    if (!apply) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    else await tx.$executeRawUnsafe('LOCK TABLE "User", "SourceDataset", "StudentSource", "StudentFitnessAssessment" IN SHARE ROW EXCLUSIVE MODE');
    const users = await tx.user.findMany({ where: { role: 'student' }, select: {
      id: true, studentNumber: true, name: true, grade: true, classNumber: true,
      fitnessGrade: true, fitnessGradeYear: true, fitnessGradeSemester: true,
    } });
    const byNumber = new Map(users.map(user => [user.studentNumber, user]));
    const matched = new Map();
    for (const row of prepared.students) {
      const user = byNumber.get(row.studentNumber);
      fitnessCheck(user && normalizedName(user.name) === row.name && user.grade === row.grade && user.classNumber === row.classNumber,
        `${row.sourceSheet} ${row.sourceRow}행: 현재 학생의 학번·이름·학년·반이 일치하지 않아요.`);
      matched.set(user.id, row);
    }
    const existingDataset = await tx.sourceDataset.findUnique({ where: { hash: source.sha256 }, select: { id: true } });
    const datasetId = existingDataset?.id || randomUUID();
    const sourceRows = await tx.studentSource.findMany({ where: { userId: { in: users.map(user => user.id) } } });
    const sources = await tx.$queryRaw`SELECT "id", "metadataJson"->>'transform' AS "transform" FROM "SourceDataset"`;
    const transforms = new Map(sources.map(item => [item.id, item.transform]));
    const rowsByUser = new Map(users.map(user => [user.id, sourceRows.filter(row => row.userId === user.id && row.datasetId !== datasetId)]));
    const candidates = [], originalRows = [];
    for (const user of users) {
      const direct = matched.get(user.id);
      if (!direct && !includeExisting) continue;
      let previous = null;
      // Compare the new file with existing semester evidence whenever present.
      // The include-existing mode requires that evidence for every additional account.
      if (rowsByUser.get(user.id).some(row => row.fitnessJson !== null) || !direct) {
        previous = existingFitnessForUser(user, rowsByUser.get(user.id), transforms);
        originalRows.push(previous.sourceStudentSourceId);
        if (direct) fitnessCheck(isDeepStrictEqual(previous.fitness, direct.fitness), '새 파일과 기존 원본의 같은 학기 점수·등급이 다릅니다.');
      }
      const fitness = direct?.fitness || previous.fitness;
      const provenance = direct ? { sourceDatasetId: datasetId, sourceSheet: direct.sourceSheet, sourceRow: direct.sourceRow } : previous;
      for (const semester of [1, 2]) candidates.push({ userId: user.id, year: FITNESS_YEAR, semester,
        grade: fitness[`semester${semester}`].grade, score: fitness[`semester${semester}`].score,
        sourceDatasetId: provenance.sourceDatasetId, sourceSheet: provenance.sourceSheet, sourceRow: provenance.sourceRow });
    }
    if (originalRows.length) {
      const [check] = await tx.$queryRaw`WITH expected AS (SELECT jsonb_array_elements_text(${JSON.stringify(originalRows)}::jsonb) AS id)
        SELECT count(*) FILTER (WHERE s."id" IS NULL OR s."rosterJson" IS DISTINCT FROM
          d."metadataJson"->'sourceSheets'->(s."metadataJson"->>'sourceSheet')->((s."metadataJson"->>'sourceRow')::int - 1))::int AS "mismatches"
        FROM expected e LEFT JOIN "StudentSource" s ON s."id" = e.id LEFT JOIN "SourceDataset" d ON d."id" = s."datasetId"`;
      fitnessCheck(check.mismatches === 0, '기존 체력 원본의 시트·행 위치가 보존된 파일과 다릅니다.');
    }
    const selectedIds = [...new Set(candidates.map(row => row.userId))];
    const history = await tx.studentFitnessAssessment.findMany({ where: { userId: { in: selectedIds } } });
    const key = row => `${row.userId}:${row.year}:${row.semester}`;
    const byPeriod = new Map(history.map(row => [key(row), row]));
    const inserts = [];
    for (const candidate of candidates) {
      const prior = byPeriod.get(key(candidate));
      fitnessCheck(!prior || (prior.grade === candidate.grade && prior.score === candidate.score), '이미 저장된 같은 학기 평가와 원본 값이 다릅니다.');
      if (!prior) { inserts.push(candidate); byPeriod.set(key(candidate), candidate); }
    }
    const cacheChanges = [];
    for (const user of users.filter(item => selectedIds.includes(item.id))) {
      const latest = [...byPeriod.values()].filter(row => row.userId === user.id && row.semester === 2).sort((a, b) => b.year - a.year)[0];
      const fields = { fitnessGrade: latest.grade, fitnessGradeYear: latest.year, fitnessGradeSemester: 2 };
      if (Object.entries(fields).some(([field, value]) => user[field] !== value)) cacheChanges.push({ userId: user.id, fields });
    }
    const rows = prepared.students.map(student => sourceRowFor(student, byNumber.get(student.studentNumber).id));
    if (existingDataset) await verifySource(tx, datasetId, source, prepared, rows);
    const plan = { mode: apply ? 'apply' : 'dry-run', sourceHash: source.sha256, ...prepared.summary,
      includeExisting, matchedStudents: matched.size, supplementedStudents: selectedIds.length - matched.size,
      assessmentInserts: inserts.length, existingAssessments: candidates.length - inserts.length, cacheUpdates: cacheChanges.length,
      sourceDatasetInserts: existingDataset ? 0 : 1, studentSourceInserts: existingDataset ? 0 : rows.length,
      accountsCreated: 0, credentialsChanged: 0, exerciseRecordsChanged: 0, membershipsChanged: 0, previousSourceRowsChanged: 0,
      alreadyImported: Boolean(existingDataset), changed: false, readyToApply: true };
    if (!apply) return plan;
    if (!existingDataset) {
      await tx.$executeRaw`INSERT INTO "SourceDataset" ("id", "hash", "filename", "metadataJson", "importedAt")
        VALUES (${datasetId}, ${source.sha256}, ${source.filename}, ${JSON.stringify(metadataFor(source, prepared))}::jsonb, CURRENT_TIMESTAMP)`;
      const newRows = rows.map(row => ({ id: randomUUID(), ...row }));
      await tx.$executeRaw`INSERT INTO "StudentSource" ("id", "datasetId", "userId", "rosterJson", "fitnessJson", "metadataJson")
        SELECT row->>'id', ${datasetId}, row->>'userId', row->'rosterJson', row->'fitnessJson', row->'metadataJson'
        FROM jsonb_array_elements(${JSON.stringify(newRows)}::jsonb) AS source(row)`;
    }
    if (inserts.length) {
      const inserted = await tx.studentFitnessAssessment.createMany({ data: inserts });
      fitnessCheck(inserted.count === inserts.length, '학기 평가 저장 건수가 예상과 다릅니다.');
    }
    for (const { userId, fields } of cacheChanges) {
      // Keep account timestamps too: this projection is not a profile/password edit.
      const updated = await tx.$executeRaw`UPDATE "User" SET "fitnessGrade" = ${fields.fitnessGrade}, "fitnessGradeYear" = ${fields.fitnessGradeYear},
        "fitnessGradeSemester" = 2 WHERE "id" = ${userId} AND "role" = 'student'`;
      fitnessCheck(updated === 1, '현재 등급을 저장할 학생이 변경됐어요.');
    }
    await verifySource(tx, datasetId, source, prepared, rows);
    return { ...plan, datasetId, changed: !existingDataset || inserts.length > 0 || cacheChanges.length > 0, sourceArchiveExact: true };
  }, { isolationLevel: apply ? 'Serializable' : 'RepeatableRead', timeout: 120000, maxWait: 10000 });
}

async function main() {
  const [filename, ...flags] = process.argv.slice(2);
  fitnessCheck(filename && flags.every(flag => ['--apply', '--dry-run', '--include-existing'].includes(flag)) && new Set(flags).size === flags.length
    && !(flags.includes('--apply') && flags.includes('--dry-run')),
  'Usage: node --env-file=backend/.env backend/scripts/import-fitness-grades.js workbook.xlsx [--include-existing] [--dry-run | --apply]');
  const source = await readFitnessWorkbook(filename);
  const db = new PrismaClient();
  try { console.log(JSON.stringify(await importFitnessGrades(db, source, { apply: flags.includes('--apply'), includeExisting: flags.includes('--include-existing') }))); }
  finally { await db.$disconnect(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Prisma/file-parser errors may embed private rows. Only our bounded messages are safe.
    console.error(error.code === 'FITNESS_IMPORT_INVALID' ? error.message : 'Fitness import failed; no private data is logged.');
    process.exitCode = 1;
  });
}
