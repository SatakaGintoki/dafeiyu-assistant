import { AnimatePresence } from 'motion/react';
import { useEffect, useState } from 'react';
import type { AgendaItem, AgendaPlan, AgendaPreferences, AgendaProject } from '../../../../shared/agenda';
import { useApp } from '../../context';
import { useAgenda } from '../../lib/agenda';
import type { ItemForm } from '../../lib/agendaForm';
import { formatInstant, validTimezone } from '../../lib/agendaTime';
import type { NotifierStatus } from '../../lib/host';
import { useStore } from '../../lib/store';
import { IconCalendar, IconPlus, IconSettings } from '../../ui/icons';
import { useToast } from '../../ui/toast';
import { errorText, Sheet, TimezoneInput, useNow } from './common';
import { ReminderInbox } from './Inbox';
import { ItemEditor } from './ItemEditor';
import { PlanEditor, PlansView } from './Plans';
import { ProjectEditor, ProjectsView } from './Projects';
import { TodayView, UnscheduledView, WeekView } from './Views';

type View = 'today' | 'week' | 'projects' | 'unscheduled' | 'plans';
const views: { id: View; label: string }[] = [
  { id: 'today', label: '今天' }, { id: 'week', label: '本周' }, { id: 'projects', label: '项目' },
  { id: 'unscheduled', label: '未安排' }, { id: 'plans', label: '计划' },
];
type Editing =
  | { type: 'item'; item?: AgendaItem; defaults?: Partial<ItemForm> }
  | { type: 'project'; project?: AgendaProject }
  | { type: 'plan'; plan?: AgendaPlan }
  | { type: 'prefs' };

export function Agenda({ focusReminder, onFocused }: { focusReminder?: string; onFocused: () => void }) {
  const { agenda, store, host } = useApp();
  const status = useAgenda(agenda, s => s.status);
  const snapshot = useAgenda(agenda, s => s.snapshot);
  const error = useAgenda(agenda, s => s.error);
  const connection = useStore(store, s => s.connection);
  const now = useNow();
  const [view, setView] = useState<View>('today');
  const [project, setProject] = useState<string | null | undefined>();
  const [editing, setEditing] = useState<Editing>();
  const [focus, setFocus] = useState<string>();
  const [notifier, setNotifier] = useState<NotifierStatus>();
  const [starting, setStarting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    void host.reminders.status().then(s => { if (alive) setNotifier(s); }).catch(() => {});
    const off = host.reminders.onStatus(setNotifier);
    return () => { alive = false; off(); };
  }, [host]);
  useEffect(() => {
    if (!focusReminder) return;
    setFocus(focusReminder); setEditing(undefined); onFocused();
    // Re-read in case the reminder arrived before the last snapshot.
    void agenda.refresh();
  }, [focusReminder, onFocused, agenda]);

  const open = (item: AgendaItem) => setEditing({ type: 'item', item });
  const newItem = () => setEditing({ type: 'item', defaults: view === 'projects' && project ? { projectId: project } : undefined });

  if (status === 'loading' && !snapshot) return <div className="agenda loading"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>;

  const banners: { tone: 'warn' | 'info'; text: string; action?: { label: string; run: () => void } }[] = [];
  if (status === 'unauthorized') banners.push({ tone: 'warn', text: '本地令牌无效，事务同步已暂停。请重启后端或检查令牌后重新连接。', action: { label: '重新连接', run: () => void agenda.refresh() } });
  else if (connection === 'offline') banners.push({ tone: 'warn', text: '后端离线：提醒不会按时触发，下面的内容可能不是最新的。后端恢复后会补查错过的提醒。', action: host.kind === 'electron' ? { label: starting ? '启动中…' : '启动后端', run: () => { setStarting(true); void host.startBackend().then(r => { if (!r.ok) toast(r.error || '启动失败', 'error'); }).finally(() => setStarting(false)); } } : undefined });
  else if (error && snapshot) banners.push({ tone: 'warn', text: `刷新失败：${error}。显示的是上次读取的内容。`, action: { label: '重试', run: () => void agenda.refresh() } });
  if (snapshot?.scheduler.lastError) banners.push({ tone: 'warn', text: `提醒检查异常：${snapshot.scheduler.lastError}` });
  else if (snapshot && !snapshot.scheduler.running && connection === 'online') banners.push({ tone: 'warn', text: '提醒调度器没有运行，到点不会提醒。请重启后端。' });
  if (host.reminders.mode === 'system' && notifier?.error) banners.push({ tone: 'info', text: `${notifier.error}。提醒仍会显示在这里。` });

  if (!snapshot) {
    return (
      <div className="agenda">
        {banners.map((b, i) => <Banner key={i} {...b} />)}
        <div className="empty"><IconCalendar size={30} /><p>{error || '读取事务失败'}</p><button className="btn" onClick={() => void agenda.refresh()}>重试</button></div>
      </div>
    );
  }

  return (
    <div className="agenda">
      {banners.map((b, i) => <Banner key={i} {...b} />)}
      <div className="ag-bar">
        <div className="segmented small ag-views">
          {views.map(v => {
            const count = v.id === 'plans' ? snapshot.plans.filter(p => p.status === 'draft').length : 0;
            return (
              <button key={v.id} className={view === v.id ? 'on' : ''} onClick={() => { setView(v.id); if (v.id !== 'projects') setProject(undefined); }}>
                {view === v.id && <span className="seg-thumb" />}<span className="seg-label">{v.label}{count > 0 && <em>{count}</em>}</span>
              </button>
            );
          })}
        </div>
        <button className="icon-btn" onClick={() => setEditing({ type: 'prefs' })} title="事务设置" aria-label="事务设置"><IconSettings size={16} /></button>
        <button className="icon-btn primary" onClick={newItem} title="新建事务" aria-label="新建事务"><IconPlus size={18} /></button>
      </div>
      <div className="ag-scroll">
        <ReminderInbox snapshot={snapshot} focusId={focus} onOpenItem={open} />
        {view === 'today' && <TodayView snapshot={snapshot} now={now} onOpen={open} />}
        {view === 'week' && <WeekView snapshot={snapshot} now={now} onOpen={open} />}
        {view === 'unscheduled' && <UnscheduledView snapshot={snapshot} onOpen={open} />}
        {view === 'plans' && <PlansView snapshot={snapshot} onEdit={plan => setEditing({ type: 'plan', plan })} onOpenItem={open} />}
        {view === 'projects' && <ProjectsView snapshot={snapshot} selected={project} onSelect={setProject}
          onEditProject={p => setEditing({ type: 'project', project: p })} onNewItem={id => setEditing({ type: 'item', defaults: { projectId: id ?? '' } })} onOpenItem={open} />}
      </div>
      <AnimatePresence>
        {editing?.type === 'item' && <ItemEditor key="item" item={editing.item} defaults={editing.defaults} onClose={() => setEditing(undefined)} />}
        {editing?.type === 'project' && <ProjectEditor key="project" project={editing.project} onClose={() => setEditing(undefined)} onCreated={p => { setView('projects'); setProject(p.id); }} />}
        {editing?.type === 'plan' && <PlanEditor key="plan" plan={editing.plan} onClose={() => setEditing(undefined)} />}
        {editing?.type === 'prefs' && <PreferencesEditor key="prefs" prefs={snapshot.preferences} scheduler={snapshot.scheduler} notifier={notifier} onClose={() => setEditing(undefined)} />}
      </AnimatePresence>
    </div>
  );
}

