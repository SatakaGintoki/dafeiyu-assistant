import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

export function proxyConfig(root: string, env: NodeJS.ProcessEnv = process.env) {
  const dataDir = resolve(root, env.DAYU_DATA_DIR || '.data');
  let backend = env.DAYU_BACKEND_URL;
  if (!backend) {
    try { backend = JSON.parse(readFileSync(join(dataDir, 'connection.json'), 'utf8')).url; }
    catch { /* A backend that has not started yet uses the standard local port. */ }
  }
  const url = new URL(backend || 'http://127.0.0.1:4318');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('DAYU_BACKEND_URL must be a local HTTP origin');
  }
  if (env.DAYU_BACKEND_URL && !env.DAYU_DATA_DIR && !env.DAYU_TOKEN_FILE && !env.DAYU_API_TOKEN) {
    throw new Error('Custom backend requires DAYU_DATA_DIR, DAYU_TOKEN_FILE or DAYU_API_TOKEN');
  }
  const tokenFile = env.DAYU_TOKEN_FILE ? resolve(root, env.DAYU_TOKEN_FILE) : join(dataDir, 'api-token');
  return {
    backend: url.origin,
    token() {
      if (env.DAYU_API_TOKEN) return env.DAYU_API_TOKEN.trim();
      try { return readFileSync(tokenFile, 'utf8').trim(); } catch { return ''; }
    },
  };
}
