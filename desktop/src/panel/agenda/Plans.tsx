import { useState } from 'react';
import type { AgendaItem, AgendaPlan, AgendaPlanStep, AgendaSnapshot } from '../../../../shared/agenda';
import { useApp } from '../../context';
import { ApiError } from '../../lib/api';
import { useAgenda } from '../../lib/agenda';
import { formatInstant, fromLocalInput, toLocalInput, validTimezone } from '../../lib/agendaTime';
import { IconClose, IconPlus } from '../../ui/icons';
import { useToast } from '../../ui/toast';
import { activeProjects, Empty, errorText, ItemRow, projectName, Section, Sheet, TimezoneInput, useAction } from './common';

/**
 * Plans are drafts until the user accepts them. Accepting is one server call that creates every step's todo
 * atomically; the browser never creates the steps one by one.
 */
export function PlansView({ snapshot, onEdit, onOpenItem }: { snapshot: AgendaSnapshot; onEdit: (plan?: AgendaPlan) => void; onOpenItem: (item: AgendaItem) => void }) {
  const [showCancelled, setShowCancelled] = useState(false);
  const plans = [...snapshot.plans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const drafts = plans.filter(p => p.status === 'draft');
  const accepted = plans.filter(p => p.status === 'accepted');
  const cancelled = plans.filter(p => p.status === 'cancelled');
  return (
    <>
      <button className="btn block ag-new" onClick={() => onEdit()}><IconPlus size={15} />新建计划草案</button>
      {!plans.length && <Empty><p>还没有计划。可以让大肥鱼帮你拆分一个目标（比如“准备十月的旅行”），或自己写一个草案。草案确认前不会生成待办。</p></Empty>}
      {drafts.length > 0 && <Section title="待确认的草案" count={drafts.length}>{drafts.map(p => <DraftCard key={p.id} plan={p} snapshot={snapshot} onEdit={() => onEdit(p)} />)}</Section>}
      {accepted.length > 0 && <Section title="已采用" count={accepted.length}>{accepted.map(p => <AcceptedCard key={p.id} plan={p} snapshot={snapshot} onOpenItem={onOpenItem} />)}</Section>}
      {cancelled.length > 0 && (
        <Section title="已放弃" count={cancelled.length}>
          <button className="ag-snoozed-toggle" onClick={() => setShowCancelled(v => !v)}>{showCancelled ? '收起' : '展开'}</button>
          {showCancelled && cancelled.map(p => <div key={p.id} className="ag-plan muted"><b>{p.title}</b><span className="hint"> · {p.steps.length} 步</span></div>)}
        </Section>
      )}
    </>
  );
}

function DraftCard({ plan, snapshot, onEdit }: { plan: AgendaPlan; snapshot: AgendaSnapshot; onEdit: () => void }) {
  const { agenda, store } = useApp();
  const { pending, act } = useAction();
  const revision = () => agenda.get().snapshot?.plans.find(p => p.id === plan.id)?.revision ?? plan.revision;
  return (
    <article className="ag-plan">
      <header><b>{plan.title}</b><span className="tag">草案</span><span className="tag">{projectName(snapshot, plan.projectId)}</span></header>
      {plan.notes && <p className="hint">{plan.notes}</p>}
      <ol className="ag-steps">
        {plan.steps.map((s, i) => (
          <li key={i}><span>{s.title}</span>{s.dueAt && <small>截止 {formatInstant(s.dueAt, plan.timezone, snapshot.preferences.timezone)}</small>}</li>
        ))}
      </ol>
      <div className="task-actions">
        <button className="btn primary" disabled={pending} onClick={() => void act(async () => {
          const result = await agenda.run('plans', key => store.api.agenda.acceptPlan(plan.id, revision(), key));
          return result;
        }, `已采用，生成 ${plan.steps.length} 个待办`)}>确认采用</button>
        <button className="btn" disabled={pending} onClick={onEdit}>修改草案</button>
        <button className="btn danger" disabled={pending} onClick={() => {
          if (window.confirm('放弃这个草案？记录会保留在“已放弃”里，不会生成待办。')) void act(() => agenda.run('plans', key => store.api.agenda.cancelPlan(plan.id, revision(), key)), '草案已放弃');
        }}>放弃</button>
      </div>
    </article>
  );
}

function AcceptedCard({ plan, snapshot, onOpenItem }: { plan: AgendaPlan; snapshot: AgendaSnapshot; onOpenItem: (item: AgendaItem) => void }) {
  const items = plan.itemIds.map(id => snapshot.items.find(i => i.id === id)).filter((i): i is AgendaItem => !!i);
  const done = items.filter(i => i.status === 'done').length;
  const total = items.filter(i => i.status !== 'cancelled').length;
  return (
    <article className="ag-plan">
      <header><b>{plan.title}</b><span className="tag">{projectName(snapshot, plan.projectId)}</span><span className="ag-progress-text">{done}/{total}</span></header>
      <div className="ag-progress"><span style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
      {items.map(item => <ItemRow key={item.id} item={item} snapshot={snapshot} showProject={false} onOpen={onOpenItem} />)}
      {items.length < plan.itemIds.length && <p className="hint">有 {plan.itemIds.length - items.length} 个待办暂未读到，稍后会刷新。</p>}
    </article>
  );
}

interface StepForm { title: string; notes: string; dueAt: string; reminderAt: string }

export function PlanEditor({ plan, onClose }: { plan?: AgendaPlan; onClose: () => void }) {
  const { agenda, store } = useApp();
  const toast = useToast();
  const snapshot = useAgenda(agenda, s => s.snapshot)!;
  const latest = useAgenda(agenda, s => plan ? s.snapshot?.plans.find(p => p.id === plan.id) : undefined);
  const [base, setBase] = useState(plan);
  const tz0 = plan?.timezone ?? snapshot.preferences.timezone;
  const [title, setTitle] = useState(plan?.title ?? '');
  const [notes, setNotes] = useState(plan?.notes ?? '');
  const [projectId, setProjectId] = useState(plan?.projectId ?? '');
  const [timezone, setTimezone] = useState(tz0);
  const [steps, setSteps] = useState<StepForm[]>(() => plan?.steps.map(s => ({ title: s.title, notes: s.notes, dueAt: toLocalInput(s.dueAt, tz0), reminderAt: toLocalInput(s.reminderAt, tz0) })) ?? [{ title: '', notes: '', dueAt: '', reminderAt: '' }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const conflict = !!(base && latest && latest.revision !== base.revision);
  const setStep = (i: number, patch: Partial<StepForm>) => setSteps(list => list.map((s, j) => j === i ? { ...s, ...patch } : s));

  async function save() {
    setError('');
    if (!title.trim()) { setError('请填写计划标题'); return; }
    if (!validTimezone(timezone)) { setError('时区无效'); return; }
    const filled = steps.filter(s => s.title.trim());
    if (!filled.length) { setError('至少需要一个步骤'); return; }
    const out: AgendaPlanStep[] = [];
    for (const s of filled) {
      const dueAt = s.dueAt ? fromLocalInput(s.dueAt, timezone) : null;
      const reminderAt = s.reminderAt ? fromLocalInput(s.reminderAt, timezone) : null;
      if ((s.dueAt && !dueAt) || (s.reminderAt && !reminderAt)) { setError(`步骤“${s.title}”的时间无效`); return; }
      out.push({ title: s.title.trim(), notes: s.notes, dueAt, reminderAt });
    }
    const body = { title: title.trim(), notes, projectId: projectId || null, timezone, steps: out };
    setPending(true);
    try {
      await agenda.run('plans', key => base ? store.api.agenda.updatePlan(base.id, { ...body, revision: base.revision }, key) : store.api.agenda.createPlan(body, key));
      toast(base ? '草案已保存' : '草案已保存，确认采用后才会生成待办', 'success');
      onClose();
    } catch (e) {
      setError(errorText(e));
      if (!(e instanceof ApiError && e.status === 409)) toast(errorText(e), 'error');
    } finally { setPending(false); }
  }

  return (
    <Sheet title={base ? '修改计划草案' : '新建计划草案'} onClose={onClose}>
      {conflict && latest && (
        <div className="ag-conflict">
          <p>{latest.status === 'draft' ? '草案在别处被修改了，你的修改还没保存。' : '这个计划已经被采用或放弃，不能再修改草案。'}</p>
          {latest.status === 'draft' && <div className="task-actions">
            <button className="btn" onClick={() => { setBase(latest); setTitle(latest.title); setNotes(latest.notes); setProjectId(latest.projectId ?? ''); setTimezone(latest.timezone); setSteps(latest.steps.map(s => ({ title: s.title, notes: s.notes, dueAt: toLocalInput(s.dueAt, latest.timezone), reminderAt: toLocalInput(s.reminderAt, latest.timezone) }))); }}>载入最新</button>
            <button className="btn" onClick={() => setBase(latest)}>用我的版本覆盖</button>
          </div>}
        </div>
      )}
      <label className="field"><span>计划标题</span><input autoFocus={!base} value={title} maxLength={160} onChange={e => setTitle(e.target.value)} placeholder="例如：准备国庆旅行" /></label>
      <label className="field"><span>说明</span><textarea rows={2} value={notes} maxLength={8000} onChange={e => setNotes(e.target.value)} placeholder="可选" /></label>
      <div className="row2">
        <label className="field"><span>项目</span>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">收件箱（未分类）</option>
            {activeProjects(snapshot).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field"><span>时区</span><TimezoneInput value={timezone} onChange={setTimezone} /></label>
      </div>
      <div className="field"><span>步骤（确认采用后各自成为待办）</span>
        {steps.map((s, i) => (
          <div key={i} className="ag-step-edit">
            <div className="ag-inline">
              <span className="ag-step-no">{i + 1}</span>
              <input value={s.title} maxLength={160} onChange={e => setStep(i, { title: e.target.value })} placeholder="步骤标题" />
              <button type="button" className="icon-btn" aria-label="删除步骤" disabled={steps.length === 1} onClick={() => setSteps(list => list.filter((_, j) => j !== i))}><IconClose size={14} /></button>
            </div>
            <div className="row2">
              <label className="field"><span>截止</span><input type="datetime-local" value={s.dueAt} onChange={e => setStep(i, { dueAt: e.target.value })} /></label>
              <label className="field"><span>提醒</span><input type="datetime-local" value={s.reminderAt} onChange={e => setStep(i, { reminderAt: e.target.value })} /></label>
            </div>
          </div>
        ))}
        <button type="button" className="btn" disabled={steps.length >= 60} onClick={() => setSteps(list => [...list, { title: '', notes: '', dueAt: '', reminderAt: '' }])}><IconPlus size={14} />添加步骤</button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn primary block" disabled={pending || conflict && latest?.status !== 'draft'} onClick={() => void save()}>{pending ? '保存中…' : '保存草案'}</button>
      <p className="hint">保存草案不会生成待办；在计划列表点“确认采用”后才一次性生成。</p>
    </Sheet>
  );
}
