import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'vite';
import { createApp } from '../../server/app';

/**
 * Browser checks of pet expression frames against an isolated demo backend.
 * Covers the web preview only (in-app reminders); Electron system notifications and IPC need the desktop check.
 * PLAYWRIGHT_MODULE_PATH may point to a playwright(-core) install outside the repo.
 */
const root = resolve(import.meta.dirname, '../..');
mkdirSync(join(root, 'work'), { recursive: true });
const output = mkdtempSync(join(root, 'work/pet-expressions-'));
const dataDir = join(output, 'data');
const service = createApp({ root, dataDir });
service.config.update({ runtime: 'demo', defaultExecutor: 'demo' });
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

  await page.goto(`${vite.resolvedUrls!.local[0]}?pet=idle`);
  await page.waitForFunction((id:string)=>document.querySelector('.sprite')?.getAttribute('data-sprite')===id, 'blink-1', {polling:'raf',timeout:15000});
  await page.waitForFunction((id:string)=>document.querySelector('.sprite')?.getAttribute('data-sprite')===id, 'blink-3', {polling:'raf',timeout:15000});
  step('idle blink reaches closed eyes');
  await page.screenshot({path:join(output,'blink.png')});
  await page.goto(`${vite.resolvedUrls!.local[0]}?pet=thinking`);
  await page.waitForFunction((id:string)=>document.querySelector('.sprite')?.getAttribute('data-sprite')===id, 'think-1', {polling:'raf',timeout:15000});
  await page.waitForFunction((id:string)=>document.querySelector('.sprite')?.getAttribute('data-sprite')===id, 'think-3', {polling:'raf',timeout:15000});
  await page.screenshot({path:join(output,'think.png')});
  step('thinking cycles through supplied frames');
  await page.goto(`${vite.resolvedUrls!.local[0]}?pet=idle&panel=chat`);
  await page.waitForFunction((id:string)=>document.querySelector('.sprite')?.getAttribute('data-sprite')===id, 'nod-3', {polling:'raf',timeout:15000});
  step('opening conversation nods');
  await page.screenshot({path:join(output,'nod.png')});
  await page.goto(`${vite.resolvedUrls!.local[0]}?pet=sleeping`);
  await page.waitForFunction((id:string)=>document.querySelector('.sprite')?.getAttribute('data-sprite')===id, 'blink-3', {polling:'raf',timeout:15000});
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.sprite').getAttribute('data-sprite'),'blink-3');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(`${vite.resolvedUrls!.local[0]}?pet=thinking`);
  await page.waitForFunction((id:string)=>document.querySelector('.sprite')?.getAttribute('data-sprite')===id, 'think-1', {polling:'raf',timeout:15000});
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.sprite').getAttribute('data-sprite'),'think-1');
  step('sleeping uses closed eyes; reduced motion holds one thinking frame');
  const mask = await page.evaluate(async()=>{
    const {hitSprite,loadMasks}=await import(/* @vite-ignore */ '/src/pet/' + 'sprites.ts');
    loadMasks();await new Promise(r=>setTimeout(r,300));
    return {corner:hitSprite('think-1',0,0),body:hitSprite('think-1',0.5,0.6)};
  });
  assert.equal(mask.corner,false);assert.equal(mask.body,true);
  assert.deepEqual(errors,[]);
  console.log(`Pet expressions passed. Screenshots: ${output}`);
} finally {
  await browser?.close();await vite?.close();await service.close();backend.close();
}
