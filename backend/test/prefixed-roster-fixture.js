import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export async function prefixedRoster(rows) {
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('학생 명단');
  sheet.addRow(['학번','이름','학년','반','대상구분']);
  sheet.addRows(rows);
  const zip=await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  for(const file of Object.values(zip.files)) {
    if(!file.name.startsWith('xl/')||!file.name.endsWith('.xml'))continue;
    const xml=await file.async('string');
    if(!xml.includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'))continue;
    zip.file(file.name,xml.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"','xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"').replace(/<(\/?)([A-Za-z_][\w.-]*)(?=[\s/>])/g,'<$1x:$2'));
  }
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
