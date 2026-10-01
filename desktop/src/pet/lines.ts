import type { Executor, Task } from '../lib/types';
import { plainText } from '../../../shared/plain-text';

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

export const executorName: Record<Executor, string> = { codex: 'Codex', claude: 'Claude Code', zcode: 'ZCode', demo: '演示执行器' };

export function greeting(name: string) {
  const hour = new Date().getHours();
  const time = hour < 5 ? '这么晚还没睡呀' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  return `${time}，${name}～大肥鱼今天也在哦。有事就双击我！`;
}

export const pokeLines = [
  '诶？叫我吗～', '在呢在呢！', '要我帮忙做点什么吗？', '嘿嘿，痒～', '大肥鱼随时待命！',
  '双击我就能聊天哦', '今天也要好好喝水～', '（摇尾巴）',
] as const;
export const annoyedLines = ['再戳要生气了哦！', '呜…头发要乱了啦', '好啦好啦，我知道你在了！'] as const;
export const patLines = ['嘿嘿…被摸头了～', '好舒服…再摸一下嘛', '（开心地晃尾巴）'] as const;
export const wakeLines = ['唔…我没睡着！', '啊，在的在的！', '（揉眼睛）怎么啦？'] as const;
export const idleLines = [
  '要不要让我帮你跑个任务？', '坐久了记得起来走走～', '桌面上好安静呀…', '我在巡逻，放心～',
  '有写代码的活可以交给我哦', '（哼着小曲）',
] as const;
export const dragLines = ['哇啊——要去哪里呀！', '轻、轻一点！', '飞起来啦～'] as const;
export const dropLines = ['这里视野不错～', '安家成功！', '呼…到了到了'] as const;

export const line = {
  poke: () => pick(pokeLines),
  annoyed: () => pick(annoyedLines),
  pat: () => pick(patLines),
  wake: () => pick(wakeLines),
  idle: () => pick(idleLines),
  drag: () => pick(dragLines),
  drop: () => pick(dropLines),
  taskCreated: (task: Task) => `收到！让 ${executorName[task.executor] ?? task.executor} 去办「${task.title}」`,
  taskDone: (task: Task) => pick([`搞定啦！「${task.title}」完成了`, `「${task.title}」办好了，快来看看～`]),
  taskFailed: (task: Task) => `呜…「${task.title}」没做成`,
  taskCancelled: (task: Task) => `好的，「${task.title}」已经停下了`,
  taskInterrupted: (task: Task) => `「${task.title}」被中断了，可以重试哦`,
};

export function excerpt(text: string, max = 72) {
  const plain = plainText(text);
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}
