import { useState } from 'react';
import { ProjectMemoryView } from '../ProjectMemory';
import type { AgendaItem, AgendaProject, AgendaSnapshot } from '../../../../shared/agenda';
import { useApp } from '../../context';
import { ApiError } from '../../lib/api';
import { useAgenda } from '../../lib/agenda';
import { IconBack, IconChevron, IconPlus } from '../../ui/icons';
import { useToast } from '../../ui/toast';
import { activeProjects, Empty, errorText, INBOX, ItemRow, Section, Sheet, useAction } from './common';

type Filter = 'open' | 'notes' | 'closed';
const order = (a: AgendaItem, b: AgendaItem) => (a.dueAt ?? a.startsAt ?? '~').localeCompare(b.dueAt ?? b.startsAt ?? '~') || a.createdAt.localeCompare(b.createdAt);

/** Projects are general-purpose containers (life, travel, a course, a side project). null id = 收件箱. */
export function ProjectsView({ snapshot, selected, onSelect, onEditProject, onNewItem, onOpenItem }: {
  snapshot: AgendaSnapshot; selected: string | null | undefined;
  onSelect: (id: string | null | undefined) => void; onEditProject: (project?: AgendaProject) => void;
  onNewItem: (projectId: string | null) => void; onOpenItem: (item: AgendaItem) => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  if (selected !== undefined) {
    const project = selected ? snapshot.projects.find(p => p.id === selected) : null;
    if (selected && !project) return <Empty><p>这个项目不存在了。</p><button className="btn" onClick={() => onSelect(undefined)}>返回</button></Empty>;
    return <ProjectDetail snapshot={snapshot} project={project ?? null} onBack={() => onSelect(undefined)} onEdit={() => project && onEditProject(project)} onNewItem={() => onNewItem(project?.id ?? null)} onOpenItem={onOpenItem} />;
  }
  const count = (id: string | null) => snapshot.items.filter(i => i.projectId === id && i.status === 'open').length;
  const archived = snapshot.projects.filter(p => p.archived);
  const row = (id: string | null, name: string, description: string, muted = false) => (
    <button key={id ?? 'inbox'} className={`ag-project ${muted ? 'muted' : ''}`} onClick={() => onSelect(id)}>
      <span className="ag-project-main"><b>{name}</b>{description && <small>{description}</small>}</span>
      <em>{count(id) || ''}</em><IconChevron size={15} />
    </button>
  );
  return (
    <>
      <button className="btn block ag-new" onClick={() => onEditProject()}><IconPlus size={15} />新建项目</button>
      {row(null, INBOX, '没有归类的事务')}
      {activeProjects(snapshot).map(p => row(p.id, p.name, p.description))}
      {!activeProjects(snapshot).length && <p className="hint ag-pad">项目可以是“生活”“旅行”“个人网站”或某门课，用来归类待办、日程和笔记。</p>}
      {archived.length > 0 && (
        <Section title="已归档" count={archived.length}>
          <button className="ag-snoozed-toggle" onClick={() => setShowArchived(v => !v)}>{showArchived ? '收起' : '展开'}</button>
          {showArchived && archived.map(p => row(p.id, p.name, '已暂停，提醒不会触发', true))}
        </Section>
      )}
    </>
  );
}

function ProjectDetail({ snapshot, project, onBack, onEdit, onNewItem, onOpenItem }: {
  snapshot: AgendaSnapshot; project: AgendaProject | null; onBack: () => void; onEdit: () => void; onNewItem: () => void; onOpenItem: (item: AgendaItem) => void;
}) {
  const { agenda, store } = useApp();
  const { pending, act } = useAction();
  const [filter, setFilter] = useState<Filter>('open');
  const items = snapshot.items.filter(i => i.projectId === (project?.id ?? null));
  const shown = items.filter(i => filter === 'notes' ? i.kind === 'note' && i.status === 'open' : filter === 'open' ? i.kind !== 'note' && i.status === 'open' : i.status !== 'open').sort(order);
  const archive = (archived: boolean) => act(() => {
    const latest = agenda.get().snapshot?.projects.find(p => p.id === project!.id) ?? project!;
    return agenda.run('projects', key => store.api.agenda.updateProject(latest.id, { revision: latest.revision, archived }, key));
  }, archived ? '项目已归档，提醒已暂停' : '项目已恢复');
  return (
    <>
      <div className="ag-detail-head">
        <button className="icon-btn" onClick={onBack} aria-label="返回项目列表"><IconBack size={16} /></button>
        <div className="task-main">
          <div className="task-title">{project ? project.name : INBOX}{project?.archived && <span className="tag muted">已归档</span>}</div>
          {project?.description && <div className="task-meta">{project.description}</div>}
        </div>
        {project && <button className="btn ghost" onClick={onEdit}>编辑</button>}
      </div>
      {project?.archived && (
        <div className="ag-note">归档是暂停，不是删除：记录都保留，提醒暂停，也不能往里新增事务。恢复后重新参与提醒，已经提醒过的不会重发。
          <button className="btn" disabled={pending} onClick={() => void archive(false)}>恢复项目</button>
        </div>
      )}
      <div className="ag-bar">
        <div className="segmented small">
          {([['open', '未完成'], ['notes', '笔记'], ['closed', '已结束']] as const).map(([id, label]) => (
            <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{filter === id && <span className="seg-thumb" />}<span className="seg-label">{label}</span></button>
          ))}
        </div>
        {!project?.archived && <button className="icon-btn primary" onClick={onNewItem} aria-label="在此项目新建" title="在此项目新建"><IconPlus size={18} /></button>}
      </div>
      {shown.map(item => <ItemRow key={item.id} item={item} snapshot={snapshot} showProject={false} onOpen={onOpenItem} />)}
      {project && <ProjectMemoryView key={project.id} project={project} />}
      {!shown.length && <Empty><p>{filter === 'notes' ? '还没有笔记。' : filter === 'open' ? '没有未完成的事务。' : '还没有完成或取消的记录。'}</p></Empty>}
      {project && !project.archived && (
        <button className="btn ghost ag-archive" disabled={pending} onClick={() => {
          if (window.confirm(`归档“${project.name}”？这会暂停它的所有提醒，记录都会保留，可以随时恢复。`)) void archive(true);
        }}>归档项目</button>
      )}
    </>
  );
}

export function ProjectEditor({ project, onClose, onCreated }: { project?: AgendaProject; onClose: () => void; onCreated?: (p: AgendaProject) => void }) {
  const { agenda, store } = useApp();
  const toast = useToast();
  const latest = useAgenda(agenda, s => project ? s.snapshot?.projects.find(p => p.id === project.id) : undefined);
  const [base, setBase] = useState(project);
  const [origin, setOrigin] = useState(project); // diff source, see ItemEditor
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const conflict = !!(base && latest && latest.revision !== base.revision);
  async function save() {
    if (!name.trim()) { setError('请填写项目名称'); return; }
    setPending(true); setError('');
    try {
      const result = await agenda.run('projects', key => base
        ? store.api.agenda.updateProject(base.id, { revision: base.revision, ...(name.trim() !== origin!.name ? { name: name.trim() } : {}), ...(description !== origin!.description ? { description } : {}) }, key)
        : store.api.agenda.createProject({ name: name.trim(), description }, key));
      toast(base ? '项目已保存' : '项目已创建', 'success');
      if (!base) onCreated?.(result);
      onClose();
    } catch (e) {
      setError(errorText(e));
      if (!(e instanceof ApiError && e.status === 409)) toast(errorText(e), 'error');
    } finally { setPending(false); }
  }
  return (
    <Sheet title={base ? '编辑项目' : '新建项目'} onClose={onClose}>
      {conflict && latest && (
        <div className="ag-conflict"><p>项目在别处被修改为“{latest.name}”。</p>
          <div className="task-actions">
            <button className="btn" onClick={() => { setBase(latest); setOrigin(latest); setName(latest.name); setDescription(latest.description); }}>载入最新</button>
            <button className="btn" onClick={() => setBase(latest)}>保留我的修改</button>
          </div>
        </div>
      )}
      <label className="field"><span>名称</span><input autoFocus value={name} maxLength={160} onChange={e => setName(e.target.value)} placeholder="例如：生活、日本旅行、个人网站" /></label>
      <label className="field"><span>说明</span><textarea rows={3} value={description} maxLength={8000} onChange={e => setDescription(e.target.value)} placeholder="可选" /></label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn primary block" disabled={pending || !name.trim()} onClick={() => void save()}>{pending ? '保存中…' : '保存'}</button>
    </Sheet>
  );
}
