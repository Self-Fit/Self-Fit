import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { buildDumbbellData, DUMBBELL_TRANSFORM } from './dumbbell-data.js';
import { legacyChallengeId, ensureLegacyMemberships } from './participation-data.js';

function sourceMetadata(source, prepared) {
  return { transform: DUMBBELL_TRANSFORM, summary: prepared.summary, source,
    timeMeaning: 'Database timestamps are import time. Original exercise timestamps remain in the archived rows and record provenance.',
    sourceMeaning: 'Exercise rules and participation are synthetic; source-marked actual fitness values are archived without updating the previous fitness dataset.',
  };
}
function sourceRows(prepared, userIds) {
  return prepared.students.map(student => ({
    userId: userIds.get(student.studentNumber), rosterJson: student.weeklyRow,
    metadataJson: { isSynthetic: true, transform: DUMBBELL_TRANSFORM, sourceSheet: '주간요약', sourceRow: student.sourceRow,
      fitnessMeaning: 'Actual fitness grade and score change remain as supplied in the weekly source row; no previous fitness data is changed.',
      dailyRows: student.dailyRows, exerciseRows: student.exerciseRows },
  }));
}
async function verifySaved(tx, datasetId, source, prepared, userIds, challengeId) {
  const metadata = sourceMetadata(source, prepared), rows = sourceRows(prepared, userIds);
  const [datasetCheck] = await tx.$queryRaw`SELECT "filename" = ${source.filename} AS "filenameExact",
    "metadataJson" = ${JSON.stringify(metadata)}::jsonb AS "metadataExact"
    FROM "SourceDataset" WHERE "id" = ${datasetId} AND "hash" = ${source.sha256}`;
  assert(datasetCheck?.filenameExact && datasetCheck.metadataExact, 'Existing source archive differs; no data will be overwritten');
  const [rowCheck] = await tx.$queryRaw`WITH expected AS (SELECT value AS row FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb))
    SELECT count(*)::int AS "expected", count(*) FILTER (WHERE s."id" IS NULL OR s."rosterJson" IS DISTINCT FROM e.row->'rosterJson'
      OR s."metadataJson" IS DISTINCT FROM e.row->'metadataJson' OR s."fitnessJson" IS NOT NULL)::int AS "mismatches"
    FROM expected e LEFT JOIN "StudentSource" s ON s."datasetId" = ${datasetId} AND s."userId" = e.row->>'userId'`;
  assert.equal(rowCheck.expected, prepared.students.length, 'Student source verification count differs');
  assert.equal(rowCheck.mismatches, 0, 'Existing student source rows differ; no data will be overwritten');
  assert.equal(await tx.studentSource.count({ where: { datasetId } }), prepared.students.length, 'Unexpected student source row count');
  const expectedRecords = prepared.records.map(record => ({ ...record, userId: userIds.get(record.studentNumber) }));
  const [recordCheck] = await tx.$queryRaw`WITH expected AS (SELECT value AS row FROM jsonb_array_elements(${JSON.stringify(expectedRecords)}::jsonb))
    SELECT count(*)::int AS "expected", count(*) FILTER (WHERE r."id" IS NULL OR r."value" IS DISTINCT FROM e.row->'value'
      OR r."sourceMetadata" IS DISTINCT FROM e.row->'sourceMetadata')::int AS "mismatches"
    FROM expected e LEFT JOIN "DailyRecord" r ON r."sourceDatasetId" = ${datasetId}
      AND r."challengeId" = ${challengeId} AND r."userId" = e.row->>'userId' AND r."date" = e.row->>'date'`;
  assert.equal(recordCheck.expected, prepared.records.length, 'Record verification count differs');
  assert.equal(recordCheck.mismatches, 0, 'Existing records differ from the import; no data will be overwritten');
  assert.equal(await tx.dailyRecord.count({ where: { challengeId, sourceDatasetId: datasetId } }), prepared.records.length, 'Unexpected imported record count');
  return { sourceArchiveExact: true, studentSourceRowsExact: true, recordValuesAndProvenanceExact: true };
}

