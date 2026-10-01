import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'vite';
import { createApp } from '../../server/app';
import { DirectRuntime } from '../../server/runtime';

const root = resolve(import.meta.dirname, '../..');
mkdirSync(join(root, 'work'), { recursive: true });
const output = mkdtempSync(join(root, 'work/chat-stream-'));
const dataDir = join(output, 'data');
let complete: (()=>void)|undefined;
const service = createApp({ root, dataDir, runtimeFactory:(config,store,tools)=>new DirectRuntime(config,store,tools,async(_url,init)=>{
  assert.equal(JSON.parse(init!.body as string).stream,true);
  const encoder=new TextEncoder();
  return new Response(new ReadableStream({start(controller){
    controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:'收到，我在。'}}]})+'\n\n'));
    complete=()=>{controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:'这就帮你整理。'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));controller.close();};
  },cancel(){complete=undefined;}}),{headers:{'Content-Type':'text/event-stream'}});
}) });
service.config.update({ runtime: 'deepseek', apiKey:'isolated-test-only', defaultExecutor: 'demo' });
const backend = service.app.listen(0, '127.0.0.1');
await once(backend, 'listening');
const url = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
service.setInternalUrl(url);
service.start();
writeFileSync(join(dataDir, 'connection.json'), JSON.stringify({ url }));
delete process.env.DAYU_API_TOKEN; delete process.env.DAYU_BACKEND_URL; delete process.env.DAYU_TOKEN_FILE;
process.env.DAYU_DATA_DIR = dataDir;

const tz = service.agenda.snapshot().preferences.timezone;
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: any;
const step = (text: string) => console.log(`✓ ${text}`);
try {
  const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
  const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
  vite = await createServer({ root: join(root, 'desktop'), configFile: join(root, 'desktop/vite.config.ts'), server: { port: 0, strictPort: false } });
  await vite.listen();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: tz });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error: Error) => errors.push(error.message));
  page.on('console', (msg: any) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (dialog: any) => void dialog.accept());

  await page.goto(vite.resolvedUrls!.local[0]+'?panel=chat');
  await page.locator('.composer textarea').fill('你好');
  await page.locator('.composer textarea').press('Enter');
  await page.locator('[aria-label="正在回复"]').filter({hasText:'收到，我在。'}).waitFor();
  assert.equal(service.store.messages().filter(m=>m.role==='assistant').length,0);
  await page.screenshot({path:join(output,'streaming.png')});
  step('partial answer is visible before backend completion');
  complete!();
  await page.locator('[aria-label="正在回复"]').waitFor({state:'detached'});
  await page.locator('.row.assistant .msg').filter({hasText:'收到，我在。这就帮你整理。'}).waitFor();
  assert.equal(await page.locator('.row.assistant').count(),1);
  await page.reload();
  await page.locator('.row.assistant .msg').filter({hasText:'收到，我在。这就帮你整理。'}).waitFor();
  assert.equal(await page.locator('.row.assistant').count(),1);
  step('completion and page reload show one durable answer');
  await page.locator('.composer textarea').fill('继续');
  await page.locator('.composer textarea').press('Enter');
  await page.locator('[aria-label="正在回复"]').filter({hasText:'收到，我在。'}).waitFor();
  await page.getByRole('button',{name:'停止',exact:true}).dispatchEvent('click');
  await page.getByRole('button',{name:'发送',exact:true}).waitFor();
  await page.locator('[aria-label="正在回复"]').waitFor({state:'detached'});
  step('stop removes the draft and returns the composer to send');
  const now=new Date().toISOString();
  const task={id:'permission-check',title:'权限测试任务',instruction:'test',executor:'claude' as const,model:'',workspace:root,status:'failed' as const,createdAt:now,updatedAt:now,result:'',error:'Claude Code permission denied for: Bash',logs:[]};
  service.store.put('task',task.id,task);service.emit('task.created',task);
  await page.getByRole('button',{name:'任务被权限拦截 · 查看任务',exact:true}).dispatchEvent('click');
  await page.locator('h5').filter({hasText:'需要处理执行器权限'}).waitFor();
  await page.getByRole('button',{name:'打开项目目录',exact:true}).waitFor();
  await page.screenshot({path:join(output,'permission.png')});
  step('permission status opens the failed task with specific recovery guidance');
  assert.deepEqual(errors,[]);
  console.log(`Chat streaming passed. Screenshots: ${output}`);
} finally {
  await browser?.close();await vite?.close();await service.close();backend.close();
}
