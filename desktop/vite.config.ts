import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { proxyConfig } from './scripts/proxy-config';

// Browser development only: the dev server proxies to the local backend and adds the
// token server-side, so the token never reaches page code. Electron uses IPC instead.
const { backend, token } = proxyConfig(resolve(import.meta.dirname, '..'));

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    fs: { allow: [resolve(import.meta.dirname, '..')] },
    proxy: { '/api': { target: backend, configure(proxy) {
      proxy.on('proxyRes', (upstream, _request, response) => {
        // An interrupted SSE response must close downstream so the client can retry.
        upstream.on('aborted', () => response.destroy());
      });
      proxy.on('proxyReq', request => {
        const value = token();
        request.removeHeader('Authorization');
        if (value) request.setHeader('Authorization', `Bearer ${value}`);
      });
    } } },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome130', assetsInlineLimit: 0 },
});
