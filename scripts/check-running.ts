import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const dir=resolve(process.env.DAYU_DATA_DIR || '.data');
const url=`http://127.0.0.1:${process.env.DAYU_PORT || 4318}`;
const token=process.env.DAYU_API_TOKEN || readFileSync(join(dir,'api-token'),'utf8').trim();
const health=await fetch(url+'/health');assert.equal(health.status,200);
assert.equal((await fetch(url+'/api/v1/state')).status,401);
const response=await fetch(url+'/api/v1/state',{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200);
const state=await response.json();assert.ok(!JSON.stringify(state).includes(token));
console.log(JSON.stringify({health:'PASS',authentication:'PASS',runtime:state.settings.runtime,model:state.settings.model,hasApiKey:state.settings.hasApiKey,executors:state.executors.map((x:any)=>({id:x.id,available:x.available})),tasks:state.tasks.length},null,2));
