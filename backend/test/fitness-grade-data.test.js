import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { buildFitnessGradeData, existingFitnessForUser, FITNESS_HEADERS, readFitnessWorkbook } from '../scripts/fitness-grade-data.js';

export function fitnessFixture(count = 2) {
  return { sha256: 'a'.repeat(64), filename: 'TEST-ONLY-FITNESS.xlsx', sheetNames: ['2025 학생명단', '2026 학생명단', '분석 기준'], sheets: {
    '2025 학생명단': [[...FITNESS_HEADERS], ['4→3', 1, 1, 1, 'TEST HISTORICAL STUDENT', 32, 4, 45, 3, 13, 'TEST ONLY']],
    '2026 학생명단': [[...FITNESS_HEADERS], ...Array.from({ length: count }, (_, i) => [`4→${i % 2 ? 4 : 3}`, 1, 1, i + 1,
      `TEST STUDENT ${i + 1}`, 30 + i, 4, 45 + i, i % 2 ? 4 : 3, 15, 'TEST ONLY'])],
    '분석 기준': [['항목', '설명'], ['범위', 'TEST ONLY']],
  } };
}

test('fitness parser separates school year and fitness grade and archives historical rows without linking', () => {
  const source = fitnessFixture(), parsed = buildFitnessGradeData(source);
  assert.equal(parsed.students.length, 2);
  assert.equal(parsed.unlinked.length, 1);
  assert.equal(parsed.students[0].studentNumber, '10101');
  assert.equal(parsed.students[0].grade, 1);
  assert.equal(parsed.students[0].fitness.semester2.grade, 3);
  assert.equal(parsed.students[0].sourceRow, 2);
  assert.equal(parsed.unlinked[0].year, 2025);
  assert.equal(source.sheets['2025 학생명단'][1][4], 'TEST HISTORICAL STUDENT');
});

test('fitness parser rejects shifted headers, duplicate identifiers, formulas, blanks and invalid grades', () => {
  const mutate = change => { const source = fitnessFixture(); change(source); assert.throws(() => buildFitnessGradeData(source), error => error.code === 'FITNESS_IMPORT_INVALID'); };
  mutate(s => { s.sheets['2026 학생명단'][0][8] = '종목 등급'; });
  mutate(s => { s.sheets['2026 학생명단'][2][3] = 1; });
  mutate(s => { s.sheets['2026 학생명단'][1][8] = { formula: '3', result: 3 }; });
  mutate(s => { s.sheets['2026 학생명단'][1][8] = null; });
  mutate(s => { s.sheets['2026 학생명단'][1][8] = 6; });
  mutate(s => { s.sheets['2026 학생명단'][1][7] = -1; });
  mutate(s => { s.sheets['2026 학생명단'][1][4] = ''; });
  mutate(s => { s.sheets['2025 학생명단'][1][1] = 0; });
  mutate(s => { s.sheets['2026 학생명단'][1][9] = 999; });
});

test('ExcelJS extraction hashes original bytes, retains all sheets and literal zero values', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fitness-reader-'));
  try {
    const filename = path.join(directory, 'synthetic.xlsx'), workbook = new ExcelJS.Workbook();
    const source = fitnessFixture();
    for (const [name, rows] of Object.entries(source.sheets)) workbook.addWorksheet(name).addRows(rows);
    const archive = workbook.addWorksheet('원본 부가자료');
    archive.addRow(['zero', 0, false, { formula: '1+1', result: 2 }]);
    await workbook.xlsx.writeFile(filename);
    const before = await fs.readFile(filename), actual = await readFitnessWorkbook(filename);
    assert.equal(actual.sha256, createHash('sha256').update(before).digest('hex'));
    assert.equal(actual.filename, 'synthetic.xlsx');
    assert.deepEqual(actual.sheetNames, [...Object.keys(source.sheets), '원본 부가자료']);
    assert.deepEqual(actual.sheets['원본 부가자료'][0], ['zero', 0, false, { formula: '1+1', result: 2 }]);
    assert.equal(buildFitnessGradeData(actual).students.length, 2);
    assert.deepEqual(await fs.readFile(filename), before);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('existing fitness requires original period, identity, source coordinates and consistent semester evidence', () => {
  const user = { studentNumber: '10101', name: 'TEST STUDENT 1', grade: 1, classNumber: 1 };
  const rosterJson = Array(27).fill(null);
  Object.assign(rosterJson, { 0: user.studentNumber, 1: user.name, 2: 1, 3: 1, 6: 2026, 12: 30, 13: 4, 14: 45, 15: 3 });
  const source = { id: 'row', datasetId: 'original', rosterJson, metadataJson: { sourceSheet: '학생명단', sourceRow: 6 },
    fitnessJson: { semester1: { score: 30, grade: 4 }, semester2: { score: 45, grade: 3 } } };
  const transforms = new Map([['original', 'same-exercise-week-block-v1'], ['revised', 'twelve-week-participation-revision-v1']]);
  assert.equal(existingFitnessForUser(user, [source], transforms).sourceRow, 6);
  for (const alter of [s => { s.rosterJson[6] = 2025; }, s => { s.rosterJson[1] = 'DIFFERENT'; }, s => { s.metadataJson.sourceRow = null; }, s => { s.fitnessJson.semester2.grade = 2; }]) {
    const copy = structuredClone(source); alter(copy);
    assert.throws(() => existingFitnessForUser(user, [copy], transforms), error => error.code === 'FITNESS_IMPORT_INVALID');
  }
  const disagree = structuredClone(source); disagree.datasetId = 'revised'; disagree.fitnessJson.semester2.score += 1;
  assert.throws(() => existingFitnessForUser(user, [source, disagree], transforms), /학기 값이 다릅니다/);
  assert.throws(() => existingFitnessForUser(user, [], transforms), /최초 체력 원본/);
});