function Banner({ tone, text, action }: { tone: 'warn' | 'info'; text: string; action?: { label: string; run: () => void } }) {
  return (
    <div className={`banner ${tone}`} role="status">
      <div className="banner-inner"><span>{text}</span>{action && <button onClick={action.run}>{action.label}</button>}</div>
    </div>
  );
}

function PreferencesEditor({ prefs, scheduler, notifier, onClose }: {
  prefs: AgendaPreferences; scheduler: { running: boolean; lastTickAt: string | null; intervalMs: number }; notifier?: NotifierStatus; onClose: () => void;
}) {
  const { agenda, store, host } = useApp();
  const toast = useToast();
  const [timezone, setTimezone] = useState(prefs.timezone);
  const [quiet, setQuiet] = useState(!!prefs.quietStart);
  const [quietStart, setQuietStart] = useState(prefs.quietStart ?? '23:00');
  const [quietEnd, setQuietEnd] = useState(prefs.quietEnd ?? '08:00');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!validTimezone(timezone)) { setError('时区无效，请使用 IANA 名称，如 Asia/Shanghai'); return; }
    if (quiet && quietStart === quietEnd) { setError('免打扰开始和结束不能相同'); return; }
    setPending(true); setError('');
    try {
      // Preferences carry no revision; the backend takes the full object.
      await store.api.agenda.updatePreferences({ timezone, quietStart: quiet ? quietStart : null, quietEnd: quiet ? quietEnd : null }, `ui-${crypto.randomUUID()}`);
      await agenda.refresh();
      toast('事务设置已保存', 'success');
      onClose();
    } catch (e) { setError(errorText(e)); } finally { setPending(false); }
  }
  return (
    <Sheet title="事务设置" onClose={onClose}>
      <label className="field"><span>默认时区</span><TimezoneInput value={timezone} onChange={setTimezone} /></label>
      <p className="hint">只影响以后新建、没有指定时区的记录，以及“今天/本周”的分组；已有记录保持原来的时区。</p>
      <label className="pref"><span>免打扰</span><input type="checkbox" checked={quiet} onChange={e => setQuiet(e.target.checked)} /></label>
      {quiet && (
        <div className="row2">
          <label className="field"><span>开始</span><input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)} /></label>
          <label className="field"><span>结束</span><input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)} /></label>
        </div>
      )}
      <p className="hint">免打扰期间不触发新提醒，结束后补查；已有的提醒卡片会保留。</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn primary block" disabled={pending} onClick={() => void save()}>{pending ? '保存中…' : '保存'}</button>
      <section className="ag-diag">
        <h5>提醒状态</h5>
        <p className="hint">调度器：{scheduler.running ? `运行中，每 ${scheduler.intervalMs / 1000} 秒检查` : '未运行'}{scheduler.lastTickAt ? `，上次检查 ${formatInstant(scheduler.lastTickAt, prefs.timezone)}` : ''}。</p>
        <p className="hint">{host.reminders.mode === 'system'
          ? notifier?.supported ? `系统通知：由桌面主进程统一发送${notifier.error ? `；最近一次失败：${notifier.error}` : notifier.shown ? `，本次运行已发送 ${notifier.shown} 条` : ''}。` : '系统通知：当前系统不可用，只显示面板内提醒。'
          : '浏览器预览：只显示页面内提醒，不发送系统通知。'}</p>
        <p className="hint">大肥鱼完全退出或电脑关机时不会提醒；下次启动后补发错过的提醒（重复日程只补最近一次）。</p>
      </section>
    </Sheet>
  );
}
