import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useApp, usePrefs } from '../context';
import { ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import type { Executor, PetSize, Settings as SettingsType } from '../lib/types';
import { useToast } from '../ui/toast';
import { WorkspaceSettings } from './WorkspaceSettings';
import { GettingStarted } from './GettingStarted';

type Form = Omit<SettingsType, 'hasApiKey'> & { apiKey: string };
const runtimes: { id: SettingsType['runtime']; label: string; hint: string }[] = [
  { id: 'deepseek', label: '直连管家', hint: '直接连接模型，可调用工具、派发任务' },
  { id: 'harness', label: 'Harness 管家', hint: '通过本地 Harness 调用模型和工具' },
  { id: 'demo', label: '演示', hint: '不需要 Key' },
];
const executors: { id: Executor; label: string }[] = [{ id: 'codex', label: 'Codex' }, { id: 'claude', label: 'Claude Code' }, { id: 'zcode', label: 'ZCode' }, { id: 'demo', label: '演示' }];

function Segmented<T extends string>({ id, value, options, onChange }: { id: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(o => (
        <button type="button" key={o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {value === o.id && <motion.span layoutId={`seg-${id}`} className="seg-thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span className="seg-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <motion.span layout transition={{ type: 'spring', stiffness: 700, damping: 35 }} />
    </button>
  );
}

export function Settings() {
  const { host, store } = useApp();
  const toast = useToast();
  const settings = useStore(store, s => s.settings);
  const list = useStore(store, s => s.executors);
  const busy = useStore(store, s => s.busy);
  const prefs = usePrefs(host);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { void store.refreshExecutors(); }, [store]);
  useEffect(() => {
    if (settings) { const { hasApiKey: _, ...rest } = settings; setForm({ ...rest, apiKey: '' }); }
  }, [settings]);

  const patch = useMemo(() => {
    if (!form || !settings) return {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form)) {
      if (key === 'apiKey') { if (value) out.apiKey = value; continue; }
      if (value !== settings[key as keyof SettingsType]) out[key] = value;
    }
    return out;
  }, [form, settings]);
  const dirty = Object.keys(patch).length > 0;

  if (!form || !settings) return <div className="settings loading"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(f => f && { ...f, [key]: value });

  async function save() {
    setSaving(true);
    try {
      store.setSettings(await store.api.updateSettings(patch as Partial<SettingsType> & { apiKey?: string }));
      void store.refreshExecutors();
      toast('设置已保存', 'success');
    } catch (error) {
      toast(error instanceof ApiError && error.status === 409 ? '大肥鱼正忙，等这轮对话结束再保存' : error instanceof Error ? error.message : '保存失败', 'error');
    } finally { setSaving(false); }
  }

  return (
    <div className="settings">
      <div className="settings-scroll">
        <GettingStarted />
        <WorkspaceSettings />
        <section className="group">
          <h4 id="model-settings">大肥鱼的大脑</h4>
          <Segmented id="runtime" value={form.runtime} options={runtimes} onChange={v => set('runtime', v)} />
          <p className="hint">{runtimes.find(r => r.id === form.runtime)?.hint}</p>
          <label className="field"><span>DeepSeek API Key</span>
            <input type="password" autoComplete="off" value={form.apiKey} onChange={e => set('apiKey', e.target.value)}
              placeholder={settings.hasApiKey ? '已设置（留空则不修改）' : 'sk-…'} />
          </label>
          <div className="row2">
            <label className="field"><span>模型</span><input value={form.model} onChange={e => set('model', e.target.value)} /></label>
            <label className="field"><span>怎么称呼你</span><input value={form.nickname} maxLength={60} onChange={e => set('nickname', e.target.value)} placeholder="你希望的称呼" /></label>
          </div>
          <label className="field"><span>接口地址</span><input value={form.baseUrl} onChange={e => set('baseUrl', e.target.value)} /></label>
        </section>

        <section className="group">
          <h4>干活的手</h4>
<div className="pref"><span>Claude Code 完全访问</span><Toggle label="Claude Code 完全访问" on={!!form.claudeFullAccess} onChange={v=>set("claudeFullAccess",v)}/></div>
<p className="hint">开启后允许执行命令并跳过工具确认，可访问当前 Windows 用户有权限的文件；不能解除系统或组织策略。默认关闭，对新任务生效。</p>
          <Segmented id="exec" value={form.defaultExecutor} options={executors} onChange={v => set('defaultExecutor', v)} />
          <div className="exec-status">
            {list.map(e => (
              <div key={e.id} className={`exec-row ${e.available ? 'ok' : 'no'}`} title={e.detail}>
                <i />{e.name}<small>{e.available ? '已找到' : '未找到'}</small>
              </div>
            ))}
          </div>
          <label className="field"><span>工作目录（绝对路径）</span><input value={form.workspace} onChange={e => set('workspace', e.target.value)} /></label>
          {host.kind==='electron'&&<button className="btn" onClick={()=>void host.chooseFolder().then(path=>{if(path)set('workspace',path);})}>选择文件夹</button>}
          <div className="row2">
            <label className="field"><span>Codex 路径</span><input value={form.codexPath} onChange={e => set('codexPath', e.target.value)} placeholder="自动查找" /></label>
            <label className="field"><span>Claude 路径</span><input value={form.claudePath} onChange={e => set('claudePath', e.target.value)} placeholder="自动查找" /></label>
            <label className="field"><span>ZCode 路径</span><input value={form.zcodePath} onChange={e => set('zcodePath', e.target.value)} placeholder="自动查找，或填写 ZCode.exe / zcode.cjs 路径" /></label>
          </div>
          <p className="hint">ZCode 使用自身配置的模型，任务模型留空。允许文件编辑，禁用 Bash；需要交互批准的操作会失败或超时。</p>
          <div className="row2">
            <label className="field"><span>执行模型</span><input value={form.executorModel} onChange={e => set('executorModel', e.target.value)} placeholder="默认" /></label>
            <label className="field"><span>任务超时（分钟）</span>
              <input type="number" min={1} max={240} value={form.taskTimeoutMinutes} onChange={e => set('taskTimeoutMinutes', Number(e.target.value) || 1)} />
            </label>
          </div>
        </section>

        <section className="group">
          <h4>桌宠</h4>
          <div className="pref"><span>专注模式（暂停主动闲聊和走动）</span><Toggle label="专注模式" on={!!prefs.focus} onChange={v=>host.prefs.set({focus:v})}/></div>
          <div className="pref"><span>大小</span>
            <Segmented<PetSize> id="size" value={prefs.size} options={[{ id: 's', label: '小' }, { id: 'm', label: '标准' }, { id: 'l', label: '大' }]} onChange={v => host.prefs.set({ size: v })} />
          </div>
          <div className="pref"><span>空闲时自由散步</span><Toggle label="自由散步" on={prefs.walk} onChange={v => host.prefs.set({ walk: v })} /></div>
          <div className="pref"><span>保持在最上层</span><Toggle label="保持置顶" on={prefs.topmost} onChange={v => host.prefs.set({ topmost: v })} /></div>
        </section>

        <section className="group about">
          <h4>关于</h4>
          <p>角色立绘来自 <a href="https://github.com/1190fasheqi/dafeiyu-pet" onClick={e => { e.preventDefault(); host.openExternal('https://github.com/1190fasheqi/dafeiyu-pet'); }}>1190fasheqi/dafeiyu-pet</a>（MIT），同人形象，与 DeepSeek 官方无关。</p>
        </section>
      </div>

      <motion.div className="save-bar" initial={false} animate={{ y: dirty ? 0 : 80, opacity: dirty ? 1 : 0 }} transition={{ type: 'spring', stiffness: 460, damping: 36 }}>
        <span>{busy ? '大肥鱼正忙，稍后才能保存' : '有未保存的修改'}</span>
        <button className="btn ghost" onClick={() => { const { hasApiKey: _, ...rest } = settings; setForm({ ...rest, apiKey: '' }); }}>还原</button>
        <button className="btn primary" disabled={saving || busy} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
      </motion.div>
    </div>
  );
}
