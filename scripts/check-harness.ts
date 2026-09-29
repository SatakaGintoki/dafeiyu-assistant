import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { writeHarnessPatch } from '../server/runtime';

const root=process.cwd();mkdirSync(resolve(root,'work'),{recursive:true});
const home=mkdtempSync(resolve(root,'work/harness-check-'));
const patch=writeHarnessPatch(home,resolve(root,'server/harness-plugin.mjs'));
const harness=new DeepSeekHarness({profile:'sdk-minimal',dshHome:home,patches:[patch],processCwd:root,cwd:root,model:'deepseek-v4-flash',provider:'deepseek-official',env:{...process.env,DEEPSEEK_API_KEY:'test-key-no-network',DSH_SYSTEM_PROMPT:'Test only; do not call a model.'},initializeTimeoutMs:30000});
try { await harness.start();console.log('PASS: real Harness SDK runtime initialized; no model request was made.'); }
finally { await harness.close(); }
