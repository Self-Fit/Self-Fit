import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const database = spawnSync(process.execPath, ['scripts/db.mjs', 'start'], { cwd: root, stdio: 'inherit' });
if (database.status !== 0) process.exit(database.status || 1);
const vault = spawnSync(process.execPath, ['scripts/setup-password-vault.mjs'], { cwd: root, stdio: 'inherit' });
if (vault.status !== 0) process.exit(vault.status || 1);
const ownProcessGroups = process.platform !== 'win32';
const childOptions = { cwd: root, stdio: 'inherit', detached: ownProcessGroups };
const children = [
  spawn('npm', ['run', 'dev', '--workspace', 'backend'], childOptions),
  spawn('npm', ['run', 'dev', '--workspace', 'frontend'], childOptions),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    try { ownProcessGroups ? process.kill(-child.pid, 'SIGTERM') : child.kill('SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') console.error(error.message); }
  }
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
}
