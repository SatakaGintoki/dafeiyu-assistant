import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Task, Message, AppEvent, Settings } from '../shared/types';

export class Store {
  db: DatabaseSync;
  private lock: string;
  private closed=false;
  constructor(public dir: string) {
    mkdirSync(dir, { recursive: true });
    this.lock=join(dir,'service.lock');
    for(let attempt=0;;attempt++) {
      try {const fd=openSync(this.lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid}));closeSync(fd);break;}
      catch(error:any) {
        if(error.code!=='EEXIST' || attempt)throw error;
        let pid:number;
        try {pid=JSON.parse(readFileSync(this.lock,'utf8')).pid;if(!Number.isSafeInteger(pid)||pid<1)throw new Error();}
        catch {throw new Error('数据目录锁无效，请确认没有正在运行的服务后检查 service.lock');}
        let alive=true;try {process.kill(pid,0);}catch(error:any){if(error.code==='ESRCH')alive=false;}
        if(alive)throw new Error('此数据目录已被另一个服务占用');
        unlinkSync(this.lock);
      }
    }
    try {this.db = new DatabaseSync(join(dir, 'dayu.sqlite'));}catch(error){unlinkSync(this.lock);throw error;}
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL);`);
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  put(kind: string, id: string, body: unknown) { this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, id, JSON.stringify(body)); }
  list<T>(kind: string): T[] { return (this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid').all(kind) as {body: string}[]).map(r => JSON.parse(r.body)); }
  tasks() { return this.list<Task>('task'); }
  messages() { return this.list<Message>('message'); }
  message(role: Message['role'], content: string, taskId?: string) {
    const message: Message = { id: randomUUID(), role, content, createdAt: new Date().toISOString(), ...(taskId ? { taskId } : {}) };
    this.put('message', message.id, message); return message;
  }
  event(type: string, data: unknown): AppEvent {
    const at = new Date().toISOString();
    const row = this.db.prepare('INSERT INTO events(type,body,at) VALUES (?,?,?)').run(type, JSON.stringify(data), at);
    return { seq: Number(row.lastInsertRowid), type, data, at };
  }
  eventsAfter(seq: number): AppEvent[] {
    return (this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 1000').all(seq) as any[]).map(r => ({seq:r.seq, type:r.type, data:JSON.parse(r.body), at:r.at}));
  }
  close() { if(this.closed)return;this.closed=true;this.db.close();unlinkSync(this.lock); }
}

export function defaults(workspace: string): Settings {
  return { runtime: 'harness', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', defaultExecutor: 'codex', workspace:join(workspace,'projects'), nickname: '', codexPath: '', claudePath: '', zcodePath: '', executorModel: '', claudeFullAccess: false, taskTimeoutMinutes: 30, hasApiKey: false };
}
