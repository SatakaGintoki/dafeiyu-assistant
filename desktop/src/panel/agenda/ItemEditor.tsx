import { useMemo, useState } from 'react';
import type { AgendaItem } from '../../../../shared/agenda';
import { useApp } from '../../context';
import { ApiError } from '../../lib/api';
import { useAgenda } from '../../lib/agenda';
import { diffPayload, emptyForm, formFromItem, payloadFromForm, type ItemForm } from '../../lib/agendaForm';
import { reminderOptions, weekdayAt, fromLocalInput } from '../../lib/agendaTime';
import { useToast } from '../../ui/toast';
import { activeProjects, errorText, kindLabel, Sheet, TimezoneInput } from './common';

/**
 * Create or edit a todo / event / note. Edits send only changed fields with the revision the form was opened at;
 * a conflict never overwrites silently: the user picks between the latest version and their own.
 */
export function ItemEditor({ item, defaults, onClose }: { item?: AgendaItem; defaults?: Partial<ItemForm>; onClose: () => void }) {
  const { agenda, store } = useApp();
  const toast = useToast();
  const snapshot = useAgenda(agenda, s => s.snapshot)!;
  const latest = useAgenda(agenda, s => item ? s.snapshot?.items.find(i => i.id === item.id) : undefined);
  // base: the version whose revision we write against. origin: what the form was filled from; diffs are taken
  // against it so "keep my changes" sends only fields the user edited, not stale copies of fields changed elsewhere.
  const [base, setBase] = useState(item);
  const [origin, setOrigin] = useState(item);
  const [form, setForm] = useState<ItemForm>(() => item ? formFromItem(item) : emptyForm(snapshot.preferences.timezone, defaults));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [exception, setException] = useState('');
  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) => setForm(f => ({ ...f, [key]: value }));
  const conflict = !!(base && latest && latest.revision !== base.revision);
  const projects = activeProjects(snapshot);
  const current = item?.projectId ? snapshot.projects.find(p => p.id === item.projectId) : undefined;
  const recurring = form.kind === 'event' && form.repeat !== 'none';
  const startWeekday = useMemo(() => {
    const at = fromLocalInput(form.startsAt, form.timezone);
    try { return at ? weekdayAt(at, form.timezone) : undefined; } catch { return undefined; }
  }, [form.startsAt, form.timezone]);

  async function write(run: (key: string) => Promise<AgendaItem>, done: string) {
    setPending(true); setError('');
    try { await agenda.run('items', run); toast(done, 'success'); onClose(); }
    catch (e) { setError(errorText(e)); if (!(e instanceof ApiError && e.status === 409)) toast(errorText(e), 'error'); }
    finally { setPending(false); }
  }

  function save() {
    const { payload, error } = payloadFromForm(form);
    if (!payload) { setError(error!); return; }
    if (!base) { void write(key => store.api.agenda.createItem(payload, key), `${kindLabel[payload.kind]}已创建`); return; }
    const patch = diffPayload(origin ?? base, payload);
    if (!Object.keys(patch).length) { onClose(); return; }
    void write(key => store.api.agenda.updateItem(base.id, { ...patch, revision: base.revision }, key), '已保存');
  }

  function setStatus(status: AgendaItem['status']) {
    if (!base) return;
    if (base.recurrence && status !== 'open' && !window.confirm('这是重复日程。完成或取消会影响整组（以后所有日期都不再出现和提醒），确定吗？\n只想跳过某一天，请在“跳过日期”里添加。')) return;
    const label = status === 'open' ? '已重新打开' : status === 'done' ? '已完成' : '已取消';
    void write(key => store.api.agenda.updateItem(base.id, { revision: base.revision, status }, key), label);
  }

  return (
    <Sheet title={base ? `编辑${kindLabel[base.kind]}` : '新建事务'} onClose={onClose}>
      {conflict && latest && (
        <div className="ag-conflict">
          <p>这条记录在别处被修改了（可能是大肥鱼或另一个窗口）。你的修改还没保存。</p>
          <div className="task-actions">
            <button className="btn" onClick={() => { setBase(latest); setOrigin(latest); setForm(formFromItem(latest)); setError(''); }}>载入最新，放弃我的修改</button>
            <button className="btn" onClick={() => { setBase(latest); setError(''); }}>保留我的修改</button>
          </div>
          <p className="hint">选择“保留”后再点保存，只写入你改过的字段，别处的其他修改会保留。</p>
        </div>
      )}
      {!base && (
        <div className="segmented">
          {(['todo', 'event', 'note'] as const).map(k => (
            <button type="button" key={k} className={form.kind === k ? 'on' : ''} onClick={() => set('kind', k)}>
              {form.kind === k && <span className="seg-thumb" />}<span className="seg-label">{kindLabel[k]}</span>
            </button>
          ))}
        </div>
      )}
      {base && base.kind !== 'note' && <p className="hint">类型：{kindLabel[base.kind]}{base.status !== 'open' ? ` · ${base.status === 'done' ? '已完成' : '已取消'}` : ''}</p>}
      <label className="field"><span>标题</span>
        <input autoFocus={!base} value={form.title} maxLength={160} onChange={e => set('title', e.target.value)}
          placeholder={form.kind === 'event' ? '例如：周四游泳课' : form.kind === 'note' ? '例如：旅行打包清单' : '例如：交水电费'} />
      </label>
      <label className="field"><span>{form.kind === 'note' ? '内容' : '说明'}</span>
        <textarea rows={form.kind === 'note' ? 6 : 2} value={form.notes} maxLength={8000} onChange={e => set('notes', e.target.value)} placeholder="可选" />
      </label>
      <label className="field"><span>项目</span>
        <select value={form.projectId} onChange={e => set('projectId', e.target.value)}>
          <option value="">收件箱（未分类）</option>
          {current?.archived && <option value={current.id}>{current.name}（已归档）</option>}
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>

      {form.kind === 'todo' && (
        <label className="field"><span>截止时间（可不填）</span>
          <input type="datetime-local" value={form.dueAt} onChange={e => set('dueAt', e.target.value)} />
        </label>
      )}
      {form.kind === 'event' && (
        <div className="row2">
          <label className="field"><span>开始</span>
            <input type="datetime-local" value={form.startsAt} onChange={e => {
              const value = e.target.value;
              // Keep the duration when moving the start, so the end isn't left behind.
              setForm(f => {
                const wall = (s: string) => Date.parse(`${s}Z`); // wall-clock difference only
                const oldStart = wall(f.startsAt), oldEnd = wall(f.endsAt), next = wall(value);
                const endsAt = !f.endsAt || Number.isNaN(oldStart) || Number.isNaN(oldEnd) || Number.isNaN(next)
                  ? (value && !f.endsAt ? shiftLocal(value, 60) : f.endsAt) : shiftLocal(value, (oldEnd - oldStart) / 60000);
                return { ...f, startsAt: value, endsAt };
              });
            }} />
          </label>
          <label className="field"><span>结束</span>
            <input type="datetime-local" value={form.endsAt} onChange={e => set('endsAt', e.target.value)} />
          </label>
        </div>
      )}
      {form.kind !== 'note' && (
        <>
          <label className="field"><span>时区（时间按此时区理解与显示）</span>
            <TimezoneInput value={form.timezone} onChange={tz => set('timezone', tz)} />
          </label>
          <div className="field"><span>提醒</span>
            <div className="ag-inline">
              <select value={form.reminder} onChange={e => set('reminder', e.target.value as ItemForm['reminder'])}>
                <option value="none">不提醒</option>
                <option value="before">{form.kind === 'event' ? '开始前' : '截止前'}</option>
                {!recurring && <option value="at">指定时间</option>}
              </select>
              {form.reminder === 'before' && (
                <select value={form.reminderMinutes} onChange={e => set('reminderMinutes', Number(e.target.value))}>
                  {reminderOptions.map(o => <option key={o.minutes} value={o.minutes}>{o.label}</option>)}
                </select>
              )}
              {form.reminder === 'at' && <input type="datetime-local" value={form.reminderAt} onChange={e => set('reminderAt', e.target.value)} />}
            </div>
            {base && <p className="hint">修改时间、提醒、时区或项目会取消旧的待处理提醒，并按新设置重新安排。已经提醒过的同一时间不会再提醒。</p>}
          </div>
        </>
      )}

      {form.kind === 'event' && (
        <div className="field"><span>重复</span>
          <div className="ag-inline">
            <select value={form.repeat} onChange={e => {
              const repeat = e.target.value as ItemForm['repeat'];
              setForm(f => ({ ...f, repeat, reminder: repeat !== 'none' && f.reminder === 'at' ? 'before' : f.reminder }));
            }}>
              <option value="none">不重复</option>
              <option value="daily">按天</option>
              <option value="weekly">按周</option>
            </select>
            {form.repeat !== 'none' && (
              <label className="ag-interval">每
                <input type="number" min={1} max={52} value={form.interval} onChange={e => set('interval', Math.trunc(Number(e.target.value)) || 1)} />
                {form.repeat === 'daily' ? '天' : '周'}
              </label>
            )}
          </div>
          {form.repeat === 'weekly' && (
            <div className="ag-weekdays" role="group" aria-label="星期">
              {[1, 2, 3, 4, 5, 6, 7].map(d => {
                const on = form.weekdays.length ? form.weekdays.includes(d) : d === startWeekday;
                return (
                  <button type="button" key={d} className={on ? 'on' : ''} aria-pressed={on} onClick={() => {
                    const currentDays = form.weekdays.length ? form.weekdays : startWeekday ? [startWeekday] : [];
                    const next = currentDays.includes(d) ? currentDays.filter(x => x !== d) : [...currentDays, d];
                    set('weekdays', next);
                  }}>{'一二三四五六日'[d - 1]}</button>
                );
              })}
            </div>
          )}
          {form.repeat !== 'none' && (
            <>
              <label className="field"><span>结束日期（含当天，可不填）</span>
                <input type="date" value={form.until} onChange={e => set('until', e.target.value)} />
              </label>
              <div className="field"><span>跳过日期</span>
                <div className="ag-inline">
                  <input type="date" value={exception} onChange={e => setException(e.target.value)} />
                  <button type="button" className="btn" disabled={!exception} onClick={() => { set('exceptions', [...new Set([...form.exceptions, exception])].sort()); setException(''); }}>添加</button>
                </div>
                {form.exceptions.length > 0 && (
                  <div className="ag-chips">{form.exceptions.map(d => (
                    <button type="button" key={d} className="chip" onClick={() => set('exceptions', form.exceptions.filter(x => x !== d))} title="移除">{d} ×</button>
                  ))}</div>
                )}
              </div>
              <p className="hint">修改与完成都作用于整组重复日程。暂不支持单次改期：跳过那一天，再单独新建一个日程。</p>
            </>
          )}
        </div>
      )}

      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn primary block" disabled={pending || !form.title.trim()} onClick={save}>{pending ? '保存中…' : base ? '保存' : '创建'}</button>
      {base && (
        <div className="task-actions">
          {base.status === 'open' ? (
            <>
              {base.kind !== 'note' && <button className="btn" disabled={pending} onClick={() => setStatus('done')}>{base.recurrence ? '完成整组' : '标为完成'}</button>}
              <button className="btn danger" disabled={pending} onClick={() => setStatus('cancelled')}>{base.kind === 'note' ? '作废笔记' : base.recurrence ? '取消整组' : '取消'}</button>
            </>
          ) : <button className="btn" disabled={pending} onClick={() => setStatus('open')}>重新打开</button>}
        </div>
      )}
      {base && base.status !== 'open' && base.kind !== 'note' && <p className="hint">重新打开不会重发已经提醒过的同一时间；需要再提醒请设置新的提醒时间。</p>}
      {base?.planId && <p className="hint">来自计划：{snapshot.plans.find(p => p.id === base.planId)?.title ?? '已移除的计划'}</p>}
    </Sheet>
  );
}

/** Adds minutes to a datetime-local value as plain wall-clock arithmetic (no zone involved). */
function shiftLocal(value: string, minutes: number) {
  const [date, time] = value.split('T');
  const [y, m, d] = date.split('-').map(Number), [h, min] = time.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, h, min) + minutes * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}
