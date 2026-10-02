import type { Message, Task } from './types';

/** Older notifications collapsed whitespace before truncation. Recover formatting from the source,
 * only when the source still describes the same successful attempt. Never rewrite stored history. */
export function messageDisplay(message:Message, task?:Task) {
  const text=message.content;
  if(!task || task.status!=='succeeded' || !task.result || message.role!=='assistant'
    || task.attempts?.length || !text.startsWith('「') || !text.includes('执行结束。')
    || !text.includes('完整内容在任务详情里。') || !/[^\n] #{1,6} |\|\s*:?-{3,}/.test(text))return text;
  const result=task.result.trim();
  if(result.length<=1200)return `${text.split('\n')[0]}\n\n${result}`;
  const cut=result.lastIndexOf('\n',1200);
  return `${text.split('\n')[0]}\n\n${result.slice(0,cut>0?cut:1200)}\n\n完整内容在任务详情里。`;
}
