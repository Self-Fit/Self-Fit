import {initializePasswordVault} from '../src/password-vault-key.js';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {PrismaClient} from '@prisma/client';
import {verifyPassword} from '../src/password.js';
import {encryptTemporaryPassword} from '../src/temporary-passwords.js';
export async function recoverTemporaryPasswords(db,accounts,{apply=false}={}) {
  if(!Array.isArray(accounts))throw new Error('Expected an accounts array');
  const byNumber=new Map();
  for(const row of accounts){
    if(row.role!=='student')continue;
    if(typeof row.studentNumber!=='string'||typeof row.name!=='string'||typeof row.password!=='string'||byNumber.has(row.studentNumber))throw new Error('Invalid or duplicate source account');
    byNumber.set(row.studentNumber,row);
  }
  const students=await db.user.findMany({where:{role:'student'}}),eligible=[];
  let changed=0,alreadyStored=0,unavailable=0;
  for(const user of students){
    if(!user.mustChangePassword){changed++;continue;}
    if(user.temporaryPasswordCiphertext){alreadyStored++;continue;}
    const row=byNumber.get(user.studentNumber);
    if(!row||row.name!==user.name||!await verifyPassword(row.password,user.passwordHash)){unavailable++;continue;}
    eligible.push({user,ciphertext:encryptTemporaryPassword(row.password,user.passwordHash)});
  }
  let recovered=0;
  if(apply)recovered=await db.$transaction(async tx=>{
    let count=0;
    for(const {user,ciphertext} of eligible)count+=(await tx.user.updateMany({where:{id:user.id,passwordHash:user.passwordHash,mustChangePassword:true,temporaryPasswordCiphertext:null,updatedAt:user.updatedAt},data:{temporaryPasswordCiphertext:ciphertext,updatedAt:user.updatedAt}})).count;
    return count;
  },{timeout:30000});
  return {mode:apply?'apply':'dry-run',students:students.length,eligible:eligible.length,recovered,changed,alreadyStored,unavailable,passwordsChanged:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [file,...args]=process.argv.slice(2);
 if(!file||args.some(arg=>!['--apply','--dry-run'].includes(arg)))throw new Error('Usage: node --env-file=backend/.env backend/scripts/recover-temporary-passwords.js private-accounts.json [--apply]');
 await initializePasswordVault();
 const db=new PrismaClient();
 try{const source=JSON.parse(await fs.readFile(file,'utf8'));console.log(JSON.stringify(await recoverTemporaryPasswords(db,source.accounts,{apply:args.includes('--apply')})));}
 finally{await db.$disconnect();}
}
