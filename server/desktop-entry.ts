import { createApp } from './app';
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

// The installed app owns this process; everything writable lives in userData.
const root = resolve(process.env.DAYU_USER_DATA!);
const service = createApp({ root, dataDir: join(root, 'data'), origins: [] });
const server = service.app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法分配本地端口');
  const url = `http://127.0.0.1:${address.port}`;
  service.setInternalUrl(url);
  service.start();
  writeFileSync(join(service.store.dir, 'connection.json'), JSON.stringify({ url }));
  process.send?.({ type: 'ready', url });
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await service.close();
  server.close(() => { if (process.connected) process.disconnect(); });
}
process.on('message', message => { if (message === 'shutdown') void close(); });
process.on('disconnect', () => void close());
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
server.on('error', async error => {
  process.send?.({ type: 'error', message: error.message });
  await close();
  process.exitCode = 1;
});
