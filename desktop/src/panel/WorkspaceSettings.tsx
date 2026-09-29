import { useEffect,useState } from 'react';
import { useApp } from '../context';
import { useStore } from '../lib/store';
import { useToast } from '../ui/toast';
import type { Diagnostics,Project,Preference,TaskTemplate } from '../../../shared/types';
import { APP_VERSION } from '../../../shared/version';
import { executorName } from '../pet/lines';

export function WorkspaceSettings(){
  const {store,host}=useApp();const toast=useToast();
  const settings=useStore(store,s=>s.settings);
  const [projects,setProjects]=useState<Project[]>([]),[preferences,setPreferences]=useState<Preference[]>([]),[templates,setTemplates]=useState<TaskTemplate[]>([]);
  const [diagnostics,setDiagnostics]=useState<Diagnostics>();
  const [name,setName]=useState(''),[workspace,setWorkspace]=useState(''),[notes,setNotes]=useState(''),[working,setWorking]=useState(false);
  const [prefKey,setPrefKey]=useState(''),[prefValue,setPrefValue]=useState('');
  async function reload(){
    const [p,m,t]=await Promise.all([store.api.projects(),store.api.preferences(),store.api.templates()]);setProjects(p);setPreferences(m);setTemplates(t);
  }
  async function act(fn:()=>Promise<unknown>,message?:string){setWorking(true);try{await fn();await reload();if(message)toast(message,'success');}catch(error){toast(error instanceof Error?error.message:'操作失败','error');}finally{setWorking(false);}}
  useEffect(()=>{void act(async()=>{setDiagnostics(await store.api.diagnostics());});},[store]);
  return <>
    <section className="group"><h4>使用检查 · v{APP_VERSION}</h4>
      <p className="hint">先配置模型，再选择工作目录和执行器。检查不会调用付费模型。</p>
      <button className="btn" disabled={working} onClick={()=>void act(async()=>setDiagnostics(await store.api.diagnostics()))}>重新检查</button>
      <p className="hint">{diagnostics?`${diagnostics.checks.filter(c=>c.ok).length} / ${diagnostics.checks.length} 项本地检查通过，模型登录和云端额度需实际调用确认。`:'尚未检查'}</p>
      <details><summary>查看检查详情</summary>{diagnostics?.checks.map(item=><div className="check-item" key={item.name}><b>{item.ok?'✓':'!'} {item.name}</b><p className="hint">{item.detail}</p></div>)}</details>
    </section>
    <section className="group"><h4>我的项目</h4><details><summary>管理项目（{projects.length}）</summary>
      <p className="hint">每个项目保存目录、执行器和说明。切换后，聊天委派使用该目录；已有任务保持原目录。</p>
      {projects.map(project=><div className="saved-item" key={project.id}><b>{project.name}</b><p className="hint">{project.workspace} · {executorName[project.executor]}</p>
        <button className="btn" disabled={working} onClick={()=>void act(async()=>store.setSettings(await store.api.activateProject(project.id)),'已切换项目')}>{settings?.workspace===project.workspace?'当前目录 · 重新应用':'切换'}</button>{' '}
        <button className="btn ghost" disabled={working} onClick={()=>void act(()=>store.api.removeProject(project.id),'已移除项目记录，文件未删除')}>移除记录</button>
      </div>)}
      <label className="field"><span>项目名称</span><input value={name} onChange={e=>setName(e.target.value)} maxLength={80}/></label>
      <label className="field"><span>项目文件夹</span><input value={workspace} onChange={e=>setWorkspace(e.target.value)} placeholder="绝对路径"/></label>
      {host.kind==='electron'&&<button className="btn" onClick={()=>void host.chooseFolder().then(path=>{if(path)setWorkspace(path);})}>选择文件夹</button>}
      <label className="field"><span>项目说明</span><textarea rows={3} maxLength={4000} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="例如：文档使用中文，不改动原始素材"/></label>
      <button className="btn" disabled={working||!name.trim()||!workspace.trim()} onClick={()=>void act(async()=>{await store.api.addProject({name,workspace,notes,executor:settings?.defaultExecutor||'codex'});setName('');setNotes('');},'项目已保存')}>保存项目（使用当前默认执行器）</button>
    </details></section>
    <section className="group"><h4>已保存的偏好</h4><details><summary>管理偏好（{preferences.length}）</summary><p className="hint">可删除长期偏好。删除不清除历史聊天；本轮上下文可能仍包含旧内容。</p>
      {!preferences.length&&<p className="hint">暂无偏好，可在对话中明确告诉管家要记住什么。</p>}
      {preferences.map(p=><div className="saved-item" key={p.key}><b>{p.key}</b><p>{p.value}</p><button className="btn ghost" disabled={working} onClick={()=>void act(()=>store.api.removePreference(p.key),'偏好已删除')}>删除偏好</button></div>)}
      <label className="field"><span>偏好名称（同名保存会更新）</span><input value={prefKey} onChange={e=>setPrefKey(e.target.value)} maxLength={60}/></label>
      <label className="field"><span>偏好内容</span><textarea value={prefValue} onChange={e=>setPrefValue(e.target.value)} maxLength={500} rows={2}/></label>
      <button className="btn" disabled={working||!prefKey.trim()||!prefValue.trim()} onClick={()=>void act(async()=>{await store.api.savePreference(prefKey,prefValue);setPrefKey('');setPrefValue('');},'偏好已保存')}>保存偏好</button>
    </details></section>
    <section className="group"><h4>我的任务模板</h4><details><summary>管理模板（{templates.length}）</summary><p className="hint">在新建任务中填写要求后，可保存为模板。使用模板仍需手动开始任务。</p>
      {templates.map(t=><div className="saved-item" key={t.id}><b>{t.name}</b><button className="btn ghost" disabled={working} onClick={()=>void act(()=>store.api.removeTemplate(t.id),'模板已删除')}>删除</button></div>)}
    </details></section>
  </>;
}
