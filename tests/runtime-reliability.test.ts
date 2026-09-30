import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proxyUrl} from '../server/executor-proxy';
import {normalizeEvent} from '../server/executor-events';
test('system proxy parser handles Windows formats without accepting credentials or PAC URLs',()=>{
 assert.equal(proxyUrl('127.0.0.1:7890'),'http://127.0.0.1:7890');
 assert.equal(proxyUrl('http=127.0.0.1:80;https=127.0.0.1:7890'),'http://127.0.0.1:7890');
 for(const value of ['http://user:secret@localhost:80','https://example.com/proxy.pac','file:///tmp/a','socks=localhost:10'])assert.equal(proxyUrl(value),undefined);
});
test('Codex sandbox startup failure is a failure even if the agent later completes its reply',()=>{
 const update=normalizeEvent('codex',{type:'item.completed',item:{type:'command_execution',command:'node test.js',exit_code:-1,aggregated_output:'sandbox provisioning failed: helper_sandbox_lock_failed'}});
 assert.match(update.error || '',/沙箱初始化失败/);
});
