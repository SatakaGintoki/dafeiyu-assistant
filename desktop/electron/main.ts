import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { ManagedBackend } from './backend';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { verifyPackage } from './verify-package';
import { join, resolve } from 'node:path';
import { SseClient } from '../src/lib/sse';
import type { PanelTab, PetPrefs, StreamItem } from '../src/lib/types';

const PET = { width: 360, height: 460 };
const PANEL = { width: 440, height: 680 };

const verificationRoot = process.argv.find(arg => arg.startsWith('--dayu-verify='))?.slice('--dayu-verify='.length);
let verificationDir: string | undefined;
if (verificationRoot) {
  mkdirSync(resolve(verificationRoot), { recursive: true });
  verificationDir = mkdtempSync(join(resolve(verificationRoot), 'dayu-release-'));
  app.setPath('userData', verificationDir);
}

const appDir = app.getAppPath();
const root = resolve(process.env.DAYU_ROOT || join(appDir, '..'));
const dataDir = app.isPackaged ? join(app.getPath('userData'), 'data') : resolve(process.env.DAYU_DATA_DIR || join(root, '.data'));
const devUrl = app.isPackaged ? undefined : process.env.VITE_DEV_URL;
const managed = app.isPackaged ? new ManagedBackend(process.resourcesPath, app.getPath('userData')) : undefined;

function backendUrl() {
  if (managed) return managed.url || 'http://127.0.0.1:1';
  let url = process.env.DAYU_BACKEND_URL;
  if (!url) try { url = JSON.parse(readFileSync(join(dataDir, 'connection.json'), 'utf8')).url; } catch { /* default */ }
  try {
    const parsed = new URL(url || 'http://127.0.0.1:4318');
    // The token only ever goes to a local backend.
    if (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)) return parsed.origin;
  } catch { /* fall through */ }
  return 'http://127.0.0.1:4318';
}
function token() {
  if (!app.isPackaged && process.env.DAYU_API_TOKEN) return process.env.DAYU_API_TOKEN;
  try { return readFileSync(join(dataDir, 'api-token'), 'utf8').trim(); } catch { return ''; }
}

// ---- pet preferences (size, walking, position) ----
type Stored = PetPrefs & { x?: number; y?: number };
const prefsFile = join(app.getPath('userData'), 'pet.json');
let prefs: Stored = { size: 'm', walk: true, topmost: true };
try { prefs = { ...prefs, ...JSON.parse(readFileSync(prefsFile, 'utf8')) }; } catch { /* first run */ }
function savePrefs() {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));
  } catch { /* non-fatal */ }
}
function publicPrefs(): PetPrefs { return { size: prefs.size, walk: prefs.walk, topmost: prefs.topmost, focus:!!prefs.focus }; }
function setPrefs(patch: Partial<PetPrefs>) {
  prefs = { ...prefs, ...patch };
  savePrefs();
  pet?.setAlwaysOnTop(prefs.topmost&&!prefs.focus, 'floating');
  panel?.setAlwaysOnTop(prefs.topmost&&!prefs.focus, 'floating');
  broadcast('prefs:changed', publicPrefs());
}

let pet: BrowserWindow | undefined;
let panel: BrowserWindow | undefined;
let tray: Tray | undefined;
const sse = new SseClient({
  url: () => `${backendUrl()}/api/v1/events`,
  headers: () => ({ Authorization: `Bearer ${token()}` }),
  emit: (item: StreamItem) => broadcast('api:stream', item),
});

function broadcast(channel: string, value: unknown) {
  for (const win of [pet, panel]) if (win && !win.isDestroyed()) win.webContents.send(channel, value);
}

function secure(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', event => event.preventDefault());
}

function load(win: BrowserWindow, view: 'pet' | 'panel') {
  if (devUrl) void win.loadURL(`${devUrl}#${view}`);
  else void win.loadFile(join(appDir, 'dist/index.html'), { hash: view });
}

const webPreferences = {
  preload: join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  backgroundThrottling: false,
  spellcheck: false,
};

function onSomeScreen(x: number, y: number, w: number, h: number) {
  const cx = x + w / 2, cy = y + h / 2;
  return screen.getAllDisplays().some(({ workArea: a }) => cx > a.x && cx < a.x + a.width && cy > a.y && cy < a.y + a.height);
}

function createPet() {
  const area = screen.getPrimaryDisplay().workArea;
  const x = prefs.x ?? area.x + area.width - PET.width - 24;
  const y = prefs.y ?? area.y + area.height - PET.height;
  pet = new BrowserWindow({
    ...PET, ...(onSomeScreen(x, y, PET.width, PET.height) ? { x, y } : {}),
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, backgroundColor: '#00000000',
    title: '大肥鱼', webPreferences,
  });
  pet.setAlwaysOnTop(prefs.topmost&&!prefs.focus, 'floating');
  pet.setIgnoreMouseEvents(true, { forward: true });
  secure(pet);
  load(pet, 'pet');
  pet.once('ready-to-show', () => pet?.showInactive());
  pet.on('closed', () => { pet = undefined; });
}

