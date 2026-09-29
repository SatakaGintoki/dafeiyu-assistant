import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { resolve } from 'node:path';

const desktop = resolve(import.meta.dirname, '..');
const backend = spawn(process.execPath, ['../node_modules/tsx/dist/cli.mjs', 'scripts/smoke-backend.ts'], {
  cwd: desktop, stdio: ['pipe', 'pipe', 'inherit'],
});
const backendExit = once(backend, 'exit');
let electron;
try {
  const ready = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Test backend startup timed out')), 15000);
    const lines = createInterface({ input: backend.stdout });
    lines.on('line', line => {
      try {
        const value = JSON.parse(line);
        if (value.url && value.dataDir) { clearTimeout(timer); resolveReady(value); }
      } catch { /* startup logs */ }
    });
    backend.once('error', error => { clearTimeout(timer); reject(error); });
    backend.once('exit', () => { clearTimeout(timer); reject(new Error('Test backend exited')); });
  });
  const { url, dataDir } = await ready;
  const env = { ...process.env, DAYU_BACKEND_URL: url, DAYU_DATA_DIR: dataDir, DAYU_SMOKE_ONLINE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.DAYU_API_TOKEN;
  delete env.VITE_DEV_URL;
  electron = spawn(process.execPath, ['node_modules/electron/cli.js', 'scripts/smoke.cjs'], { cwd: desktop, env, stdio: 'inherit' });
  const [code] = await once(electron, 'exit');
  process.exitCode = code ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (backend.exitCode === null) backend.stdin.end('stop\n');
  await backendExit;
}
