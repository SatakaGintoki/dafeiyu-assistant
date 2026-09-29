import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

export class ManagedBackend {
  private child?: ChildProcess;
  private starting?: Promise<void>;
  url = '';
  constructor(private resources: string, private userData: string) {}

  start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.child && this.url) return Promise.resolve();
    this.starting = this.launch().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private launch(): Promise<void> {
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env, DAYU_USER_DATA: this.userData };
      // Never inherit developer connection overrides into the installed backend.
      for (const key of ['DAYU_API_TOKEN', 'DAYU_DATA_DIR', 'DAYU_BACKEND_URL', 'ELECTRON_RUN_AS_NODE']) delete env[key];
      const child = spawn(join(this.resources, 'runtime/node.exe'), [join(this.resources, 'backend/server/index.mjs')], {
        cwd: this.userData, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env,
      });
      this.child = child;
      const timer = setTimeout(() => { reject(new Error('后端启动超时，请退出后重新打开大肥鱼')); void this.stop(); }, 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => {
        clearTimeout(timer);
        if (this.child === child) { this.child = undefined; this.url = ''; }
        reject(new Error('后端未能启动，请重新打开大肥鱼或检查应用数据目录'));
      });
      child.on('message', (message: any) => {
        if (message?.type === 'ready') {
          this.url = message.url;
          clearTimeout(timer);
          resolve();
        } else if (message?.type === 'error') { clearTimeout(timer); reject(new Error(message.message)); }
      });
    });
  }

  async stop() {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        if (child.pid) {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.once('error', () => { child.kill(); resolve(); });
          killer.once('exit', () => resolve());
        } else resolve();
      }, 15000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      if (child.connected) child.send('shutdown', () => {});
      else child.kill();
    });
  }
}
