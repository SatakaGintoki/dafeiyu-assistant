import { useMemo, useState } from 'react';
import type { AgendaItem, AgendaOccurrence, AgendaSnapshot } from '../../../../shared/agenda';
import { useApp } from '../../context';
import { useCalendar } from '../../lib/agenda';
import { addDays, dayRange, formatDate, formatInstant, formatTime, localDate, todayIn, weekStart } from '../../lib/agendaTime';
import { IconBack, IconChevron } from '../../ui/icons';
import { Empty, ItemRow, Section } from './common';

type Open = (item: AgendaItem) => void;
const byDue = (a: AgendaItem, b: AgendaItem) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '');

/** Open todos whose due instant falls in [from, to). Todos and event occurrences are listed separately. */
function dueIn(snapshot: AgendaSnapshot, from: string, to: string) {
  const archived = new Set(snapshot.projects.filter(p => p.archived).map(p => p.id));
  return snapshot.items.filter(i => i.kind === 'todo' && i.status === 'open' && i.dueAt && i.dueAt >= from && i.dueAt < to && !(i.projectId && archived.has(i.projectId))).sort(byDue);
}

function occurrenceWhen(o: AgendaOccurrence, item: AgendaItem, viewer: string) {
  const tz = item.timezone;
  const sameDay = localDate(o.startsAt, tz) === localDate(o.endsAt, tz);
  return `${formatTime(o.startsAt, tz)} – ${sameDay ? formatTime(o.endsAt, tz) : formatInstant(o.endsAt, tz)}${tz !== viewer ? ` (${tz})` : ''}`;
}

function Occurrences({ list, snapshot, onOpen }: { list: AgendaOccurrence[]; snapshot: AgendaSnapshot; onOpen: Open }) {
  return <>{list.map(o => {
    const item = snapshot.items.find(i => i.id === o.itemId);
    return item ? <ItemRow key={o.id} item={item} snapshot={snapshot} when={occurrenceWhen(o, item, snapshot.preferences.timezone)} onOpen={onOpen} /> : null;
  })}</>;
}

function CalendarState({ error, loading }: { error?: string; loading: boolean }) {
  if (error) return <p className="error-text ag-pad">日程读取失败：{error}</p>;
  if (loading) return <div className="skeleton ag-skeleton" />;
  return null;
}

export function TodayView({ snapshot, now, onOpen }: { snapshot: AgendaSnapshot; now: number; onOpen: Open }) {
  const { agenda, store } = useApp();
  const tz = snapshot.preferences.timezone;
  const today = todayIn(tz, now);
  const { from, to } = useMemo(() => dayRange(today, tz), [today, tz]);
  const { occurrences, error, loading } = useCalendar(agenda, store.api.agenda, from, to);
  const archived = new Set(snapshot.projects.filter(p => p.archived).map(p => p.id));
  const overdue = snapshot.items.filter(i => i.kind === 'todo' && i.status === 'open' && i.dueAt && i.dueAt < from && !(i.projectId && archived.has(i.projectId))).sort(byDue);
  const due = dueIn(snapshot, from, to);
  const doneToday = snapshot.items.filter(i => i.kind === 'todo' && i.status === 'done' && i.updatedAt >= from && i.updatedAt < to);
  const empty = !overdue.length && !due.length && !occurrences?.length;
  return (
    <>
      <h4 className="ag-day">{formatDate(today, today)}</h4>
      {overdue.length > 0 && <Section title="已过截止" count={overdue.length}>{overdue.map(i => <ItemRow key={i.id} item={i} snapshot={snapshot} onOpen={onOpen} />)}</Section>}
      <Section title="日程" count={occurrences?.length}>
        <CalendarState error={error} loading={loading} />
        {occurrences && <Occurrences list={occurrences} snapshot={snapshot} onOpen={onOpen} />}
        {occurrences && !occurrences.length && <p className="hint ag-pad">今天没有日程。</p>}
      </Section>
      <Section title="今天截止" count={due.length}>
        {due.map(i => <ItemRow key={i.id} item={i} snapshot={snapshot} onOpen={onOpen} />)}
        {!due.length && <p className="hint ag-pad">今天没有截止的待办。</p>}
      </Section>
      {doneToday.length > 0 && <Section title="今天完成" count={doneToday.length}>{doneToday.map(i => <ItemRow key={i.id} item={i} snapshot={snapshot} onOpen={onOpen} />)}</Section>}
      {empty && !loading && !error && <Empty><p>今天很空闲。点右上角 + 记一件事，或者对大肥鱼说“明天下午三点提醒我取快递”。</p></Empty>}
    </>
  );
}

/** A plain per-day list instead of a wide grid: the panel is only ~440px wide. */
export function WeekView({ snapshot, now, onOpen }: { snapshot: AgendaSnapshot; now: number; onOpen: Open }) {
  const { agenda, store } = useApp();
  const tz = snapshot.preferences.timezone;
  const today = todayIn(tz, now);
  const [start, setStart] = useState(() => weekStart(today));
  const { from, to } = useMemo(() => dayRange(start, tz, 7), [start, tz]);
  const { occurrences, error, loading } = useCalendar(agenda, store.api.agenda, from, to);
  const due = dueIn(snapshot, from, to);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <>
      <div className="ag-week-nav">
        <button className="icon-btn" onClick={() => setStart(addDays(start, -7))} aria-label="上一周"><IconBack size={16} /></button>
        <button className="btn ghost" onClick={() => setStart(weekStart(today))} disabled={start === weekStart(today)}>{formatDate(start).split(' ')[0]} – {formatDate(addDays(start, 6)).split(' ')[0]}{start !== weekStart(today) && ' · 回到本周'}</button>
        <button className="icon-btn" onClick={() => setStart(addDays(start, 7))} aria-label="下一周"><IconChevron size={16} /></button>
      </div>
      <CalendarState error={error} loading={loading} />
      {days.map(day => {
        // Occurrences spanning midnight are listed on the day they start.
        const occ = (occurrences ?? []).filter(o => localDate(o.startsAt, tz) === day || (day === start && o.startsAt < from));
        const todos = due.filter(i => localDate(i.dueAt!, tz) === day);
        return (
          <section key={day} className={`ag-section ag-weekday ${day === today ? 'today' : ''}`}>
            <h5>{formatDate(day, today)}</h5>
            <Occurrences list={occ} snapshot={snapshot} onOpen={onOpen} />
            {todos.map(i => <ItemRow key={i.id} item={i} snapshot={snapshot} onOpen={onOpen} />)}
            {!occ.length && !todos.length && occurrences && <p className="hint ag-pad">—</p>}
          </section>
        );
      })}
    </>
  );
}

export function UnscheduledView({ snapshot, onOpen }: { snapshot: AgendaSnapshot; onOpen: Open }) {
  const archived = new Set(snapshot.projects.filter(p => p.archived).map(p => p.id));
  const list = snapshot.items.filter(i => i.kind === 'todo' && i.status === 'open' && !i.dueAt && !(i.projectId && archived.has(i.projectId))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list.length
    ? <Section title="没有截止时间的待办" count={list.length}>{list.map(i => <ItemRow key={i.id} item={i} snapshot={snapshot} onOpen={onOpen} />)}</Section>
    : <Empty><p>没有未安排的待办。</p></Empty>;
}
