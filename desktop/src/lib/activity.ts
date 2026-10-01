import type { Task } from './types';

export function permissionBlocked(task:Task) {
  return task.status==='failed' && /permission denied|permission_denied|permissions? (?:denied|rejected)|not allowed|权限(?:不足|拒绝|拦截)|requires approval/i.test(task.error);
}
export function activity(tasks:Task[],busy:boolean,progress:string) {
  const running=tasks.filter(t=>t.status==='running'||t.status==='cancelling');
  const queued=tasks.filter(t=>t.status==='queued');
  const blocked=[...tasks].reverse().find(t=>permissionBlocked(t)&&Date.now()-Date.parse(t.updatedAt)<10*60*1000);
  if(busy)return {dot:'think',text:progress||'正在等待模型回复'};
  if(running.length)return {dot:'work',text:`执行器正在工作 · ${running.length} 个任务`};
  if(queued.length)return {dot:'work',text:`${queued.length} 个任务等待执行`};
  if(blocked)return {dot:'off',text:'任务被权限拦截 · 查看任务',taskId:blocked.id};
  return {dot:'on',text:'在线 · 随时待命'};
}
