import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { buildRevisedParticipationData, REVISED_PARTICIPATION_TRANSFORM } from './revised-participation-data.js';
import { legacyChallengeId, ensureLegacyMemberships } from './participation-data.js';

const PREVIOUS_TRANSFORMS = new Set(['same-exercise-week-block-v1', 'week12-dumbbell-sets-v1']);
const sha256 = text => createHash('sha256').update(text).digest('hex');
const baseMetadata = (source, prepared) => ({
  transform: REVISED_PARTICIPATION_TRANSFORM, source, summary: prepared.summary,
  sourceMeaning: 'Participation is synthetic. Original actual fitness values, formulas, and cached results are archived without changing previous datasets.',
  timeMeaning: 'Existing record IDs and creation times are retained. Updated timestamps and versions change only when the recorded value changes. Workbook timestamps remain source metadata.',
});
const sourceRows = (prepared, ids) => prepared.students.map(student => ({
  userId: ids.get(student.studentNumber), rosterJson: student.rosterRow, fitnessJson: student.fitness,
  metadataJson: { transform: REVISED_PARTICIPATION_TRANSFORM, isSynthetic: true, sourceSheet: '학생별현황', sourceRow: student.sourceRow,
    dailyRows: student.dailyRows, exerciseRows: student.exerciseRows },
}));

// PostgreSQL constructs and serializes the archive so existing JSON numbers and timestamps
// never pass through Prisma's JSON encoder or a parse/stringify conversion.
async function recordSnapshot(tx, challengeId, legacyShape = false) {
  // Pre-challenge revision archives are immutable. Excluding only the newly
  // backfilled column reproduces their exact PostgreSQL JSONB fingerprint.
  const omit = legacyShape ? 'challengeId' : '__no_snapshot_column__';
  const [result] = await tx.$queryRaw`SELECT COALESCE(jsonb_agg(to_jsonb(r) - ${omit} ORDER BY r."id"), '[]'::jsonb)::text AS "text"
    FROM "DailyRecord" r WHERE r."challengeId" = ${challengeId}`;
  return result.text;
}
async function previousSources(tx) {
  return tx.$queryRaw`SELECT "id", "hash", "filename", "importedAt", "metadataJson"->>'transform' AS "transform"
    FROM "SourceDataset" ORDER BY "id"`;
}
async function delta(tx, beforeText, expected) {
  const [result] = await tx.$queryRaw`WITH old AS (SELECT value AS row FROM jsonb_array_elements(${beforeText}::jsonb)),
    expected AS (SELECT value AS row FROM jsonb_array_elements(${JSON.stringify(expected)}::jsonb))
    SELECT count(*) FILTER (WHERE o.row IS NULL)::int AS "inserted",
      count(*) FILTER (WHERE o.row IS NOT NULL AND e.row IS NOT NULL AND o.row->'value' IS DISTINCT FROM e.row->'value')::int AS "changed",
      count(*) FILTER (WHERE o.row IS NOT NULL AND e.row IS NOT NULL AND o.row->'value' IS NOT DISTINCT FROM e.row->'value')::int AS "unchanged",
      count(*) FILTER (WHERE e.row IS NULL)::int AS "deleted",
      COALESCE(jsonb_agg(o.row->>'id') FILTER (WHERE e.row IS NULL), '[]'::jsonb)::text AS "deleteIds"
    FROM old o FULL OUTER JOIN expected e ON o.row->>'userId' = e.row->>'userId' AND o.row->>'date' = e.row->>'date'`;
  const { deleteIds, ...counts } = result;
  return { counts, deleteIds: JSON.parse(deleteIds) };
}
async function verifyStudentSources(tx, datasetId, expectedRows) {
  const [result] = await tx.$queryRaw`WITH expected AS (SELECT value AS row FROM jsonb_array_elements(${JSON.stringify(expectedRows)}::jsonb))
    SELECT count(*)::int AS "expected", count(*) FILTER (WHERE s."id" IS NULL OR s."rosterJson" IS DISTINCT FROM e.row->'rosterJson'
      OR s."fitnessJson" IS DISTINCT FROM e.row->'fitnessJson' OR s."metadataJson" IS DISTINCT FROM e.row->'metadataJson')::int AS "mismatches"
    FROM expected e LEFT JOIN "StudentSource" s ON s."datasetId" = ${datasetId} AND s."userId" = e.row->>'userId'`;
  assert.equal(result.expected, expectedRows.length, 'Student source verification count differs');
  assert.equal(result.mismatches, 0, 'Student source archive differs; no data will be overwritten');
  assert.equal(await tx.studentSource.count({ where: { datasetId } }), expectedRows.length, 'Unexpected student source row count');
}
async function verifyRecords(tx, datasetId, expected, challengeId) {
  const [result] = await tx.$queryRaw`WITH expected AS (SELECT value AS row FROM jsonb_array_elements(${JSON.stringify(expected)}::jsonb))
    SELECT count(*)::int AS "expected", count(*) FILTER (WHERE r."id" IS NULL OR r."sourceDatasetId" IS DISTINCT FROM ${datasetId}
      OR r."value" IS DISTINCT FROM e.row->'value' OR r."sourceMetadata" IS DISTINCT FROM e.row->'sourceMetadata')::int AS "mismatches"
    FROM expected e LEFT JOIN "DailyRecord" r ON r."challengeId" = ${challengeId} AND r."userId" = e.row->>'userId' AND r."date" = e.row->>'date'`;
  assert.equal(result.expected, expected.length, 'Record verification count differs');
  assert.equal(result.mismatches, 0, 'Current records differ from the revision; no data will be overwritten');
  assert.equal(await tx.dailyRecord.count({ where: { challengeId } }), expected.length, 'Unexpected current record count');
}
async function verifySaved(tx, datasetId, source, prepared, expected, rows, challengeId) {
  const [saved] = await tx.$queryRaw`SELECT "filename" = ${source.filename} AS "filenameExact",
      ("metadataJson" - 'revision') = ${JSON.stringify(baseMetadata(source, prepared))}::jsonb AS "sourceExact",
      (("metadataJson"->'revision') - 'previousRecords')::text AS "revision",
      ("metadataJson"->'revision'->'previousRecords')::text AS "before"
    FROM "SourceDataset" WHERE "id" = ${datasetId} AND "hash" = ${source.sha256}`;
  assert(saved?.filenameExact && saved.sourceExact, 'Existing source archive differs; no data will be overwritten');
  assert(saved.revision && saved.before, 'Revision archive is incomplete');
  const revision = JSON.parse(saved.revision);
  assert.equal(sha256(saved.before), revision.previousRecordsSha256, 'Previous record archive fingerprint differs');
  assert.deepEqual((await delta(tx, saved.before, expected)).counts, revision.operations, 'Revision operation archive differs');
  await verifyStudentSources(tx, datasetId, rows);
  await verifyRecords(tx, datasetId, expected, challengeId);
  assert.equal(sha256(await recordSnapshot(tx, challengeId, revision.recordSnapshotVersion === undefined)), revision.afterRecordsSha256, 'Records were modified after the revision; no data will be overwritten');
  return { sourceArchiveExact: true, previousRecordsArchiveExact: true, studentSourceRowsExact: true, recordValuesAndProvenanceExact: true, operations: revision.operations };
}

