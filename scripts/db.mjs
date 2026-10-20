import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
const data = path.join(local, 'postgres');
const port = 55432;
const action = process.argv[2] || 'start';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw new Error(`${command} 실행 불가: PostgreSQL 도구를 설치하고 PATH를 확인하세요.`);
  if (result.status !== 0 && !options.allowFailure) throw new Error(result.stderr || result.stdout || `${command} 실패`);
  return result;
}
try {
  if (action === 'stop' || action === 'status') {
    if (!fs.existsSync(path.join(data, 'PG_VERSION'))) {
      console.log('Self-Fit 전용 DB가 아직 초기화되지 않았습니다.');
    } else {
      const result = run('pg_ctl', ['-D', data, ...(action === 'stop' ? ['stop', '-m', 'fast'] : ['status'])], { allowFailure: true });
      console.log(result.stdout.trim() || result.stderr.trim());
      process.exitCode = action === 'status' ? 0 : result.status;
    }
  } else if (action === 'start') {
    fs.mkdirSync(local, { recursive: true, mode: 0o700 });
    const passwordFile = path.join(local, 'db-password');
    if (!fs.existsSync(passwordFile)) fs.writeFileSync(passwordFile, randomBytes(32).toString('base64url'), { mode: 0o600 });
    const password = fs.readFileSync(passwordFile, 'utf8').trim();
    if (!fs.existsSync(path.join(data, 'PG_VERSION'))) {
      run('initdb', ['-D', data, '--username=self_fit', '--auth-local=trust', '--auth-host=scram-sha-256', `--pwfile=${passwordFile}`, '--encoding=UTF8', '--locale=C']);
      fs.appendFileSync(path.join(data, 'postgresql.conf'), `\n# Self-Fit local project only\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${local.replaceAll("'", "''")}'\nmax_connections = 40\ntimezone = 'Asia/Seoul'\n`);
    }
    const status = run('pg_ctl', ['-D', data, 'status'], { allowFailure: true });
    if (status.status !== 0) run('pg_ctl', ['-D', data, '-l', path.join(local, 'postgres.log'), '-w', 'start']);
    const env = { ...process.env, PGPASSWORD: password };
    for (const name of ['self_fit', 'self_fit_test']) {
      const exists = run('psql', ['-h', '127.0.0.1', '-p', String(port), '-U', 'self_fit', '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname = '${name}'`], { env }).stdout.trim();
      if (exists !== '1') run('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'self_fit', name], { env });
    }
    const envPath = path.join(root, 'backend', '.env');
    if (!fs.existsSync(envPath)) {
      const url = `postgresql://self_fit:${encodeURIComponent(password)}@127.0.0.1:${port}`;
      fs.writeFileSync(envPath, `DATABASE_URL=${url}/self_fit?schema=public\nTEST_DATABASE_URL=${url}/self_fit_test?schema=public\nPORT=4000\nHOST=127.0.0.1\nAPP_ORIGIN=http://localhost:5173,http://127.0.0.1:5173\nSTORAGE_DIR=${path.join(root, 'backend', 'storage')}\n`, { mode: 0o600 });
    }
    console.log(`Self-Fit 전용 PostgreSQL 실행됨 (127.0.0.1:${port}, self_fit / self_fit_test). 기존 DB와 분리되어 있습니다.`);
  } else throw new Error('사용법: node scripts/db.mjs start|stop|status');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
