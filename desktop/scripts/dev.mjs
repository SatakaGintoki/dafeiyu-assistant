import { spawn } from 'node:child_process';
import { createServer } from 'vite';

// Vite serves the renderer with hot reload; Electron loads it via VITE_DEV_URL.
let server;
let child;
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  if (child && child.exitCode === null) child.kill();
  await server?.close();
  process.exitCode = code;
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
try {
  const electronPath = (await import('electron')).default;
  await import('./build-electron.mjs');
  server = await createServer();
  await server.listen();
  const url = server.resolvedUrls.local[0].replace(/\/$/, '');
  child = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_URL: url } });
  child.once('error', error => { console.error('桌宠启动失败：', error.message); void close(1); });
  child.once('close', code => void close(code ?? 0));
} catch (error) {
  console.error('桌宠启动失败：', error.message);
  console.error('若缺少 Electron，请在 desktop 目录运行 npm rebuild electron。');
  await close(1);
}
