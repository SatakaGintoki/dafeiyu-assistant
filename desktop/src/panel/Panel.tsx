import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context';
import { useStore } from '../lib/store';
import type { PanelTab } from '../lib/types';
import { SPRITES } from '../pet/sprites';
import { IconChat, IconClose, IconSettings, IconTasks } from '../ui/icons';
import { ToastProvider } from '../ui/toast';
import { Chat } from './Chat';
import { Settings } from './Settings';
import { Tasks } from './Tasks';

const tabs: { id: PanelTab; label: string; Icon: typeof IconChat }[] = [
  { id: 'chat', label: '对话', Icon: IconChat },
  { id: 'tasks', label: '任务', Icon: IconTasks },
  { id: 'settings', label: '设置', Icon: IconSettings },
];
const order: Record<PanelTab, number> = { chat: 0, tasks: 1, settings: 2 };

export function Panel({ initialTab = 'chat', embedded = false }: { initialTab?: PanelTab; embedded?: boolean }) {
  const { host, store } = useApp();
  const [tab, setTab] = useState<PanelTab>(initialTab);
  const [direction, setDirection] = useState(1);
  const [focusTask, setFocusTask] = useState<string>();
  const [shown, setShown] = useState(0); // bumps on every open so the card replays its entrance
  const connection = useStore(store, s => s.connection);
  const busy = useStore(store, s => s.busy);
  const petState = useStore(store, s => s.petState);
  const activeCount = useStore(store, s => s.tasks.filter(t => t.status === 'queued' || t.status === 'running' || t.status === 'cancelling').length);

  const go = useCallback((next: PanelTab) => {
    setTab(current => { setDirection(order[next] >= order[current] ? 1 : -1); return next; });
  }, []);
  useEffect(() => host.panel.onOpen(next => { setShown(n => n + 1); if (next) go(next); }), [host, go]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.sheet')) host.panel.hide();
      if ((e.ctrlKey || e.metaKey) && ['1', '2', '3'].includes(e.key)) go(tabs[Number(e.key) - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [host, go]);

  const status = connection !== 'online' ? { dot: 'off', text: connection === 'connecting' ? '连接中…' : '离线' }
    : busy ? { dot: 'think', text: '思考中…' }
    : activeCount ? { dot: 'work', text: `${activeCount} 个任务进行中` }
    : { dot: 'on', text: petState === 'waiting' ? '等待中' : '在线 · 随时待命' };

  return (
    <ToastProvider>
      <motion.div key={shown} className={`panel ${embedded ? 'embedded' : ''}`}
        initial={{ opacity: 0, scale: 0.94, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
        <header className="panel-head">
          <div className="who">
            <span className="avatar big"><span className="avatar-face"><img src={SPRITES.front.src} alt="" draggable={false} /></span><i className={`presence ${status.dot}`} /></span>
            <div>
              <h1>大肥鱼</h1>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.p key={status.text} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                  {status.text}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>
          <button className="icon-btn close" onClick={() => host.panel.hide()} aria-label="收起"><IconClose size={16} /></button>
        </header>

        <nav className="tabs" role="tablist">
          {tabs.map(({ id, label, Icon }) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => go(id)}>
              {tab === id && <motion.span layoutId="tab-thumb" className="tab-thumb" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
              <span className="tab-label"><Icon size={16} />{label}{id === 'tasks' && activeCount > 0 && <em>{activeCount}</em>}</span>
            </button>
          ))}
        </nav>

        <main className="panel-body">
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <motion.section key={tab} className="page" custom={direction}
              variants={{
                enter: (d: number) => ({ x: d * 40, opacity: 0 }),
                center: { x: 0, opacity: 1 },
                exit: (d: number) => ({ x: d * -40, opacity: 0 }),
              }}
              initial="enter" animate="center" exit="exit" transition={{ type: 'spring', stiffness: 420, damping: 40, opacity: { duration: 0.16 } }}>
              {tab === 'chat' && <Chat active={tab === 'chat'} onOpenTask={id => { setFocusTask(id); go('tasks'); }} onSettings={() => go('settings')} />}
              {tab === 'tasks' && <Tasks focusId={focusTask} onFocused={() => setFocusTask(undefined)} />}
              {tab === 'settings' && <Settings />}
            </motion.section>
          </AnimatePresence>
        </main>
      </motion.div>
    </ToastProvider>
  );
}
