import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { withIdempotency } from '../lib/api';
import { Sheet } from './agenda/common';
import type { ProjectMemory } from '../../../shared/project-memory';
import type { AgendaProject } from '../../../shared/agenda';
const labels={goal:'目标',progress:'进展',next:'下一步',context:'背景'} as const;

export function ProjectMemoryView({project}:{project:AgendaProject}) {
  const {store,host}=useApp();
  const [records,setRecords]=useState<ProjectMemory[]>([]);
  const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [refresh,setRefresh]=useState(0);
  const [editing,setEditing]=useState<ProjectMemory|null|undefined>();
  useEffect(()=>host.transport.subscribe(item=>{if(item.kind==='sync'||item.kind==='event'&&item.event.type==='memory.changed')setRefresh(v=>v+1);}),[host]);
  useEffect(()=>{let alive=true;setLoading(true);store.api.memories.list(project.id).then(list=>{if(alive){setRecords(list);setError('');}},e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[store,project.id,refresh]);
  return <section className="group">
    <h4>项目记忆</h4><p className="hint">保存目标、进展和下一步，继续聊天时可查询。实际待办和截止日期以事务记录为准。</p>
    {loading&&<p className="hint">正在读取…</p>}
    {error&&<p className="error-text" role="alert">{error}<button className="btn" onClick={()=>setRefresh(v=>v+1)}>重新读取</button></p>}
    {!loading&&!error&&!records.length&&<p className="hint">还没有保存的记忆。</p>}
    {records.map(m=><div className="memory-card" key={m.id}><b>{labels[m.kind]}</b><p>{m.content}</p><small>{m.source.type==='manual'?'手动填写':'用户对话'} · {new Date(m.updatedAt).toLocaleString()}</small>{m.source.messageId&&<details><summary>查看来源</summary><p>{store.get().messages.find(x=>x.id===m.source.messageId)?.content||`来源消息 ID：${m.source.messageId}（不在当前载入的近期消息中）`}</p></details>}<button className="btn ghost" onClick={()=>setEditing(m)}>编辑</button></div>)}
    {!project.archived&&<button className="btn" onClick={()=>setEditing(null)}>添加记忆</button>}
    {editing!==undefined&&<MemoryEditor key={editing?.id||'new'} project={project} memory={editing} onClose={()=>{setEditing(undefined);setRefresh(v=>v+1);}} />}
  </section>;
}
function MemoryEditor({project,memory,onClose}:{project:AgendaProject;memory:ProjectMemory|null;onClose:()=>void}) {
  const {store}=useApp();const [kind,setKind]=useState<ProjectMemory['kind']>(memory?.kind||'context');
  const [content,setContent]=useState(memory?.content||'');const [pending,setPending]=useState(false);const [error,setError]=useState('');
  async function save(remove=false){setPending(true);setError('');try{await withIdempotency(key=>remove?store.api.memories.remove(memory!.id,memory!.revision,key):memory?store.api.memories.update(memory.id,{revision:memory.revision,kind,content},key):store.api.memories.create({projectId:project.id,kind,content},key));onClose();}catch(e){setError((e as Error).message+'；若记录已修改，请关闭后重新打开编辑。');}finally{setPending(false);}}
  return <Sheet title={memory?'编辑项目记忆':'添加项目记忆'} onClose={onClose}>
    <label className="field"><span>类别</span><select aria-label="类别" value={kind} onChange={e=>setKind(e.target.value as ProjectMemory['kind'])}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field"><span>记忆内容</span><textarea rows={5} maxLength={2000} value={content} onChange={e=>setContent(e.target.value)} /></label>
    <p className="hint">删除会停止将这条记忆用于查询；原始聊天、操作事件和备份不会一并清除。</p>
    {error&&<p className="error-text" role="alert">{error}</p>}
    <button className="btn primary block" disabled={pending||!content.trim()||project.archived} onClick={()=>void save()}>保存记忆</button>
    {memory&&<button className="btn ghost block" disabled={pending} onClick={()=>{if(confirm('删除这条项目记忆？'))void save(true);}}>删除记忆</button>}
  </Sheet>;
}
