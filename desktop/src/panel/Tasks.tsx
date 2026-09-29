import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context';
import { useStore } from '../lib/store';
import type { Executor, Task } from '../lib/types';
import { executorName } from '../pet/lines';
import { IconClose, IconFolder, IconPlus, IconReply, IconRetry, IconStop, IconTerminal } from '../ui/icons';
import { useToast } from '../ui/toast';
import { Markdown } from './Markdown';
import { StatusIcon, statusLabel } from './StatusIcon';

type Filter = 'all' | 'active' | 'done' | 'failed';
const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'active', label: '进行中' }, { id: 'done', label: '已完成' }, { id: 'failed', label: '未成功' },
];
const active = new Set(['queued', 'running', 'cancelling']);
const unsuccessful = new Set(['failed', 'cancelled', 'interrupted']);

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return '刚刚';
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
  return `${Math.round(s / 86400)} 天前`;
}
function elapsed(task: Task) {
  const end = active.has(task.status) ? Date.now() : new Date(task.updatedAt).getTime();
  const s = Math.max(0, Math.round((end - new Date(task.createdAt).getTime()) / 1000));
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

export function Tasks({ focusId, onFocused }: { focusId?: string; onFocused: () => void }) {
  const { store } = useApp();
  const tasks = useStore(store, s => s.tasks);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!focusId) return;
    setFilter('all'); setOpen(focusId); onFocused();
    requestAnimationFrame(() => document.getElementById(`task-${focusId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, [focusId, onFocused]);
  useEffect(() => { const t = window.setInterval(() => tick(n => n + 1), 1000); return () => window.clearInterval(t); }, []);

  const counts = useMemo(() => ({
    all: tasks.length,
    active: tasks.filter(t => active.has(t.status)).length,
    done: tasks.filter(t => t.status === 'succeeded').length,
    failed: tasks.filter(t => unsuccessful.has(t.status)).length,
  }), [tasks]);
  const list = useMemo(() => [...tasks]
    .filter(t => filter === 'all' || (filter === 'active' ? active.has(t.status) : filter === 'done' ? t.status === 'succeeded' : unsuccessful.has(t.status)))
    .sort((a, b) => Number(active.has(b.status)) - Number(active.has(a.status)) || b.createdAt.localeCompare(a.createdAt)), [tasks, filter]);

  return (
    <div className="tasks">
      <div className="tasks-bar">
        <div className="segmented small">
          {filters.map(f => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {filter === f.id && <motion.span layoutId="task-filter" className="seg-thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <span className="seg-label">{f.label}{counts[f.id] > 0 && <em>{counts[f.id]}</em>}</span>
            </button>
          ))}
        </div>
        <motion.button className="icon-btn primary" onClick={() => setCreating(true)} whileTap={{ scale: 0.9 }} title="新任务" aria-label="新任务">
          <IconPlus size={18} />
        </motion.button>
      </div>

      <div className="task-list">
        <LayoutGroup>
          <AnimatePresence initial={false} mode="popLayout">
            {list.map(task => (
              <TaskCard key={task.id} task={task} open={open === task.id} onToggle={() => setOpen(open === task.id ? null : task.id)} />
            ))}
          </AnimatePresence>
        </LayoutGroup>
        {list.length === 0 && (
          <motion.div className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <IconTerminal size={30} />
            <p>{filter === 'all' ? '还没有任务。在对话里说「帮我…」，或点右上角新建。' : '这里空空的～'}</p>
          </motion.div>
        )}
      </div>

      <AnimatePresence>{creating && <NewTask onClose={() => setCreating(false)} onCreated={id => { setOpen(id); setFilter('all'); }} />}</AnimatePresence>
    </div>
  );
}

function TaskCard({ task, open, onToggle }: { task: Task; open: boolean; onToggle: () => void }) {
  const { store } = useApp();
  const toast = useToast();
  const [followup, setFollowup] = useState('');
  const [pending, setPending] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [task.logs.length, open]);

  async function act(run: () => Promise<Task>, done: string) {
    setPending(true);
    try { store.replaceTask(await run()); toast(done, 'success'); }
    catch (error) { toast(error instanceof Error ? error.message : '操作失败', 'error'); }
    finally { setPending(false); }
  }

  const isActive = active.has(task.status);
  const canRetry = unsuccessful.has(task.status);
  return (
    <motion.article id={`task-${task.id}`} layout className={`task-card st-${task.status} ${open ? 'open' : ''}`}
      initial={{ opacity: 0, y: -10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
      <motion.button layout="position" className="task-head" onClick={onToggle} aria-expanded={open}>
        <StatusIcon status={task.status} />
        <div className="task-main">
          <div className="task-title">{task.title}</div>
          <div className="task-meta">
            <span className={`exec exec-${task.executor}`}>{executorName[task.executor] ?? task.executor}</span>
            <span>{statusLabel[task.status]}</span>
            <span>·</span>
            <span>{isActive ? `已用 ${elapsed(task)}` : ago(task.updatedAt)}</span>
          </div>
        </div>
        <motion.span className="chev" animate={{ rotate: open ? 90 : 0 }}>›</motion.span>
      </motion.button>
      {isActive && <div className="task-progress"><span /></div>}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="task-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}>
            <div className="task-body-inner">
              <section>
                <h5>指令</h5>
                <p className="instruction">{task.instruction}</p>
                {task.workspace && <p className="workspace"><IconFolder size={13} />{task.workspace}</p>}
              </section>
              {task.logs.length > 0 && (
                <section>
                  <h5>过程 {isActive && <span className="live">LIVE</span>}</h5>
                  <pre className="logs" ref={logRef}>{task.logs.map((l, i) => <div key={i}>{l}</div>)}</pre>
                </section>
              )}
              {task.result && <section><h5>结果</h5><div className="result"><Markdown text={task.result} /></div></section>}
              {task.error && <section><h5>错误</h5><p className="error-text">{task.error}</p></section>}
              <div className="task-actions">
                {isActive && task.status !== 'cancelling' && (
                  <button className="btn danger" disabled={pending} onClick={() => act(() => store.api.cancelTask(task.id), '已请求取消')}>
                    <IconStop size={14} />取消
                  </button>
                )}
                {canRetry && (
                  <button className="btn" disabled={pending} onClick={() => act(() => store.api.retryTask(task.id), '已重新排队')}>
                    <IconRetry size={14} />重试
                  </button>
                )}
              </div>
              {!isActive && (
                <form className="followup" onSubmit={e => {
                  e.preventDefault();
                  const text = followup.trim();
                  if (!text) return;
                  void act(() => store.api.followup(task.id, text), '跟进任务已创建').then(() => setFollowup(''));
                }}>
                  <IconReply size={15} />
                  <input value={followup} onChange={e => setFollowup(e.target.value)} placeholder="补充要求，继续跟进…" maxLength={8000} />
                  <button className="btn primary" disabled={!followup.trim() || pending}>跟进</button>
                </form>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function NewTask({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { store } = useApp();
  const toast = useToast();
  const executors = useStore(store, s => s.executors);
  const settings = useStore(store, s => s.settings);
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [executor, setExecutor] = useState<Executor | ''>('');
  const [pending, setPending] = useState(false);
  useEffect(() => { void store.refreshExecutors(); }, [store]);
  const chosen = executor || settings?.defaultExecutor || 'codex';

  async function submit() {
    if (!title.trim() || !instruction.trim()) return;
    setPending(true);
    try {
      const task = await store.api.createTask({ title: title.trim(), instruction: instruction.trim(), executor: chosen });
      store.replaceTask(task);
      onCreated(task.id);
      toast('任务已创建', 'success');
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : '创建失败', 'error');
    } finally { setPending(false); }
  }

  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div className="sheet" role="dialog" aria-label="新任务"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 420, damping: 40 }}>
        <div className="sheet-grip" />
        <header><h3>交给大肥鱼一个任务</h3><button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={16} /></button></header>
        <label className="field"><span>标题</span>
          <input autoFocus value={title} maxLength={160} onChange={e => setTitle(e.target.value)} placeholder="例如：修复登录页样式" />
        </label>
        <label className="field"><span>具体要求</span>
          <textarea rows={5} value={instruction} maxLength={24000} onChange={e => setInstruction(e.target.value)}
            placeholder="描述要做什么、在哪、做到什么程度…"
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(); }} />
        </label>
        <div className="field"><span>执行者</span>
          <div className="exec-pick">
            {(executors.length ? executors : (['codex', 'claude', 'zcode', 'demo'] as Executor[]).map(id => ({ id, name: executorName[id], available: true, detail: '' }))).map(e => (
              <button key={e.id} type="button" className={chosen === e.id ? 'on' : ''} disabled={!e.available} title={e.detail} onClick={() => setExecutor(e.id)}>
                <b>{e.name}</b><small>{e.available ? (e.id === settings?.defaultExecutor ? '默认' : '可用') : '未安装'}</small>
              </button>
            ))}
          </div>
        </div>
        <button className="btn primary block" disabled={pending || !title.trim() || !instruction.trim()} onClick={() => void submit()}>
          {pending ? '创建中…' : '开始执行'}
        </button>
      </motion.div>
    </>
  );
}
