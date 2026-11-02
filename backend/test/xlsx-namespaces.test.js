import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { normalizeSpreadsheetNamespaces,normalizeSpreadsheetXml } from '../src/xlsx-namespaces.js';
import { validateXlsxArchive } from '../src/xlsx-safety.js';
import { prefixedRoster } from './prefixed-roster-fixture.js';

test('prefixed SpreadsheetML retains identity, text, and formula cell types',async()=>{
  const bytes=await prefixedRoster([['00123','이름 <x:t> & "확인"',1,9,'선택'],[{formula:'1+1',result:2},'수식',1,1,'필수']]);
  validateXlsxArchive(bytes);
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(await normalizeSpreadsheetNamespaces(bytes));
  const sheet=workbook.worksheets[0];
  assert.deepEqual(sheet.getRow(2).values.slice(1),['00123','이름 <x:t> & "확인"',1,9,'선택']);
  assert.equal(sheet.getCell('A3').type,ExcelJS.ValueType.Formula);
});

test('standard ExcelJS files are unchanged and XML entities are not expanded',async()=>{
  const workbook=new ExcelJS.Workbook();workbook.addWorksheet('명단').addRow(['값']);
  const buffer=Buffer.from(await workbook.xlsx.writeBuffer());
  assert.deepEqual(await normalizeSpreadsheetNamespaces(buffer),buffer);
  assert.throws(()=>normalizeSpreadsheetXml('<!DOCTYPE x [<!ENTITY e "value">]><x>&e;</x>'),/DOCTYPE/);
});