/** Default is a read-only database preview. Only apply:true enables inserts. */
export async function importDumbbellData(db, source, { apply = false } = {}) {
  const prepared = buildDumbbellData(source);
  assert.equal(prepared.students.length, 194, 'This workbook must contain all 194 existing students');
  return db.$transaction(async tx => {
    if (!apply) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const challengeId = await legacyChallengeId(tx);
    const users = await tx.user.findMany({
      where: { studentNumber: { in: prepared.students.map(student => student.studentNumber) } },
      select: { id: true, studentNumber: true, role: true, name: true, grade: true, classNumber: true, targetType: true, participating: true },
    });
    assert.equal(users.length, prepared.students.length, 'A student account is missing; this importer never creates accounts');
    const byNumber = new Map(users.map(user => [user.studentNumber, user]));
    for (const student of prepared.students) {
      const user = byNumber.get(student.studentNumber);
      assert(user?.role === 'student' && user.name === student.name && user.grade === student.grade && user.classNumber === student.classNumber && user.participating === true,
        'Existing student identity or participation differs from the workbook');
    }
    await ensureLegacyMemberships(tx, users, { apply: false });
    const userIds = new Map(users.map(user => [user.studentNumber, user.id]));
    const existing = await tx.sourceDataset.findUnique({ where: { hash: source.sha256 }, select: { id: true } });
    if (existing) {
      await ensureLegacyMemberships(tx, users, { apply: false, requireExisting: true });
      const verification = await verifySaved(tx, existing.id, source, prepared, userIds, challengeId);
      return { mode: apply ? 'apply' : 'dry-run', alreadyImported: true, changed: false, datasetId: existing.id, ...prepared.summary, ...verification };
    }
    const conflicts = await tx.dailyRecord.count({ where: { challengeId, userId: { in: users.map(user => user.id) }, date: { in: prepared.summary.dates } } });
    assert.equal(conflicts, 0, 'Week 12 already contains records; aborting without overwriting any date');
    const recordsBefore = await tx.dailyRecord.count({ where: { challengeId } });
    const plan = { mode: apply ? 'apply' : 'dry-run', sourceHash: source.sha256, ...prepared.summary,
      existingAccountsMatched: users.length, conflicts, recordsBefore, expectedRecordsAfter: recordsBefore + prepared.records.length,
      accountsCreated: 0, passwordsChanged: 0, earlierWeekRecordsChanged: 0, previousFitnessDataChanged: 0,
    };
    if (!apply) return { ...plan, changed: false, readyToApply: true };
    await ensureLegacyMemberships(tx, users);
    const datasetId = randomUUID(), importedAt = new Date(), metadata = sourceMetadata(source, prepared);
    // JSON text binding preserves decimals in the original cached formulas.
    await tx.$executeRaw`INSERT INTO "SourceDataset" ("id", "hash", "filename", "metadataJson", "importedAt")
      VALUES (${datasetId}, ${source.sha256}, ${source.filename}, ${JSON.stringify(metadata)}::jsonb, ${importedAt})`;
    const rows = sourceRows(prepared, userIds).map(row => ({ id: randomUUID(), ...row }));
    await tx.$executeRaw`INSERT INTO "StudentSource" ("id", "datasetId", "userId", "rosterJson", "metadataJson")
      SELECT row->>'id', ${datasetId}, row->>'userId', row->'rosterJson', row->'metadataJson'
      FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS source(row)`;
    for (let offset = 0; offset < prepared.records.length; offset += 500) {
      await tx.dailyRecord.createMany({ data: prepared.records.slice(offset, offset + 500).map(record => ({
        id: randomUUID(), challengeId, userId: userIds.get(record.studentNumber), date: record.date, value: record.value,
        sourceDatasetId: datasetId, sourceMetadata: record.sourceMetadata, createdAt: importedAt, updatedAt: importedAt,
      })) });
    }
    const verification = await verifySaved(tx, datasetId, source, prepared, userIds, challengeId);
    assert.equal(await tx.dailyRecord.count({ where: { challengeId } }), plan.expectedRecordsAfter, 'Record count after import differs');
    return { ...plan, changed: true, datasetId, importedAt: importedAt.toISOString(), ...verification };
  }, { isolationLevel: apply ? 'Serializable' : 'RepeatableRead', timeout: 120000 });
}

async function main() {
  const [sourcePath, ...flags] = process.argv.slice(2);
  assert(sourcePath && flags.every(flag => ['--apply', '--dry-run'].includes(flag)) && new Set(flags).size === flags.length && !(flags.includes('--apply') && flags.includes('--dry-run')),
    'Usage: node --env-file=.env scripts/import-dumbbell-data.js source.json [--dry-run | --apply]');
  const directory = await fs.realpath(path.dirname(path.resolve(sourcePath)));
  const importRoot = await fs.realpath(fileURLToPath(new URL('../../.local/imports', import.meta.url)));
  const relative = path.relative(importRoot, directory);
  assert(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), 'Use a private project .local/imports directory');
  const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const hash = createHash('sha256').update(await fs.readFile(path.join(directory, 'source.xlsx'))).digest('hex');
  assert.equal(hash, source.sha256, 'Source workbook fingerprint mismatch');
  const db = new PrismaClient();
  try { console.log(JSON.stringify(await importDumbbellData(db, source, { apply: flags.includes('--apply') }))); }
  finally { await db.$disconnect(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.code ? `Dumbbell import failed (${error.code}); no passwords are logged.` : error.message);
    process.exitCode = 1;
  });
}
