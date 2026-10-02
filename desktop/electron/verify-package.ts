import { APP_VERSION } from '../../shared/version';
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

/** Explicit local release verification; main.ts assigns a fresh, isolated userData first. */
export async function verifyPackage(output: string) {
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  try {
    await delay(1500);
    const windows = BrowserWindow.getAllWindows();
    assert.equal(windows.length, 2);
    const panel = windows.find(win => win.webContents.getURL().endsWith('#panel'))!;
    const pet = windows.find(win => win.webContents.getURL().endsWith('#pet'))!;
    await panel.webContents.executeJavaScript('window.dayu.prefs.set({topmost:true,focus:true})');
    await delay(200);
    panel.show();panel.focus();
    await delay(200);
    assert.equal(pet.isVisible(),true,'pet remains visible after losing focus');
    assert.equal(pet.isAlwaysOnTop(),true,'focus mode must not disable pet topmost');
    assert.equal(panel.isAlwaysOnTop(),true,'focus mode must not disable panel topmost');
    await panel.webContents.executeJavaScript('window.dayu.prefs.set({topmost:false})');
    await delay(200);
    assert.equal(pet.isAlwaysOnTop(),false,'explicit topmost toggle still works');
    assert.equal(panel.isAlwaysOnTop(),false,'panel follows explicit topmost toggle');
    await panel.webContents.executeJavaScript('window.dayu.prefs.set({topmost:true,focus:false})');
    await delay(200);
    assert.equal(pet.isAlwaysOnTop(),true);
    assert.equal(panel.isAlwaysOnTop(),true);
    panel.hide();
    await panel.webContents.executeJavaScript("window.dayu.panel.open('chat')");
    await delay(200);
    assert.equal(panel.isVisible(),true,'recalled panel is visible');
    assert.equal(panel.isAlwaysOnTop(),true,'recalled panel remains topmost');
    const call = (method: string, path: string, body?: unknown) => panel.webContents.executeJavaScript(
      `window.dayu.api.request(${JSON.stringify(method)},${JSON.stringify(path)},${JSON.stringify(body) ?? 'undefined'})`);
    assert.equal((await call('GET', '/api/v1/state')).status, 200);
    assert.equal((await call('PATCH', '/api/v1/settings', { runtime: 'demo', defaultExecutor: 'demo' })).status, 200);
    assert.equal((await call('POST', '/api/v1/chat', { message: '安装版验证' })).status, 202);
    const created = await call('POST', '/api/v1/tasks', { title: '安装版验证', instruction: '演示任务', executor: 'demo' });
    assert.equal(created.status, 201);
    await delay(2500);
    assert.equal((await call('GET', `/api/v1/tasks/${created.body.id}`)).body.status, 'succeeded');
    assert.ok((await panel.webContents.executeJavaScript('document.body.innerText')).includes('安装版验证'));
    assert.equal((await call('GET','/api/v1/diagnostics')).body.version,APP_VERSION);
    await panel.webContents.executeJavaScript("window.dayu.panel.open('settings')");
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await panel.webContents.executeJavaScript('document.body.innerText')).includes('我的项目')) break;
      await delay(250);
    }
    assert.ok((await panel.webContents.executeJavaScript('document.body.innerText')).includes('我的项目'));
    for (const win of windows) {
      win.showInactive();
      await delay(400);
      const view = await win.webContents.executeJavaScript('document.documentElement.dataset.view');
      assert.ok(['pet', 'panel'].includes(view));
      writeFileSync(join(output, `${view}.png`), (await win.webContents.capturePage()).toPNG());
    }
    writeFileSync(join(output, 'result.json'), JSON.stringify({ ok: true, packaged: app.isPackaged, version: app.getVersion() }));
  } catch (error) {
    const panel = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#panel'));
    if (panel) {
      writeFileSync(join(output, 'failure.txt'), await panel.webContents.executeJavaScript('document.body.innerText'));
      writeFileSync(join(output, 'failure.png'), (await panel.webContents.capturePage()).toPNG());
    }
    writeFileSync(join(output, 'result.json'), JSON.stringify({ ok: false, error: String(error) }));
  } finally { app.quit(); }
}