function createPanel() {
  panel = new BrowserWindow({
    ...PANEL, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, backgroundColor: '#00000000',
    title: '大肥鱼 · 管家面板', webPreferences,
  });
  panel.setAlwaysOnTop(prefs.topmost&&!prefs.focus, 'floating');
  secure(panel);
  load(panel, 'panel');
  panel.on('blur', () => { /* stays open; user closes explicitly */ });
  panel.on('closed', () => { panel = undefined; });
}

function placePanel() {
  if (!pet || !panel) return;
  const p = pet.getBounds();
  const area = screen.getDisplayMatching(p).workArea;
  // The pet window has transparent margins, so the panel may overlap them.
  let x = p.x + 60 - PANEL.width;
  if (x < area.x) x = p.x + p.width - 60;
  x = Math.max(area.x, Math.min(x, area.x + area.width - PANEL.width));
  const y = Math.max(area.y, Math.min(p.y + p.height - PANEL.height, area.y + area.height - PANEL.height));
  panel.setBounds({ x, y, ...PANEL });
}

function showPanel(tab?: PanelTab) {
  if (!panel) createPanel();
  if (!panel) return;
  const wasVisible = panel.isVisible();
  if (!wasVisible) placePanel();
  panel.show();
  panel.focus();
  panel.webContents.send('panel:opened', tab);
  if (!wasVisible) pet?.webContents.send('panel:visibility', true);
}
function hidePanel() {
  if (!panel?.isVisible()) return;
  panel.hide();
  pet?.webContents.send('panel:visibility', false);
}

function showPetMenu() {
  if (!pet) return;
  const size = (value: PetPrefs['size'], label: string): MenuItemConstructorOptions =>
    ({ label, type: 'radio', checked: prefs.size === value, click: () => setPrefs({ size: value }) });
  Menu.buildFromTemplate([
    { label: '和大肥鱼聊天', click: () => showPanel('chat') },
    { label: '任务列表', click: () => showPanel('tasks') },
    { label: '设置', click: () => showPanel('settings') },
    { type: 'separator' },
    { label: '自由散步', type: 'checkbox', checked: prefs.walk, click: item => setPrefs({ walk: item.checked }) },
    { label: '专注模式', type: 'checkbox', checked: !!prefs.focus, click: item => setPrefs({ focus: item.checked }) },
    { label: '大小', submenu: [size('s', '小'), size('m', '标准'), size('l', '大')] },
    { label: '保持置顶', type: 'checkbox', checked: prefs.topmost, click: item => setPrefs({ topmost: item.checked }) },
    { type: 'separator' },
    { label: '藏到托盘', click: () => { hidePanel(); pet?.hide(); } },
    { label: '退出', click: () => app.quit() },
  ]).popup({ window: pet });
}

function trayIcon() {
  const file = join(appDir, 'src/assets/front.png');
  if (!existsSync(file)) return nativeImage.createEmpty();
  return nativeImage.createFromPath(file).crop({ x: 48, y: 10, width: 160, height: 160 }).resize({ width: 32, height: 32, quality: 'best' });
}
function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('大肥鱼 · 桌面管家');
  const togglePet = () => {
    if (!pet) createPet();
    else if (pet.isVisible()) { hidePanel(); pet.hide(); }
    else pet.showInactive();
  };
  tray.on('click', togglePet);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏大肥鱼', click: togglePet },
    { label: '打开对话', click: () => { pet?.showInactive(); showPanel('chat'); } },
    { label: '任务列表', click: () => { pet?.showInactive(); showPanel('tasks'); } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
}

