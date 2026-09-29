import { createApp } from '../../server/app';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
mkdirSync(join(root, 'work'), { recursive: true });
const dataDir = mkdtempSync(join(root, 'work/desktop-backend-'));
const service = createApp({ root, dataDir });
service.config.update({ runtime: 'demo', defaultExecutor: 'demo' });
const server = service.app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const url = `http://127.0.0.1:${address.port}`;
  service.setInternalUrl(url);
  service.start();
  console.log(JSON.stringify({ url, dataDir }));
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await service.close();
  server.close();
  process.stdin.destroy();
}
process.stdin.resume();
process.stdin.once('data', () => void close());
process.stdin.once('end', () => void close());
process.on('SIGTERM', () => void close());
