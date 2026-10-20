import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('frontend/public/fonts');
await fs.mkdir(out,{recursive:true});
const root='https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/';
const weights=['Thin','ExtraLight','Light','Regular','Medium','SemiBold','Bold','ExtraBold','Black'];
await Promise.all(weights.map(async(name,index)=>{
  const response=await fetch(`${root}packages/pretendard/dist/web/static/woff2/Pretendard-${name}.woff2`);
  if(!response.ok)throw new Error(`Pretendard ${name}: HTTP ${response.status}`);
  await fs.writeFile(path.join(out,`Pretendard-${name}.woff2`),Buffer.from(await response.arrayBuffer()));
}));
const css='/* Pretendard v1.3.9 · Copyright Kil Hyung-jin · SIL Open Font License 1.1 */\n'+weights.map((name,index)=>`@font-face{font-family:'Pretendard';font-weight:${(index+1)*100};font-style:normal;font-display:swap;src:url('/fonts/Pretendard-${name}.woff2') format('woff2');}`).join('\n');
await fs.writeFile(path.join(out,'pretendard.css'),css+'\n');
const license=await fetch(`${root}LICENSE`);
if(license.ok)await fs.writeFile(path.join(out,'LICENSE'),await license.text());
console.log('Pretendard v1.3.9 9개 굵기 저장 완료');