async function healthy() {
  try { return (await fetch(`${backendUrl()}/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

/** Opens the backend in its own visible console so the user keeps control of it (Ctrl+C stops it). */
async function startBackend(): Promise<{ ok: boolean; error?: string }> {
  if (managed) {
    try { await managed.start(); return { ok: true }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  if (await healthy()) return { ok: true };
  try {
    if (process.platform === 'win32') {
      const script = join(root, '启动后端.cmd');
      if (!existsSync(script)) return { ok: false, error: '找不到 启动后端.cmd' };
      spawn('cmd.exe', ['/d', '/c', 'start', '"大肥鱼后端"', '/D', `"${root}"`, `"${script}"`],
        { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('npm', ['start'], { cwd: root, detached: true, stdio: 'ignore' }).unref();
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await healthy()) return { ok: true };
  }
  return { ok: false, error: '后端启动超时，请查看弹出的后端窗口' };
}

type ApiInput = { method: string; path: string; body?: unknown; headers?: Record<string, string> };
const methods = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
ipcMain.handle('api:request', async (_event, input: ApiInput) => {
  if (!input || !methods.has(input.method) || typeof input.path !== 'string' || !/^\/api\/v1\/[\w/.-]*$/.test(input.path) || input.path.includes('..')) {
    return { status: 400, body: { error: '无效请求' } };
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${token()}` };
  const key = input.headers?.['Idempotency-Key'];
  if (typeof key === 'string') headers['Idempotency-Key'] = key;
  if (input.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(backendUrl() + input.path, {
      method: input.method, headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: text.slice(0, 500) }; }
    return { status: response.status, body };
  } catch {
    return { status: 0, body: { error: '连接不到后端' } };
  }
});
ipcMain.handle('api:connection', () => sse.connection);
ipcMain.handle('folder:choose',async()=>{
  const result=await dialog.showOpenDialog({properties:['openDirectory'],title:'选择项目文件夹'});
  return result.canceled?undefined:result.filePaths[0];
});
ipcMain.handle('task:files',async(_event,input:{id:string;action:string;index?:number})=>{
  if(!input||!/^[a-f0-9-]{36}$/i.test(input.id)||!['reveal','recover'].includes(input.action))return {ok:false,error:'无效请求'};
  try{
    if(input.action==='recover'){
      const choice=await dialog.showMessageBox({type:'question',buttons:['取消','恢复到新文件夹'],defaultId:0,cancelId:0,message:'将任务执行前保存的文件恢复到一个新的独立文件夹。',detail:'不会覆盖当前项目。依赖、构建目录、密钥和符号链接等未备份内容不在恢复范围内。'});
      if(choice.response!==1)return {ok:false,error:'已取消恢复'};
    }
    const response=await fetch(`${backendUrl()}/api/v1/tasks/${input.id}/${input.action}`,{method:'POST',headers:{Authorization:`Bearer ${token()}`,'Content-Type':'application/json'},body:JSON.stringify(input.action==='reveal'?{index:input.index??-1}:{}),signal:AbortSignal.timeout(60000)});
    const result=await response.json();
    if(!response.ok)return {ok:false,error:result.error};
    // Reveal in Explorer, never execute an arbitrary task-generated file.
    shell.showItemInFolder(result.path);
    return {ok:true,path:result.path};
  }catch{return {ok:false,error:'文件操作失败，请检查后端和目录是否可用'};}
});
ipcMain.on('pet:interactive', (_e, value: boolean) => pet?.setIgnoreMouseEvents(!value, { forward: true }));
ipcMain.on('pet:move', (_e, x: number, y: number) => {
  if (pet && Number.isFinite(x) && Number.isFinite(y)) pet.setBounds({ x: Math.round(x), y: Math.round(y), ...PET });
});
ipcMain.on('pet:move-end', () => {
  if (!pet) return;
  const { x, y } = pet.getBounds();
  prefs = { ...prefs, x, y };
  savePrefs();
  if (panel?.isVisible()) placePanel();
});
ipcMain.handle('pet:bounds', () => pet?.getBounds());
ipcMain.handle('pet:work-area', () => (pet ? screen.getDisplayMatching(pet.getBounds()) : screen.getPrimaryDisplay()).workArea);
ipcMain.on('pet:menu', showPetMenu);
ipcMain.on('panel:open', (_e, tab?: PanelTab) => showPanel(tab));
ipcMain.on('panel:hide', hidePanel);
ipcMain.handle('prefs:get', () => publicPrefs());
ipcMain.on('prefs:set', (_e, patch: Partial<PetPrefs>) => {
  const clean: Partial<PetPrefs> = {};
  if (patch?.size === 's' || patch?.size === 'm' || patch?.size === 'l') clean.size = patch.size;
  if (typeof patch?.walk === 'boolean') clean.walk = patch.walk;
  if (typeof patch?.topmost === 'boolean') clean.topmost = patch.topmost;
  if (typeof patch?.focus === 'boolean') clean.focus = patch.focus;
  setPrefs(clean);
});
ipcMain.handle('backend:start', startBackend);
ipcMain.on('open-external', (_e, url: string) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url); });

// The pet leans toward the cursor; the renderer can't see the cursor outside its window.
let lastCursor = '';
setInterval(() => {
  if (!pet?.isVisible()) return;
  const point = screen.getCursorScreenPoint();
  const bounds = pet.getBounds();
  const value = { x: point.x - bounds.x, y: point.y - bounds.y };
  const key = `${value.x},${value.y}`;
  if (key === lastCursor) return;
  lastCursor = key;
  pet.webContents.send('pet:cursor', value);
}, 50);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { pet?.showInactive(); showPanel('chat'); });
  void app.whenReady().then(async () => {
    if (managed) {
      mkdirSync(app.getPath('userData'), { recursive: true });
      const result = await startBackend();
      if (!result.ok) dialog.showErrorBox('大肥鱼启动失败', result.error || '后端未启动');
    }
    createPet();
    createPanel();
    createTray();
    sse.start();
    if (verificationDir) void verifyPackage(verificationDir);
  });
  app.on('window-all-closed', () => { /* lives in the tray */ });
  let quitting = false;
  app.on('before-quit', event => {
    sse.stop();
    if (managed && !quitting) {
      event.preventDefault();
      quitting = true;
      void managed.stop().finally(() => app.quit());
    }
  });
}
