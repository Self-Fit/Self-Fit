import { inflateRawSync } from 'node:zlib';
import { ApiError,fail } from './errors.js';

// Inspect and bound real decompression before ExcelJS allocates workbook objects.
// Normal Excel-generated roster XLSX files use the ordinary single-disk ZIP layout.
export function validateXlsxArchive(buffer) {
  const limit=50*1024*1024;
  try {
    const end=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
    if(end<0||end+22>buffer.length||end+22+buffer.readUInt16LE(end+20)!==buffer.length) throw new Error('zip directory');
    const count=buffer.readUInt16LE(end+10), directorySize=buffer.readUInt32LE(end+12), directoryOffset=buffer.readUInt32LE(end+16);
    if(buffer.readUInt16LE(end+4)!==0||buffer.readUInt16LE(end+6)!==0||buffer.readUInt16LE(end+8)!==count||directoryOffset+directorySize!==end||count===0||count===65535) throw new Error('zip format');
    if(count>500) fail(413,'XLSX_TOO_COMPLEX','명단 파일의 구성 항목이 너무 많습니다. 제공된 명단 양식에 값을 복사해 주세요.');
    let cursor=directoryOffset,total=0;
    for(let index=0;index<count;index++) {
      if(cursor+46>end||buffer.readUInt32LE(cursor)!==0x02014b50) throw new Error('zip entry');
      const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),compressed=buffer.readUInt32LE(cursor+20),expanded=buffer.readUInt32LE(cursor+24);
      const nameLength=buffer.readUInt16LE(cursor+28),extraLength=buffer.readUInt16LE(cursor+30),commentLength=buffer.readUInt16LE(cursor+32),localOffset=buffer.readUInt32LE(cursor+42);
      if(flags&1||![0,8].includes(method)||localOffset+30>directoryOffset||buffer.readUInt32LE(localOffset)!==0x04034b50) throw new Error('zip entry format');
      total+=expanded;
      if(total>limit) fail(413,'XLSX_EXPANSION_LIMIT','압축을 푼 명단이 너무 큽니다. 파일을 나누거나 불필요한 시트·서식을 제거해 주세요.');
      const dataOffset=localOffset+30+buffer.readUInt16LE(localOffset+26)+buffer.readUInt16LE(localOffset+28);
      if(dataOffset+compressed>directoryOffset) throw new Error('zip entry bounds');
      const encoded=buffer.subarray(dataOffset,dataOffset+compressed);
      const decoded=method===0?encoded:inflateRawSync(encoded,{maxOutputLength:Math.max(1,limit-(total-expanded))});
      if(decoded.length!==expanded) throw new Error('zip size mismatch');
      cursor+=46+nameLength+extraLength+commentLength;
    }
    if(cursor!==end) throw new Error('zip directory size');
  } catch(error) {
    if(error instanceof ApiError) throw error;
    if(error.code==='ERR_BUFFER_TOO_LARGE') fail(413,'XLSX_EXPANSION_LIMIT','압축을 푼 명단이 너무 큽니다. 제공된 명단 양식에 필요한 값만 복사해 주세요.');
    fail(400,'INVALID_XLSX','표준 .xlsx 명단 파일을 읽을 수 없습니다. 제공된 명단 양식으로 다시 저장해 주세요.');
  }
}
