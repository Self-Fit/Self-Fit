import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import ExcelJS from 'exceljs';

export const FITNESS_GRADE_TRANSFORM = 'semester-fitness-grades-v1';
export const FITNESS_YEAR = 2026;
export const FITNESS_HEADERS = ['등급변화', '학년', '반', '번호', '성명', '1학기 점수', '1학기 등급', '2학기 점수', '2학기 등급', '점수 증감', '비고'];
const originalTransform = 'same-exercise-week-block-v1';
const knownTransforms = new Set([originalTransform, 'week12-dumbbell-sets-v1', 'twelve-week-participation-revision-v1', FITNESS_GRADE_TRANSFORM]);
const blank = value => value === null || value === undefined || value === '';
export const normalizedName = value => typeof value === 'string' ? value.normalize('NFC').trim() : '';

// Messages contain sheet/row references only, never names, grades or credentials.
export function fitnessCheck(condition, message) {
  if (!condition) { const error = new Error(message); error.code = 'FITNESS_IMPORT_INVALID'; throw error; }
}

export function validateFitness(fitness, context) {
  fitnessCheck(fitness && typeof fitness === 'object', `${context}: 체력 자료가 없어요.`);
  for (const semester of [1, 2]) {
    const value = fitness[`semester${semester}`];
    fitnessCheck(value && Number.isInteger(value.grade) && value.grade >= 1 && value.grade <= 5, `${context}: 학기 등급을 확인해 주세요.`);
    fitnessCheck(typeof value.score === 'number' && Number.isFinite(value.score) && value.score >= 0, `${context}: 학기 점수를 확인해 주세요.`);
  }
  return { semester1: { ...fitness.semester1 }, semester2: { ...fitness.semester2 } };
}

