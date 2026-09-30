import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudePermissionArgs, resolveExecutor } from '../server/executors';
import { settingsSchema } from '../server/config';
test('Claude full access is explicit and removes the file-only tool allowlist',()=>{
 assert.deepEqual(claudePermissionArgs(false),['--permission-mode','dontAsk','--allowedTools','Read,Edit,Write,Glob,Grep']);
 assert.deepEqual(claudePermissionArgs(true),['--permission-mode','bypassPermissions']);
 assert.equal(settingsSchema.parse({claudeFullAccess:true}).claudeFullAccess,true);
 assert.throws(()=>settingsSchema.parse({claudeFullAccess:'true'}));
});
