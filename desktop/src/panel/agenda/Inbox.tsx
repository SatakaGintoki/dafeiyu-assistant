import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { AgendaItem, AgendaNotification, AgendaSnapshot } from '../../../../shared/agenda';
import { useApp } from '../../context';
import { addDays, dayRange, formatInstant, fromLocalInput, todayIn, toLocalInput } from '../../lib/agendaTime';
import { IconBell } from '../../ui/icons';
import { projectName, useAction } from './common';

function snoozeChoices(tz: string, now: number) {
  const today = todayIn(tz, now);
  const at = (date: string, time: string) => fromLocalInput(`${date}T${time}`, tz)!;
  const tonight = at(today, '20:00');
  return [
    { label: '10 分钟后', until: new Date(now + 10 * 60000).toISOString() },
    { label: '1 小时后', until: new Date(now + 60 * 60000).toISOString() },
    ...(Date.parse(tonight) > now + 10 * 60000 ? [{ label: '今晚 20:00', until: tonight }] : []),
    { label: '明早 09:00', until: at(addDays(today, 1), '09:00') },
  ];
}

/**
 * Persistent reminder inbox. "知道了" only dismisses the reminder; completing the item is a separate,
 * explicit action. Every button reads the latest revision from the snapshot at click time.
 */
export function ReminderInbox({ snapshot, focusId, onOpenItem }: { snapshot: AgendaSnapshot; focusId?: string; onOpenItem: (item: AgendaItem) => void }) {
  const pending = snapshot.notifications.filter(n => n.status === 'pending').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const snoozed = snapshot.notifications.filter(n => n.status === 'snoozed').sort((a, b) => (a.snoozedUntil ?? '').localeCompare(b.snoozedUntil ?? ''));
  const [showSnoozed, setShowSnoozed] = useState(false);
  useEffect(() => {
    if (!focusId) return;
    if (snoozed.some(n => n.id === focusId)) setShowSnoozed(true);
    requestAnimationFrame(() => document.getElementById(`reminder-${focusId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, [focusId]);
  if (!pending.length && !snoozed.length) return null;
  return (
    <section className="ag-inbox" aria-label="提醒收件箱">
      <AnimatePresence initial={false}>
        {pending.map(n => <ReminderCard key={n.id} n={n} snapshot={snapshot} focused={n.id === focusId} onOpenItem={onOpenItem} />)}
      </AnimatePresence>
      {snoozed.length > 0 && (
        <button className="ag-snoozed-toggle" onClick={() => setShowSnoozed(v => !v)}>
          {showSnoozed ? '收起' : `已延后 ${snoozed.length} 条提醒`}
        </button>
      )}
      {showSnoozed && snoozed.map(n => <ReminderCard key={n.id} n={n} snapshot={snapshot} focused={n.id === focusId} onOpenItem={onOpenItem} />)}
    </section>
  );
}

function ReminderCard({ n, snapshot, focused, onOpenItem }: { n: AgendaNotification; snapshot: AgendaSnapshot; focused: boolean; onOpenItem: (item: AgendaItem) => void }) {
  const { agenda, store } = useApp();
  const { pending, act } = useAction();
  const [menu, setMenu] = useState(false);
  const [custom, setCustom] = useState('');
  const item = snapshot.items.find(i => i.id === n.itemId);
  const viewer = snapshot.preferences.timezone;
  const tz = item?.timezone ?? viewer;
  const when = n.occurrenceAt ? `开始 ${formatInstant(n.occurrenceAt, tz, viewer)}` : item?.dueAt ? `截止 ${formatInstant(item.dueAt, tz, viewer)}` : `提醒 ${formatInstant(n.scheduledAt, tz, viewer)}`;
  const revision = () => agenda.notification(n.id)?.revision ?? n.revision;

  const acknowledge = () => act(() => agenda.run('notifications', key => store.api.agenda.acknowledge(n.id, revision(), key)), '已收到；事务本身没有标为完成');
  const snooze = (until: string) => { setMenu(false); return act(() => agenda.run('notifications', key => store.api.agenda.snooze(n.id, revision(), until, key)), `将在 ${formatInstant(until, viewer)} 再提醒`); };
  const complete = () => act(() => {
    const latest = agenda.item(n.itemId);
    if (!latest) throw new Error('找不到对应事务');
    return agenda.run('items', key => store.api.agenda.updateItem(latest.id, { revision: latest.revision, status: 'done' }, key));
  }, '事务已完成，相关提醒已一并取消');

  return (
    <motion.article id={`reminder-${n.id}`} layout className={`ag-reminder ${n.status} ${focused ? 'focused' : ''}`}
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <div className="ag-reminder-head">
        <span className="ag-bell"><IconBell size={15} /></span>
        <div className="task-main">
          <div className="task-title">{n.title}</div>
          <div className="task-meta">
            <span>{when}</span>
            {item && <span className="tag">{projectName(snapshot, item.projectId)}</span>}
            {n.status === 'snoozed' && n.snoozedUntil && <span>· 延后至 {formatInstant(n.snoozedUntil, viewer)}</span>}
          </div>
        </div>
      </div>
      <div className="ag-reminder-actions">
        <button className="btn" disabled={pending} onClick={() => void acknowledge()}>知道了</button>
        <button className="btn" disabled={pending} onClick={() => setMenu(v => !v)} aria-expanded={menu}>稍后提醒</button>
        {/* Completing a repeating event would end the whole series, so that only happens from the editor with a warning. */}
        {item?.status === 'open' && !item.recurrence && <button className="btn" disabled={pending} onClick={() => void complete()}>完成事务</button>}
        {item && <button className="btn ghost" onClick={() => onOpenItem(item)}>查看</button>}
      </div>
      {menu && (
        <div className="ag-snooze">
          {snoozeChoices(viewer, Date.now()).map(c => <button key={c.label} className="chip" disabled={pending} onClick={() => void snooze(c.until)}>{c.label}</button>)}
          <div className="ag-inline">
            <input type="datetime-local" value={custom} min={toLocalInput(new Date().toISOString(), viewer)} max={toLocalInput(dayRange(addDays(todayIn(viewer), 365), viewer).from, viewer)} onChange={e => setCustom(e.target.value)} />
            <button className="btn" disabled={pending || !custom} onClick={() => { const until = fromLocalInput(custom, viewer); if (until) void snooze(until); }}>确定</button>
          </div>
        </div>
      )}
    </motion.article>
  );
}
