import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context';
import { useStore } from '../lib/store';
import type { Message, Task } from '../lib/types';
import { SPRITES } from '../pet/sprites';
import { executorName } from '../pet/lines';
import { IconChevron, IconKey, IconPower, IconSend, IconStop } from '../ui/icons';
import { useToast } from '../ui/toast';
import { Markdown } from './Markdown';
import { StatusIcon, statusLabel } from './StatusIcon';

const suggestions = ['你都能帮我做什么？', '帮我看看当前工作目录的项目结构', '写个脚本整理下载文件夹', '最近的任务进展如何？'];

function time(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function Chat({ onOpenTask, onSettings, active }: { onOpenTask: (id: string) => void; onSettings: () => void; active: boolean }) {
  const { host, store } = useApp();
  const toast = useToast();
  const messages = useStore(store, s => s.messages);
  const tasks = useStore(store, s => s.tasks);
  const busy = useStore(store, s => s.busy);
  const progress = useStore(store, s => s.progress);
  const connection = useStore(store, s => s.connection);
  const settings = useStore(store, s => s.settings);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  // The first scroll after the panel opens must not animate: the open animation
  // changes the list height, so animating there plays the whole history sliding by.
  // Opening lands on the newest message; only messages after that glide.
  const landed = useRef(false);
  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const visible = useMemo(() => messages.filter(m => m.content.trim() || m.taskId), [messages]);

  // Stay pinned to the bottom unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !stick.current) return;
    const first = !landed.current && el.scrollHeight > el.clientHeight;
    el.scrollTo({ top: el.scrollHeight, behavior: first ? 'instant' : 'smooth' });
    if (first) landed.current = true;
  }, [visible.length, busy, progress]);
  useEffect(() => {
    if (!active) return;
    landed.current = false;
    stick.current = true;
    inputRef.current?.focus();
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
  }, [active]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [draft]);

  const offline = connection !== 'online';
  const needsKey = !!settings && settings.runtime !== 'demo' && !settings.hasApiKey;

  async function send(text = draft) {
    const message = text.trim();
    if (!message || busy || sending || offline) return;
    setSending(true);
    stick.current = true;
    try {
      store.markBusy();
      await store.api.chat(message);
      setDraft('');
    } catch (error) {
      void store.sync();
      toast(error instanceof Error ? error.message : '发送失败', 'error');
    } finally {
      setSending(false);
    }
  }
  async function stop() {
    try { await store.api.cancelChat(); } catch (error) { toast(error instanceof Error ? error.message : '取消失败', 'error'); }
  }
  async function useDemo() {
    try { store.setSettings(await store.api.updateSettings({ runtime: 'demo' })); toast('已切换到演示模式', 'success'); }
    catch (error) { toast(error instanceof Error ? error.message : '切换失败', 'error'); }
  }

  return (
    <div className="chat">
      <AnimatePresence initial={false}>
        {offline && (
          <motion.div key="off" className="banner warn" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="banner-inner">
              <IconPower size={16} />
              <span>{connection === 'unauthorized' ? '本地令牌无效，请重启后端' : connection === 'connecting' ? '正在连接后端…' : '后端没有运行'}</span>
              {connection === 'offline' && host.kind === 'electron' && (
                <button onClick={async () => { const r = await host.startBackend(); toast(r.ok ? '后端已启动' : r.error || '启动失败', r.ok ? 'success' : 'error'); }}>启动</button>
              )}
            </div>
          </motion.div>
        )}
        {!offline && needsKey && (
          <motion.div key="key" className="banner info" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="banner-inner">
              <IconKey size={16} />
              <span>还没有设置 DeepSeek API Key</span>
              <button onClick={onSettings}>去设置</button>
              <button className="ghost" onClick={useDemo}>先用演示</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="chat-list" ref={listRef}
        onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {visible.length === 0 && (
          <motion.div className="chat-empty" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <img src={SPRITES.front.src} alt="" draggable={false} />
            <h3>今天想让大肥鱼做点什么？</h3>
            <p>聊天、查进度，或者把写代码的活交给 Codex / Claude Code。</p>
            <div className="chips">
              {suggestions.map((s, i) => (
                <motion.button key={s} className="chip" onClick={() => void send(s)} disabled={offline}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.05 }}>{s}</motion.button>
              ))}
            </div>
          </motion.div>
        )}
        <AnimatePresence initial={false}>
          {visible.map(m => (
            <MessageRow key={m.id} message={m} task={m.taskId ? taskById.get(m.taskId) : undefined} onOpenTask={onOpenTask} />
          ))}
          {busy && (
            <motion.div key="typing" className="row assistant" layout="position"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
              <Avatar />
              <div className="msg typing">
                <span className="dots"><i /><i /><i /></span>
                {progress && <span className="typing-text">{progress}</span>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={`composer ${draft.trim() ? 'has-text' : ''}`}>
        <textarea ref={inputRef} rows={1} value={draft} placeholder={offline ? '后端离线中…' : '和大肥鱼说点什么…（Enter 发送，Shift+Enter 换行）'}
          onChange={e => setDraft(e.target.value)} disabled={offline}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); }
          }} />
        <motion.button className={`send ${busy ? 'stop' : ''}`} aria-label={busy ? '停止' : '发送'}
          disabled={!busy && (!draft.trim() || offline || sending)} onClick={() => busy ? void stop() : void send()}
          whileTap={{ scale: 0.88 }} layout>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={busy ? 'stop' : 'send'} initial={{ scale: 0.3, opacity: 0, rotate: -90 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.3, opacity: 0, rotate: 90 }} transition={{ type: 'spring', stiffness: 600, damping: 30 }}>
              {busy ? <IconStop size={18} /> : <IconSend size={18} />}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>
    </div>
  );
}

function Avatar() {
  return <span className="avatar"><span className="avatar-face"><img src={SPRITES.front.src} alt="" draggable={false} /></span></span>;
}

function MessageRow({ message, task, onOpenTask }: { message: Message; task?: Task; onOpenTask: (id: string) => void }) {
  const spring = { type: 'spring' as const, stiffness: 460, damping: 32 };
  if (message.role === 'system') {
    return (
      <motion.div className="row system" layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <span>{message.content}</span>
      </motion.div>
    );
  }
  const mine = message.role === 'user';
  return (
    <motion.div className={`row ${message.role}`} layout="position"
      initial={{ opacity: 0, y: 14, scale: 0.97, x: mine ? 12 : -12 }} animate={{ opacity: 1, y: 0, scale: 1, x: 0 }} transition={spring}>
      {!mine && <Avatar />}
      <div className="msg-col">
        {message.content.trim() && (
          <div className="msg" title={time(message.createdAt)}>
            {mine ? <p className="plain">{message.content}</p> : <Markdown text={message.content} />}
          </div>
        )}
        {task && (
          <button className="task-chip" onClick={() => onOpenTask(task.id)}>
            <StatusIcon status={task.status} size={16} />
            <span className="task-chip-title">{task.title}</span>
            <span className="task-chip-meta">{executorName[task.executor] ?? task.executor} · {statusLabel[task.status]}</span>
            <IconChevron size={14} />
          </button>
        )}
      </div>
    </motion.div>
  );
}
