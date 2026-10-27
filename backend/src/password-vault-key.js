import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
const valid=key=>typeof key==='string'&&/^[a-fA-F0-9]{64}$/.test(key);
export async function initializePasswordVault({storageDir}={}) {
  if(process.env.TEMPORARY_PASSWORD_KEY){
    if(!valid(process.env.TEMPORARY_PASSWORD_KEY))throw new Error('Invalid temporary password key');
    return;
  }
  const storage=path.resolve(storageDir||process.env.STORAGE_DIR||fileURLToPath(new URL('../../.data/attachments',import.meta.url)));
  const file=process.env.TEMPORARY_PASSWORD_KEY_FILE||path.join(storage,'.secrets','temporary-password.key');
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  // Exclusive creation keeps the same key across restarts and concurrent startup.
  try{await fs.writeFile(file,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  const key=(await fs.readFile(file,'utf8')).trim();
  if(!valid(key))throw new Error('Invalid persisted temporary password key');
  await fs.chmod(file,0o600);
  process.env.TEMPORARY_PASSWORD_KEY=key;
}
