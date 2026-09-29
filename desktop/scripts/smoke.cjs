// Run with Electron after building. Uses isolated preferences and never sends model requests.
const { app, BrowserWindow } = require('electron');
const { join, resolve } = require('node:path');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const desktop = resolve(__dirname, '..');
const work = join(desktop, '../work');
mkdirSync(work, { recursive: true });
const output = mkdtempSync(join(work, 'desktop-smoke-'));
app.setAppPath(desktop);
app.setPath('userData', output);
const errors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_event, _path, error) => errors.push(error.message));
  contents.on('render-process-gone', (_event, details) => errors.push(details.reason));
  contents.on('console-message', (_event, details) => {
    if (details.level === 'error') errors.push(details.message);
  });
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 30000);
require('../dist-electron/main.cjs');
app.whenReady().then(async () => {
  try {
    let windows;
    for (let i = 0; i < 100; i++) {
      windows = BrowserWindow.getAllWindows();
      if (windows.length === 2 && windows.every(win => !win.webContents.isLoading())) break;
      await pause(100);
    }
    assert.equal(windows.length, 2);
    await pause(700);
    if (process.env.DAYU_SMOKE_ONLINE === '1') {
      const panel = windows.find(win => win.webContents.getURL().endsWith('#panel'));
      assert.ok(panel);
      const call = (method, path, body) => panel.webContents.executeJavaScript(`window.dayu.api.request(${JSON.stringify(method)}, ${JSON.stringify(path)}, ${JSON.stringify(body) ?? 'undefined'})`);
      const state = await call('GET', '/api/v1/state');
      assert.equal(state.status, 200);
      assert.equal(state.body.settings.runtime, 'demo');
      assert.equal((await call('POST', '/api/v1/chat', { message: '你好，这是桌面联通测试' })).status, 202);
      const created = await call('POST', '/api/v1/tasks', { title: '桌面联通测试', instruction: '运行离线演示任务', executor: 'demo' });
      assert.equal(created.status, 201);
      let completed = false;
      for (let i = 0; i < 100; i++) {
        const task = await call('GET', `/api/v1/tasks/${created.body.id}`);
        if (task.body.status === 'succeeded') { completed = true; break; }
        await pause(100);
      }
      assert.ok(completed, 'Demo task did not finish');
      await pause(300);
      const content = await panel.webContents.executeJavaScript('document.body.innerText');
      assert.ok(content.includes('你好，这是桌面联通测试'), 'Live chat did not reach the renderer');
      await panel.webContents.executeJavaScript("window.dayu.panel.open('tasks')");
      await pause(300);
      const tasks = await panel.webContents.executeJavaScript('document.body.innerText');
      assert.ok(tasks.includes('桌面联通测试'), 'Live task did not reach the renderer');
      console.log('Demo chat, task execution and live renderer updates passed.');
    }
    for (const win of windows) {
      const result = await win.webContents.executeJavaScript(`({ view: document.documentElement.dataset.view, bridge: !!window.dayu, nodes: document.querySelector('#root').childElementCount, imagesReady: [...document.images].every(image => image.complete && image.naturalWidth > 0) })`);
      assert.ok(result.bridge, 'Preload bridge missing');
      assert.ok(result.nodes > 0, 'Renderer is empty');
      assert.ok(result.imagesReady, 'Character image failed to load');
      assert.ok(['pet', 'panel'].includes(result.view));
      console.log(JSON.stringify(result));
      win.showInactive();
      await pause(500);
      writeFileSync(join(output, `${result.view}.png`), (await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(errors, []);
    console.log(`Desktop smoke passed. Screenshots: ${output}`);
    clearTimeout(timeout);
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    process.exitCode = 1;
    app.exit(1);
  }
});
