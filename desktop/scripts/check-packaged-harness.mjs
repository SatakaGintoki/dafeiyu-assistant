import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';

const resources = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true });
const home = mkdtempSync(join(output, 'packaged-harness-'));
const { DeepSeekHarness } = await import(pathToFileURL(join(resources, 'backend/node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js')).href);
const plugin = pathToFileURL(join(resources, 'backend/server/harness-plugin.mjs')).href;
const patch = join(home, 'butler.patch.yml');
writeFileSync(patch, ['persistent-bash','persistent-pwsh','terminal-bash','terminal-pwsh','pty','subprocess','mcp-resources'].map(id => `- id: ${id}\n  disabled: true`).join('\n') + `\n- insert:\n    - id: dayu-butler-tools\n      name: ${JSON.stringify(plugin)}\n`);
const harness = new DeepSeekHarness({ profile: 'sdk-minimal', dshHome: home, patches: [patch], processCwd: home,
  cwd: home, model: 'deepseek-flash', provider: 'deepseek-official', initializeTimeoutMs: 30000,
  env: { ...process.env, DEEPSEEK_API_KEY: 'test-key-no-network', DSH_SYSTEM_PROMPT: 'Initialize only, do not call models.' } });
try { await harness.start(); console.log('PASS: bundled Node, packaged Harness SDK and plugin initialized; no model request.'); }
finally { await harness.close(); }
