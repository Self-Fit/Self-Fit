import JSZip from 'jszip';
import { SaxesParser } from 'saxes';

const spreadsheetNamespace='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipNamespace='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escapeText=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const escapeAttribute=value=>escapeText(value).replaceAll('"','&quot;').replaceAll('\r','&#13;').replaceAll('\n','&#10;').replaceAll('\t','&#9;');

// ExcelJS matches literal element names. Equivalent prefixed SpreadsheetML
// (e.g. <x:workbook>) must use the default namespace before it can be read.
// Parse XML, rather than replacing strings, so cell text and formulas survive.
export function normalizeSpreadsheetXml(xml) {
  const parser=new SaxesParser({xmlns:true});
  const output=[];
  const defaults=[];
  const name=tag=>tag.uri===spreadsheetNamespace?tag.local:tag.name;
  parser.on('doctype',()=>{throw new Error('DOCTYPE is not supported in XLSX');});
  parser.on('opentag',tag=>{
    const attributes=Object.values(tag.attributes).filter(attr=>!(tag.uri===spreadsheetNamespace&&attr.name==='xmlns'));
    const parts=attributes.map(attr=>`${attr.uri===relationshipNamespace?'r:'+attr.local:attr.name}="${escapeAttribute(attr.value)}"`);
    let defaultNamespace=attributes.find(attr=>attr.name==='xmlns')?.value??defaults.at(-1)??'';
    if(tag.uri===spreadsheetNamespace&&defaultNamespace!==spreadsheetNamespace){parts.push(`xmlns="${spreadsheetNamespace}"`);defaultNamespace=spreadsheetNamespace;}
    defaults.push(defaultNamespace);
    if(attributes.some(attr=>attr.uri===relationshipNamespace)&&!attributes.some(attr=>attr.name==='xmlns:r'))parts.push(`xmlns:r="${relationshipNamespace}"`);
    output.push(`<${name(tag)}${parts.length?' '+parts.join(' '):''}>`);
  });
  parser.on('closetag',tag=>{output.push(`</${name(tag)}>`);defaults.pop();});
  parser.on('text',text=>output.push(escapeText(text)));
  parser.on('cdata',text=>output.push(escapeText(text)));
  parser.write(xml).close();
  return output.join('');
}

// Call only after validateXlsxArchive has bounded the decompressed input.
export async function normalizeSpreadsheetNamespaces(buffer) {
  const zip=await JSZip.loadAsync(buffer);
  let changed=false;
  for(const file of Object.values(zip.files)) {
    if(file.dir||!file.name.startsWith('xl/')||!file.name.endsWith('.xml'))continue;
    const xml=await file.async('string');
    if(!/xmlns:[\w.-]+=["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/.test(xml))continue;
    zip.file(file.name,normalizeSpreadsheetXml(xml));changed=true;
  }
  return changed?zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}):buffer;
}
