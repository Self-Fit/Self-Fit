import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('python3', [resolve(frontend, 'scripts/extract-design.py')], { cwd: frontend, stdio: 'inherit' });