export async function readFitnessWorkbook(filename) {
  const bytes = await fs.readFile(filename);
  fitnessCheck(bytes.length > 0 && bytes.length <= 20 * 1024 * 1024, '원본 엑셀 크기를 확인해 주세요.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheets = {}, sheetNames = [];
  for (const sheet of workbook.worksheets) {
    fitnessCheck(sheet.rowCount <= 20_000 && sheet.columnCount <= 200, '원본 엑셀의 행·열 범위를 확인해 주세요.');
    sheetNames.push(sheet.name);
    sheets[sheet.name] = Array.from({ length: sheet.rowCount }, (_, index) =>
      Array.from({ length: sheet.columnCount }, (_, column) => {
        const value = sheet.getRow(index + 1).getCell(column + 1).value;
        // Preserve formula objects and rich text in the private source archive.
        // Required import cells are validated as literal strings/numbers below.
        return value === undefined ? null : JSON.parse(JSON.stringify(value));
      }));
  }
  return { sha256: createHash('sha256').update(bytes).digest('hex'), filename: path.basename(filename), sheetNames, sheets };
}

export function buildFitnessGradeData(source) {
  fitnessCheck(source && /^[a-f0-9]{64}$/.test(source.sha256) && typeof source.filename === 'string' && source.filename,
    '원본 파일 지문과 이름을 확인해 주세요.');
  fitnessCheck(source.sheets && typeof source.sheets === 'object' && !Array.isArray(source.sheets), '원본 시트 자료가 없어요.');
  const rows = new Map();
  for (const year of [2025, FITNESS_YEAR]) {
    const sheetName = `${year} 학생명단`, sheet = source.sheets[sheetName];
    fitnessCheck(Array.isArray(sheet) && isDeepStrictEqual(sheet[0], FITNESS_HEADERS), `${sheetName}: 헤더가 다릅니다.`);
    const seen = new Set(), students = [];
    for (let index = 1; index < sheet.length; index++) {
      const row = sheet[index], context = `${sheetName} ${index + 1}행`;
      fitnessCheck(Array.isArray(row), `${context}: 행 형식이 잘못됐어요.`);
      if (row.every(blank)) continue;
      fitnessCheck(row.length === FITNESS_HEADERS.length, `${context}: 열 수가 다릅니다.`);
      const [, grade, classNumber, number, rawName, score1, level1, score2, level2, delta] = row;
      fitnessCheck(Number.isInteger(grade) && grade >= 1 && grade <= 9
        && Number.isInteger(classNumber) && classNumber >= 1 && classNumber <= 99
        && Number.isInteger(number) && number >= 1 && number <= 99 && normalizedName(rawName), `${context}: 학생 식별 정보를 확인해 주세요.`);
      const studentNumber = `${grade}${String(classNumber).padStart(2, '0')}${String(number).padStart(2, '0')}`;
      fitnessCheck(!seen.has(studentNumber), `${context}: 같은 학년·반·번호가 중복됐어요.`);
      seen.add(studentNumber);
      const fitness = validateFitness({ semester1: { score: score1, grade: level1 }, semester2: { score: score2, grade: level2 } }, context);
      fitnessCheck(row[0] === `${level1}→${level2}` && typeof delta === 'number' && Math.abs(delta - (score2 - score1)) < 1e-8,
        `${context}: 등급 변화 또는 점수 증감이 원본 값과 다릅니다.`);
      students.push({ year, studentNumber, name: normalizedName(rawName), grade, classNumber, fitness, sourceSheet: sheetName, sourceRow: index + 1, rosterRow: row });
    }
    rows.set(year, students);
  }
  fitnessCheck(rows.get(FITNESS_YEAR).length > 0, '2026 학생명단이 비어 있어요.');
  return { students: rows.get(FITNESS_YEAR), unlinked: rows.get(2025), summary: {
    linkedYear: FITNESS_YEAR, sourceStudents: rows.get(FITNESS_YEAR).length,
    unlinkedYear: 2025, unlinkedSourceRows: rows.get(2025).length,
    sourceSheets: Object.keys(source.sheets).length,
  } };
}

/** The original roster explicitly states 2026 and contains both semester values. */
export function existingFitnessForUser(user, sourceRows, transforms) {
  const anchors = sourceRows.filter(row => transforms.get(row.datasetId) === originalTransform);
  fitnessCheck(anchors.length === 1, '기존 학생의 최초 체력 원본을 하나로 확인할 수 없어요.');
  const anchor = anchors[0], row = anchor.rosterJson, meta = anchor.metadataJson;
  fitnessCheck(Array.isArray(row) && row.length === 27 && row[6] === FITNESS_YEAR
    && String(row[0]) === user.studentNumber && normalizedName(row[1]) === normalizedName(user.name)
    && row[2] === user.grade && row[3] === user.classNumber, '기존 체력 원본의 학년도 또는 학생 식별 정보가 다릅니다.');
  fitnessCheck(meta?.sourceSheet === '학생명단' && Number.isInteger(meta.sourceRow) && meta.sourceRow >= 2,
    '기존 체력 원본의 시트·행 위치가 없어요.');
  const fitness = validateFitness(anchor.fitnessJson, '기존 체력 원본');
  fitnessCheck(isDeepStrictEqual(fitness, { semester1: { score: row[12], grade: row[13] }, semester2: { score: row[14], grade: row[15] } }),
    '기존 체력 원본 행과 보존된 학기 값이 다릅니다.');
  for (const other of sourceRows.filter(item => item.fitnessJson !== null)) {
    fitnessCheck(knownTransforms.has(transforms.get(other.datasetId)), '확인되지 않은 체력 원본 형식이 있어요.');
    fitnessCheck(isDeepStrictEqual(validateFitness(other.fitnessJson, '기존 체력 원본'), fitness), '기존 체력 원본 사이에 학기 값이 다릅니다.');
  }
  return { fitness, sourceStudentSourceId: anchor.id, sourceDatasetId: anchor.datasetId, sourceSheet: meta.sourceSheet, sourceRow: meta.sourceRow };
}
