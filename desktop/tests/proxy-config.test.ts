import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proxyConfig } from '../scripts/proxy-config';

test('isolated preview pairs connection and token, including token rotation', t => {
  const root = mkdtempSync(join(tmpdir(), 'dayu-proxy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.data'));
  writeFileSync(join(root, '.data/api-token'), 'real-token');
  mkdirSync(join(root, 'isolated'));
  writeFileSync(join(root, 'isolated/connection.json'), JSON.stringify({ url: 'http://127.0.0.1:4567' }));
  const file = join(root, 'isolated/api-token');
  writeFileSync(file, 'isolated-token');
  const config = proxyConfig(root, { DAYU_DATA_DIR: 'isolated' });
  assert.equal(config.backend, 'http://127.0.0.1:4567');
  assert.equal(config.token(), 'isolated-token');
  writeFileSync(file, 'rotated-token');
  assert.equal(config.token(), 'rotated-token');
  assert.throws(() => proxyConfig(root, { DAYU_BACKEND_URL: 'http://127.0.0.1:4567' }), /requires/);
  assert.equal(proxyConfig(root, { DAYU_DATA_DIR: 'isolated', DAYU_API_TOKEN: 'override' }).token(), 'override');
});

test('proxy never forwards the local token to a remote or credential-bearing URL', () => {
  for (const url of ['https://example.com', 'http://example.com', 'http://user:pass@localhost', 'http://localhost/path']) {
    assert.throws(() => proxyConfig('.', { DAYU_BACKEND_URL: url, DAYU_API_TOKEN: 'secret' }));
  }
});
