import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Browser development only: the dev server proxies to the local backend and adds the
// token server-side, so the token never reaches page code. Electron uses IPC instead.
const backend = process.env.DAYU_BACKEND_URL || 'http://127.0.0.1:4318';
const tokenFile = process.env.DAYU_TOKEN_FILE || resolve(import.meta.dirname, '../.data/api-token');
function token() {
  if (process.env.DAYU_API_TOKEN) return process.env.DAYU_API_TOKEN;
  try { return existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : ''; }
  catch { return ''; }
}

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    fs: { allow: [resolve(import.meta.dirname, '..')] },
    proxy: { '/api': { target: backend, configure(proxy) {
      proxy.on('proxyReq', request => {
        const value = token();
        request.removeHeader('Authorization');
        if (value) request.setHeader('Authorization', `Bearer ${value}`);
      });
    } } },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome130', assetsInlineLimit: 0 },
});