async function checkBackupState(tx, backup, records, sources) {
  if (!backup) return;
  const [database] = await tx.$queryRaw`SELECT current_database() AS "name"`;
  assert.equal(database.name, backup.database, 'Backup belongs to a different database');
  assert.equal(await tx.user.count(), backup.users, 'Account count changed since backup');
  assert.equal(records.length, backup.records, 'Record count changed since backup');
  assert.deepEqual(sources.map(source => source.hash).sort(), [...backup.sourceDatasetHashes].sort(), 'Sources changed since backup');
  assert.deepEqual(backup.protectedRelations, { corrections: 0, revisions: 0, attachments: 0 }, 'Backup contains protected record relationships');
}

/** No account writes. Default is a read-only plan; only explicit apply:true changes records. */
export async function importRevisedParticipationData(db, source, { apply = false, backup = null } = {}) {
  const prepared = buildRevisedParticipationData(source);
  assert.equal(prepared.students.length, 194, 'This revision must contain exactly the 194 existing students');
  return db.$transaction(async tx => {
    if (!apply) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    else {
      // Lock before reading: no concurrent account, date, correction, or attachment
      // insertion can slip between validation and replacement. Readers remain allowed.
      await tx.$executeRawUnsafe('LOCK TABLE "User", "Session" IN SHARE MODE');
      await tx.$executeRawUnsafe('LOCK TABLE "DailyRecord", "RecordRevision", "Correction", "Attachment", "SourceDataset", "StudentSource", "ChallengeMembership" IN SHARE ROW EXCLUSIVE MODE');
    }
    const challengeId = await legacyChallengeId(tx);
    const users = await tx.user.findMany({ where: { role: 'student' },
      select: { id: true, studentNumber: true, name: true, grade: true, classNumber: true, targetType: true, participating: true } });
    assert.equal(users.length, prepared.students.length, 'The complete database student roster differs; no accounts will be created or changed');
    const byNumber = new Map(users.map(user => [user.studentNumber, user]));
    for (const student of prepared.students) {
      const user = byNumber.get(student.studentNumber);
      assert(user && user.name === student.name && user.grade === student.grade && user.classNumber === student.classNumber
        && user.targetType === student.targetType && user.participating === student.participating,
      'Existing student identity or participation differs from the workbook');
    }
    await ensureLegacyMemberships(tx, users.map(user => ({ ...user, role: 'student' })), { apply: false });
    const ids = new Map(users.map(user => [user.studentNumber, user.id]));
    const expected = prepared.records.map(record => ({ challengeId, userId: ids.get(record.studentNumber), date: record.date, value: record.value, sourceMetadata: record.sourceMetadata }));
    const rows = sourceRows(prepared, ids), mode = apply ? 'apply' : 'dry-run';
    const existing = await tx.sourceDataset.findUnique({ where: { hash: source.sha256 }, select: { id: true } });
    if (existing) {
      await ensureLegacyMemberships(tx, users.map(user => ({ ...user, role: 'student' })), { apply: false, requireExisting: true });
      return { mode, alreadyImported: true, changed: false, datasetId: existing.id, ...prepared.summary,
        ...await verifySaved(tx, existing.id, source, prepared, expected, rows, challengeId) };
    }

    const beforeText = await recordSnapshot(tx, challengeId), before = JSON.parse(beforeText), sources = await previousSources(tx);
    assert(before.length > 0, 'No prior imported records exist; this script only revises an existing import');
    const knownSources = new Set(sources.filter(item => PREVIOUS_TRANSFORMS.has(item.transform)).map(item => item.id));
    const studentIds = new Set(users.map(user => user.id)), dates = new Set(prepared.summary.dates);
    assert(before.every(record => studentIds.has(record.userId) && dates.has(record.date)), 'Records outside this roster or the approved twelve weeks exist');
    assert(before.every(record => knownSources.has(record.sourceDatasetId) && record.sourceMetadata !== null), 'An existing record has an unrecognized import source');
    assert(before.every(record => record.version === 1 && record.createdAt === record.updatedAt), 'An existing record was edited; revision stopped without overwriting it');
    const [relations] = await tx.$queryRaw`SELECT (SELECT count(*)::int FROM "Correction" x JOIN "DailyRecord" r ON r."id" = x."recordId" WHERE r."challengeId" = ${challengeId}) AS "corrections",
      (SELECT count(*)::int FROM "RecordRevision" x JOIN "DailyRecord" r ON r."id" = x."recordId" WHERE r."challengeId" = ${challengeId}) AS "revisions",
      (SELECT count(*)::int FROM "Attachment" x JOIN "DailyRecord" r ON r."id" = x."recordId" WHERE r."challengeId" = ${challengeId}) AS "attachments"`;
    assert.deepEqual(relations, { corrections: 0, revisions: 0, attachments: 0 }, 'Corrections, revisions, or attachments exist; revision stopped without deleting them');
    await checkBackupState(tx, backup, before, sources);
    const operations = await delta(tx, beforeText, expected);
    const plan = { mode, sourceHash: source.sha256, ...prepared.summary, operations: operations.counts,
      existingAccountsMatched: users.length, recordsBefore: before.length, expectedRecordsAfter: expected.length,
      accountsCreated: 0, passwordsChanged: 0, sessionsChanged: 0, previousSourceRowsChanged: 0 };
    if (!apply) return { ...plan, changed: false, readyToApply: true };

    await ensureLegacyMemberships(tx, users.map(user => ({ ...user, role: 'student' })));
    const datasetId = randomUUID(), importedAt = new Date();
    const metadata = { ...baseMetadata(source, prepared), revision: {
      recordSnapshotVersion: 2, previousSources: sources, previousRecordsSha256: sha256(beforeText), operations: operations.counts, appliedAt: importedAt.toISOString(),
    } };
    await tx.$executeRaw`INSERT INTO "SourceDataset" ("id", "hash", "filename", "metadataJson", "importedAt")
      VALUES (${datasetId}, ${source.sha256}, ${source.filename},
        jsonb_set(${JSON.stringify(metadata)}::jsonb, '{revision,previousRecords}', ${beforeText}::jsonb), ${importedAt})`;
    const insertRows = rows.map(row => ({ id: randomUUID(), ...row }));
    await tx.$executeRaw`INSERT INTO "StudentSource" ("id", "datasetId", "userId", "rosterJson", "fitnessJson", "metadataJson")
      SELECT row->>'id', ${datasetId}, row->>'userId', row->'rosterJson', row->'fitnessJson', row->'metadataJson'
      FROM jsonb_array_elements(${JSON.stringify(insertRows)}::jsonb) AS source(row)`;
    if (operations.deleteIds.length) {
      const deleted = await tx.dailyRecord.deleteMany({ where: { id: { in: operations.deleteIds } } });
      assert.equal(deleted.count, operations.counts.deleted, 'Unexpected deleted record count');
    }
    for (let offset = 0; offset < expected.length; offset += 500) {
      const batch = expected.slice(offset, offset + 500).map(record => ({ id: randomUUID(), ...record }));
      await tx.$executeRaw`INSERT INTO "DailyRecord" ("id", "challengeId", "userId", "date", "value", "version", "createdAt", "updatedAt", "sourceDatasetId", "sourceMetadata")
        SELECT row->>'id', ${challengeId}, row->>'userId', row->>'date', row->'value', 1, ${importedAt}, ${importedAt}, ${datasetId}, row->'sourceMetadata'
        FROM jsonb_array_elements(${JSON.stringify(batch)}::jsonb) AS source(row)
        ON CONFLICT ("challengeId", "userId", "date") DO UPDATE SET "value" = EXCLUDED."value", "sourceDatasetId" = EXCLUDED."sourceDatasetId",
          "sourceMetadata" = EXCLUDED."sourceMetadata",
          "version" = CASE WHEN "DailyRecord"."value" IS DISTINCT FROM EXCLUDED."value" THEN "DailyRecord"."version" + 1 ELSE "DailyRecord"."version" END,
          "updatedAt" = CASE WHEN "DailyRecord"."value" IS DISTINCT FROM EXCLUDED."value" THEN EXCLUDED."updatedAt" ELSE "DailyRecord"."updatedAt" END`;
    }
    const afterHash = sha256(await recordSnapshot(tx, challengeId));
    await tx.$executeRaw`UPDATE "SourceDataset" SET "metadataJson" = jsonb_set("metadataJson", '{revision,afterRecordsSha256}', to_jsonb(${afterHash}::text)) WHERE "id" = ${datasetId}`;
    const verification = await verifySaved(tx, datasetId, source, prepared, expected, rows, challengeId);
    return { ...plan, changed: true, datasetId, importedAt: importedAt.toISOString(), ...verification };
  }, { isolationLevel: apply ? 'Serializable' : 'RepeatableRead', timeout: 120000, maxWait: 10000 });
}

