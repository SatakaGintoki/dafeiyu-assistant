import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskNotification } from '../server/conversation';
import type { Task } from '../shared/types';

test('long executor output stays intact while chat gets a short preview',()=>{
  const task={title:'整理项目',status:'succeeded',result:'执行器详细输出。'.repeat(200),error:''} as Task;
  const original=task.result;
  const text=taskNotification(task);
  assert.ok(text.length<220);
  assert.match(text,/完整内容在任务详情里/);
  assert.equal(task.result,original);
});

test('failure notifications preserve the reason instead of a partial result',()=>{
  const task={title:'整理项目',status:'failed',result:'部分输出',error:'Claude Code permission denied for: Bash'} as Task;
  assert.match(taskNotification(task),/permission denied for: Bash/);
  assert.ok(!taskNotification(task).includes('部分输出'));
});

test('task delivery tables stay in details instead of becoming raw Markdown in the short notification',()=>{
  const result='完成。文件已保存。\n## 交付文件\n| 文件 | 说明 |\n|---|---|\n| `rbtree_visual/rbtree.cpp` | C++17 红黑树 |';
  const text=taskNotification({title:'重写红黑树',status:'succeeded',result,error:''} as Task);
  assert.match(text,/完成。文件已保存。/);assert.match(text,/完整内容在任务详情里/);
  assert.ok(!/[|#`]/.test(text));assert.ok(!text.includes('C++17'));
});
