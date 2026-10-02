import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { useStore } from '../lib/store';
import { useAgenda } from '../lib/agenda';
import { withIdempotency } from '../lib/api';

export function GettingStarted() {
  const {store,agenda}=useApp();const settings=useStore(store,s=>s.settings);const busy=useStore(store,s=>s.busy);
  const snapshot=useAgenda(agenda,s=>s.snapshot);
  const [pending,setPending]=useState(false);const [check,setCheck]=useState('');const [error,setError]=useState('');
  useEffect(()=>{setCheck('');},[settings]);
  const example=snapshot?.items.find(i=>i.notes==='大肥鱼首次使用体验提醒');
  async function run(action:()=>Promise<void>){setPending(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setPending(false);}}
  return <section className="group getting-started"><h4>第一次使用，从这里开始</h4>
    <p><b>1. 选择模式并保存</b></p><p className="hint">想先看看界面，选择下面的“演示”。真实聊天需填写自己的 API Key；管理日程无需安装编码执行器。</p>
    <button className="btn" onClick={()=>document.getElementById('model-settings')?.scrollIntoView({block:'start',behavior:'smooth'})}>去配置模型</button>
    <p><b>2. 检查模型连接</b></p><p className="hint">先保存下面的设置，再检查。在线模式会发起一次很短的 API 请求，消耗少量额度；不验证编码执行器。</p>
    <button className="btn" disabled={pending||busy||!settings} onClick={()=>void run(async()=>{const result=await store.api.checkConnection();setCheck(result.detail);})}>{pending?'正在处理…':'检查已保存的模型配置'}</button>
    {check&&<p className="hint" role="status">{check}</p>}
    <p><b>3. 体验第一条提醒</b></p><p className="hint">创建两分钟后的提醒，然后去“事务”查看。请保持应用运行；关闭或关机期间不能即时弹出。</p>
    <button className="btn" disabled={pending||!snapshot||!!example} onClick={()=>void run(async()=>{await withIdempotency(key=>store.api.agenda.createItem({kind:'todo',title:'体验大肥鱼提醒',notes:'大肥鱼首次使用体验提醒',reminderAt:new Date(Date.now()+120000).toISOString()},key));await agenda.refresh();})}>{example?'体验提醒已创建，可在事务页查看':'创建两分钟后的体验提醒'}</button>
    <p className="hint">之后试试：“在个人网站项目里记一项待办”。需要写代码时，再配置“干活的手”。</p>
    {error&&<p className="error-text" role="alert">{error}</p>}
  </section>;
}