async function main() {
  const [sourcePath, ...flags] = process.argv.slice(2);
  assert(sourcePath && flags.every(flag => ['--apply', '--dry-run'].includes(flag)) && new Set(flags).size === flags.length && !(flags.includes('--apply') && flags.includes('--dry-run')),
    'Usage: node --env-file=.env scripts/import-revised-participation.js source.json [--dry-run | --apply]');
  const actualSource = await fs.realpath(path.resolve(sourcePath)), directory = path.dirname(actualSource);
  const importRoot = await fs.realpath(fileURLToPath(new URL('../../.local/imports', import.meta.url)));
  const relative = path.relative(importRoot, directory);
  assert(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), 'Use a private project .local/imports directory');
  const source = JSON.parse(await fs.readFile(actualSource, 'utf8'));
  assert.equal(sha256(await fs.readFile(path.join(directory, 'source.xlsx'))), source.sha256, 'Source workbook fingerprint mismatch');
  let backup = null;
  if (flags.includes('--apply')) {
    backup = JSON.parse(await fs.readFile(path.join(directory, 'backup-manifest.json'), 'utf8'));
    assert.equal(backup.backupFile, 'before-revision.dump', 'Unexpected backup filename');
    assert.equal(sha256(await fs.readFile(path.join(directory, backup.backupFile))), backup.backupSha256, 'Database backup fingerprint mismatch');
    assert((await fs.stat(path.join(directory, backup.backupFile))).size > 0, 'Database backup is empty');
  }
  const db = new PrismaClient();
  try { console.log(JSON.stringify(await importRevisedParticipationData(db, source, { apply: flags.includes('--apply'), backup }))); }
  finally { await db.$disconnect(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Prisma errors can contain bound source rows, so only expose their code.
    console.error(error.code ? `Participation revision failed (${error.code}); no private data is logged.` : error.message);
    process.exitCode = 1;
  });
}
