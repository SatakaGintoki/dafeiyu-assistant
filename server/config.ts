import { existsSync, readFileSync, writeFileSync, renameSync, realpathSync, statSync, mkdirSync } from 'node:fs';
import { resolve, isAbsolute, parse, join } from 'node:path';
import { z } from 'zod';
import { defaults, Store } from './store';
import type { Settings } from '../shared/types';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export const settingsSchema = z.object({
  runtime: z.enum(['harness', 'deepseek', 'demo']).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().url().max(500).optional(),
  defaultExecutor: z.enum(['codex', 'claude', 'zcode', 'demo']).optional(),
  workspace: z.string().min(1).max(2000).optional(), nickname: z.string().trim().max(60).optional(),
  codexPath: z.string().max(2000).optional(), claudePath: z.string().max(2000).optional(), zcodePath: z.string().max(2000).optional(),
  claudeFullAccess: z.boolean().optional(),
  executorModel: z.string().trim().max(120).optional(),
  taskTimeoutMinutes: z.number().int().min(1).max(240).optional(),
  apiKey: z.string().trim().max(1000).optional(),
}).strict();

export function workspacePath(value: string): string {
  if (!isAbsolute(value)) throw new ApiError(400, '工作目录必须是绝对路径');
  let path: string;
  try { path = realpathSync(value); if (!statSync(path).isDirectory()) throw new Error(); }
  catch { throw new ApiError(400, '工作目录不存在或不是文件夹'); }
  if (parse(path).root === path) throw new ApiError(400, '请选择具体项目文件夹，不能使用磁盘根目录');
  return path;
}

export class Config {
  private secret: string;
  constructor(public store: Store, public projectRoot: string) {
    mkdirSync(join(projectRoot,'projects'),{recursive:true});
    const file = join(store.dir, 'secrets.json');
    this.secret = process.env.DEEPSEEK_API_KEY || (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).apiKey : '') || '';
  }
  get apiKey() { return this.secret; }
  get value(): Settings { return { ...defaults(this.projectRoot), ...this.store.get<Settings>('config','settings'), hasApiKey: !!this.secret }; }
  update(input: unknown): Settings {
    const parsed = settingsSchema.parse(input);
    const { apiKey, ...patch } = parsed;
    if (patch.workspace) patch.workspace = workspacePath(patch.workspace);
    if (patch.baseUrl) {
      const url = new URL(patch.baseUrl);
      if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname))) throw new ApiError(400, 'API 地址必须为 HTTPS；本机测试可使用 HTTP');
      if (!['http:', 'https:'].includes(url.protocol)) throw new ApiError(400, '无效的 API 协议');
      patch.baseUrl = patch.baseUrl.replace(/\/+$/, '');
    }
    if (apiKey !== undefined) {
      const file = join(this.store.dir, 'secrets.json');
      writeFileSync(file + '.tmp', JSON.stringify({apiKey}), {mode:0o600}); renameSync(file + '.tmp', file); this.secret = apiKey;
    }
    const settings = { ...this.value, ...patch, hasApiKey: !!this.secret };
    this.store.put('config', 'settings', settings); return settings;
  }
  redact(value: string) {
    let text = value;
    if (this.secret) text = text.split(this.secret).join('[REDACTED]');
    text=text.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]');
    return text.length>32000 ? text.slice(0,32000)+'\n[内容已截断，请查看执行器原始产物]' : text;
  }
}
