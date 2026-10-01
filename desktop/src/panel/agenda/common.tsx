import { motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import type { AgendaItem, AgendaProject, AgendaSnapshot } from '../../../../shared/agenda';
import { useApp } from '../../context';
import { ApiError } from '../../lib/api';
import { formatInstant, formatTime, reminderLabel } from '../../lib/agendaTime';
import { IconBell, IconCheck, IconClose, IconNote, IconRepeat } from '../../ui/icons';
import { useToast } from '../../ui/toast';

export const kindLabel: Record<AgendaItem['kind'], string> = { todo: '待办', event: '日程', note: '笔记' };
export const INBOX = '收件箱';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div className="sheet" role="dialog" aria-label={title}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 420, damping: 40 }}>
        <div className="sheet-grip" />
        <header><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={16} /></button></header>
        {children}
      </motion.div>
    </>
  );
}

/** Re-renders every `ms` so "today" and relative labels roll over without a reload. */
export function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}

/** Turns a failed write into the message the user needs; conflicts were already re-read by the store. */
export function errorText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409) return `${error.message}。已刷新为最新内容，请确认后再操作`;
    if (error.status === 401) return '本地令牌失效，事务同步已暂停，请重新连接';
    if (error.status === 0) return '连不上本地后端，修改没有保存';
    return error.message;
  }
  return error instanceof Error ? error.message : '操作失败';
}

/** Runs a store action with pending state and toast feedback. Success is only claimed after the server answered. */
export function useAction() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  async function act<T>(run: () => Promise<T>, done?: string): Promise<T | undefined> {
    setPending(true);
    try { const result = await run(); if (done) toast(done, 'success'); return result; }
    catch (error) { toast(errorText(error), 'error'); return undefined; }
    finally { setPending(false); }
  }
  return { pending, act };
}

export function projectName(snapshot: AgendaSnapshot, id: string | null) {
  if (!id) return INBOX;
  const p = snapshot.projects.find(x => x.id === id);
  return p ? `${p.name}${p.archived ? '（已归档）' : ''}` : '未知项目';
}

export function repeatLabel(item: AgendaItem) {
  const r = item.recurrence;
  if (!r) return '';
  const days = r.weekdays?.length ? `（${r.weekdays.map(d => '一二三四五六日'[d - 1]).join('、')}）` : '';
  const base = r.frequency === 'daily' ? (r.interval === 1 ? '每天' : `每 ${r.interval} 天`) : (r.interval === 1 ? '每周' : `每 ${r.interval} 周`) + days;
  return `${base}${r.until ? `，至 ${r.until}` : ''}`;
}

/** One-line schedule summary for an item, in the item's own time zone. */
export function itemWhen(item: AgendaItem, viewerTz: string) {
  if (item.kind === 'event' && item.startsAt && item.endsAt) {
    return `${formatInstant(item.startsAt, item.timezone, viewerTz)} – ${formatTime(item.endsAt, item.timezone)}`;
  }
  if (item.kind === 'todo' && item.dueAt) return `截止 ${formatInstant(item.dueAt, item.timezone, viewerTz)}`;
  return '';
}

export function reminderText(item: AgendaItem, viewerTz: string) {
  if (item.reminderAt) return formatInstant(item.reminderAt, item.timezone, viewerTz);
  if (item.reminderMinutesBefore !== null) return reminderLabel(item.reminderMinutesBefore);
  return '';
}

/** A row in any list. `when` overrides the schedule text (e.g. a single occurrence of a repeating event). */
export function ItemRow({ item, snapshot, when, showProject = true, onOpen }: {
  item: AgendaItem; snapshot: AgendaSnapshot; when?: string; showProject?: boolean; onOpen: (item: AgendaItem) => void;
}) {
  const { agenda, store } = useApp();
  const { pending, act } = useAction();
  const tz = snapshot.preferences.timezone;
  const closed = item.status !== 'open';
  const toggle = () => act(() => {
    // Always send the latest known revision; a stale one comes back as 409 and is surfaced, not retried.
    const latest = agenda.item(item.id) ?? item;
    return agenda.run('items', key => store.api.agenda.updateItem(item.id, { revision: latest.revision, status: latest.status === 'open' ? 'done' : 'open' }, key));
  }, item.status === 'open' ? '已完成' : '已重新打开');
  const text = when ?? itemWhen(item, tz);
  const reminder = reminderText(item, tz);
  return (
    <div className={`ag-row k-${item.kind} ${closed ? 'closed' : ''}`}>
      {item.kind === 'todo'
        ? <button className={`ag-check ${item.status === 'done' ? 'on' : ''}`} disabled={pending || item.status === 'cancelled'} onClick={() => void toggle()}
            aria-label={item.status === 'done' ? '重新打开' : '标为完成'} title={item.status === 'done' ? '重新打开' : '标为完成'}>
            {item.status === 'done' && <IconCheck size={13} />}
          </button>
        : <span className={`ag-kind k-${item.kind}`} aria-hidden>{item.kind === 'note' ? <IconNote size={14} /> : <i />}</span>}
      <button className="ag-row-main" onClick={() => onOpen(item)}>
        <span className="ag-title">{item.title}</span>
        <span className="ag-meta">
          {item.status === 'cancelled' && <b className="tag muted">已取消</b>}
          {item.status === 'done' && item.kind !== 'todo' && <b className="tag muted">已完成</b>}
          {text && <span>{text}</span>}
          {showProject && <span className="tag">{projectName(snapshot, item.projectId)}</span>}
          {item.recurrence && <span className="ico" title={repeatLabel(item)}><IconRepeat size={12} /></span>}
          {reminder && item.status === 'open' && <span className="ico" title={`提醒：${reminder}`}><IconBell size={12} /></span>}
          {item.kind === 'note' && item.notes && <span className="ag-snippet">{item.notes.slice(0, 40)}</span>}
        </span>
      </button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <motion.div className="empty ag-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{children}</motion.div>;
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="ag-section">
      <h5>{title}{count !== undefined && <em>{count}</em>}</h5>
      {children}
    </section>
  );
}

export function activeProjects(snapshot: AgendaSnapshot): AgendaProject[] {
  return snapshot.projects.filter(p => !p.archived).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const zones = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } })();
export function TimezoneInput({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  return (
    <>
      <input list="ag-zones" value={value} spellCheck={false} onChange={e => onChange(e.target.value.trim())} />
      <datalist id="ag-zones">{zones.map(z => <option key={z} value={z} />)}</datalist>
    </>
  );
}
