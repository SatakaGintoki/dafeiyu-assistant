import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'vite';
import { createApp } from '../../server/app';
import type { AgendaItem, AgendaPlan, AgendaProject } from '../../shared/agenda';

/**
 * Browser layout and flow check of the agenda tab against an isolated demo backend.
 * Covers the web preview only (in-app reminders); Electron system notifications and IPC need the desktop check.
 * PLAYWRIGHT_MODULE_PATH may point to a playwright(-core) install outside the repo.
 */
const root = resolve(import.meta.dirname, '../..');
mkdirSync(join(root, 'work'), { recursive: true });
const output = mkdtempSync(join(root, 'work/agenda-preview-'));
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

const agenda = service.agenda;
const mutate = <T>(op: string, input: unknown) => agenda.mutate(op, input) as T;
const snap = () => agenda.snapshot();
const tz = snap().preferences.timezone;
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
  const panel = page.locator('.panel-window');
  const sheet = page.locator('.sheet');
  // The preview draws the pet window over the panel's top-right corner (in Electron its transparent margin passes clicks through).
  const tap = (locator: any) => locator.dispatchEvent('click');
  await page.goto(`${vite.resolvedUrls!.local[0]}?panel=agenda`);
  await panel.getByText('今天很空闲').waitFor();
  await page.screenshot({ path: join(output, '01-empty.png') });
  step('empty today view');

  // 1. Projects and items via the UI.
  await panel.getByRole('button', { name: '项目', exact: true }).click();
  for (const name of ['生活', '个人网站']) {
    await panel.getByRole('button', { name: '新建项目' }).click();
    await sheet.getByLabel('名称').fill(name);
    await sheet.getByRole('button', { name: '保存' }).click();
    await sheet.waitFor({ state: 'detached' });
    await panel.locator('.ag-detail-head').getByText(name).waitFor();
    await panel.getByRole('button', { name: '返回项目列表' }).click();
  }
  await panel.locator('.ag-project', { hasText: '生活' }).click();
  await tap(panel.getByRole('button', { name: '在此项目新建' }));
  await sheet.getByLabel('标题').fill('交水电费');
  await sheet.getByRole('button', { name: '创建' }).click();
  await panel.locator('.ag-row', { hasText: '交水电费' }).waitFor();
  await panel.getByRole('button', { name: '返回项目列表' }).click();
  await tap(panel.getByRole('button', { name: '新建事务' }));
  await sheet.getByRole('button', { name: '笔记' }).click();
  await sheet.getByLabel('标题').fill('旅行打包清单');
  await sheet.getByLabel('内容').fill('护照、充电器');
  await sheet.getByLabel('项目').selectOption({ label: '个人网站' });
  await sheet.getByRole('button', { name: '创建' }).click();
  await sheet.waitFor({ state: 'detached' });
  const projects = snap().projects as AgendaProject[];
  const life = projects.find(p => p.name === '生活')!, site = projects.find(p => p.name === '个人网站')!;
  const items = snap().items as AgendaItem[];
  assert.equal(items.find(i => i.title === '交水电费')?.projectId, life.id);
  const noteItem = items.find(i => i.title === '旅行打包清单')!;
  assert.equal(noteItem.kind, 'note'); assert.equal(noteItem.projectId, site.id);
  assert.equal(service.store.tasks().length, 0, 'agenda never creates coding tasks');
  await page.screenshot({ path: join(output, '02-projects.png') });
  step('projects, todo and note created and filed via UI');

  // 2. Due todo with a reminder; changing the time cancels the old pending reminder.
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  let todo = mutate<AgendaItem>('item.create', { kind: 'todo', title: '整理首页文案', projectId: site.id, dueAt: iso(now + 3600e3), reminderAt: iso(now - 60e3) });
  agenda.tick();
  const popup = page.locator('.web-reminder', { hasText: '整理首页文案' });
  await popup.waitFor();
  await panel.locator('.ag-reminder', { hasText: '整理首页文案' }).waitFor();
  await page.screenshot({ path: join(output, '03-reminder.png') });
  todo = mutate<AgendaItem>('item.update', { id: todo.id, revision: todo.revision, reminderAt: iso(now + 7200e3) });
  await panel.locator('.ag-reminder', { hasText: '整理首页文案' }).waitFor({ state: 'detached' });
  assert.equal(snap().notifications.length, 0);
  await popup.waitFor({ state: 'detached' });
  step('reminder popup + inbox card; rescheduling withdraws the old reminder');

  // 3. "知道了" doesn't complete; reload doesn't pop again.
  const errand = mutate<AgendaItem>('item.create', { kind: 'todo', title: '取快递', reminderAt: iso(now - 30e3) });
  agenda.tick();
  const card = panel.locator('.ag-reminder', { hasText: '取快递' });
  await card.waitFor();
  await card.getByRole('button', { name: '知道了' }).click();
  await card.waitFor({ state: 'detached' });
  assert.equal(agenda.get<AgendaItem>('items', errand.id).status, 'open');
  const bill = mutate<AgendaItem>('item.create', { kind: 'todo', title: '续费域名', reminderAt: iso(now - 20e3) });
  agenda.tick();
  await page.locator('.web-reminder', { hasText: '续费域名' }).waitFor();
  await page.reload();
  await page.locator('.panel-window .ag-reminder', { hasText: '续费域名' }).waitFor();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.web-reminder', { hasText: '续费域名' }).count(), 0, 'no repeat popup after reload');
  step('acknowledge keeps todo open; reload shows inbox but no repeat popup');

  // 4. "完成事务" completes and cancels the reminder.
  await page.locator('.panel-window .ag-reminder', { hasText: '续费域名' }).getByRole('button', { name: '完成事务' }).click();
  await page.locator('.panel-window .ag-reminder', { hasText: '续费域名' }).waitFor({ state: 'detached' });
  assert.equal(agenda.get<AgendaItem>('items', bill.id).status, 'done');
  assert.equal(snap().notifications.some(n => n.itemId === bill.id), false);
  step('complete from reminder');

  // 5. Snooze then wake: same id may pop again.
  const call = mutate<AgendaItem>('item.create', { kind: 'todo', title: '给妈妈打电话', reminderAt: iso(now - 10e3) });
  agenda.tick();
  const callCard = page.locator('.panel-window .ag-reminder', { hasText: '给妈妈打电话' });
  await callCard.waitFor();
  await page.locator('.web-reminder', { hasText: '给妈妈打电话' }).getByRole('button', { name: '关闭' }).click();
  await callCard.getByRole('button', { name: '稍后提醒' }).click();
  await callCard.getByRole('button', { name: '10 分钟后' }).click();
  await page.locator('.panel-window').getByText('已延后 1 条提醒').waitFor();
  const snoozed = snap().notifications.find(n => n.itemId === call.id)!;
  assert.equal(snoozed.status, 'snoozed');
  // Simulate the snooze expiring.
  service.store.put('agenda-notification', snoozed.id, { ...snoozed, snoozedUntil: iso(Date.now() - 1000) });
  agenda.tick();
  await page.locator('.web-reminder', { hasText: '给妈妈打电话' }).waitFor();
  step('snooze then re-pop after wake-up');

  // 6. Plan: draft creates nothing; accept once; idempotent replay creates nothing extra.
  const plan = mutate<AgendaPlan>('plan.create', { title: '准备国庆旅行', projectId: life.id, steps: [{ title: '订酒店' }, { title: '买车票' }, { title: '列打包清单' }] });
  const before = snap().items.length;
  await panel.getByRole('button', { name: /^计划/ }).click();
  const draft = panel.locator('.ag-plan', { hasText: '准备国庆旅行' });
  await draft.getByText('订酒店').waitFor();
  assert.equal(snap().items.length, before);
  await draft.getByRole('button', { name: '确认采用' }).click();
  await panel.locator('.ag-plan', { hasText: '准备国庆旅行' }).getByText('0/3').waitFor();
  assert.equal(snap().items.length, before + 3);
  assert.throws(() => mutate('plan.accept', { id: plan.id, revision: plan.revision }), /已修改|已处理/);
  await page.screenshot({ path: join(output, '04-plans.png') });
  step('plan accept creates exactly its steps');

  // 7. Weekly event with exception in week view.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const start = new Date(`${today}T00:00:00Z`);
  const monday = new Date(start.getTime() - (((start.getUTCDay() + 6) % 7) * 86400e3)).toISOString().slice(0, 10);
  const wed = new Date(Date.parse(`${monday}T00:00:00Z`) + 2 * 86400e3).toISOString().slice(0, 10);
  mutate('item.create', { kind: 'event', title: '游泳课', timezone: 'Asia/Shanghai', startsAt: `${monday}T19:00:00+08:00`, endsAt: `${monday}T20:00:00+08:00`,
    recurrence: { frequency: 'weekly', interval: 1, weekdays: [1, 3, 5], exceptions: [wed] }, reminderMinutesBefore: 30 });
  await panel.getByRole('button', { name: '本周', exact: true }).click();
  await panel.locator('.ag-weekday .ag-row', { hasText: '游泳课' }).first().waitFor();
  const swimDays = await panel.locator('.ag-weekday', { has: page.locator('.ag-row', { hasText: '游泳课' }) }).count();
  assert.equal(swimDays, 2, 'Mon and Fri, Wed skipped');
  await page.screenshot({ path: join(output, '05-week.png') });
  await panel.getByRole('button', { name: '下一周' }).click();
  await panel.getByText('回到本周').waitFor();
  await panel.locator('.ag-weekday .ag-row', { hasText: '游泳课' }).nth(2).waitFor();
  assert.equal(await panel.locator('.ag-weekday', { has: page.locator('.ag-row', { hasText: '游泳课' }) }).count(), 3);
  step('weekly recurrence and exceptions in week view');

  // 8. Conflict: edit in UI while backend changes the record.
  await panel.getByRole('button', { name: '未安排' }).click();
  await panel.locator('.ag-row', { hasText: '交水电费' }).locator('.ag-row-main').click();
  await sheet.getByLabel('标题').fill('交水电费（十月）');
  const bills = agenda.snapshot().items.find(i => i.title === '交水电费')!;
  mutate('item.update', { id: bills.id, revision: bills.revision, notes: '大肥鱼改的' });
  await sheet.getByText('这条记录在别处被修改了').waitFor();
  await sheet.getByRole('button', { name: '保留我的修改' }).click();
  await sheet.getByRole('button', { name: '保存' }).click();
  await sheet.waitFor({ state: 'detached' });
  const saved = agenda.get<AgendaItem>('items', bills.id);
  assert.equal(saved.title, '交水电费（十月）'); assert.equal(saved.notes, '大肥鱼改的', 'only changed fields sent');
  step('concurrent edit shows conflict and never overwrites silently');

  // 9. Archive pauses, restore resumes.
  await panel.getByRole('button', { name: '项目', exact: true }).click();
  await panel.locator('.ag-project', { hasText: '个人网站' }).click();
  await panel.getByRole('button', { name: '归档项目' }).click();
  await panel.getByRole('button', { name: '恢复项目' }).waitFor();
  assert.equal(agenda.get<AgendaProject>('projects', site.id).archived, true);
  await panel.getByRole('button', { name: '恢复项目' }).click();
  await panel.getByRole('button', { name: '归档项目' }).waitFor();
  step('archive and restore');

  // 10. Other tabs still work.
  for (const name of ['对话', '任务', '设置']) await panel.getByRole('tab', { name: new RegExp(name) }).click();
  await panel.getByText('大肥鱼的大脑').waitFor();
  await panel.getByRole('tab', { name: /事务/ }).click();
  await panel.locator('.ag-views').waitFor();
  step('chat/tasks/settings tabs unaffected');

  await page.screenshot({ path: join(output, '06-final.png') });
  assert.deepEqual(errors, []);
  console.log(`Agenda preview check passed. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await vite?.close();
  await service.close();
  backend.close();
}
