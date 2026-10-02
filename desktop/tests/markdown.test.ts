import test from 'node:test';
import assert from 'node:assert/strict';
import { messageDisplay } from '../src/lib/message-display';
import type { Message, Task } from '../src/lib/types';

test('old collapsed task summaries recover source Markdown without modifying history or later attempts',()=>{
  const message={role:'assistant',content:'「红黑树」执行结束。\n完成。 ## 交付文件 | 文件 | 说明 | |---|---| …\n完整内容在任务详情里。'} as Message;
  const task={status:'succeeded',result:'完成。\n\n## 交付文件\n\n| 文件 | 说明 |\n|---|---|\n| `rbtree.cpp` | **C++17** |'} as Task;
  const original=message.content;
  const shown=messageDisplay(message,task);
  assert.ok(shown.includes('\n## 交付文件\n'));
  assert.ok(shown.includes('|---|---|\n'));
  assert.equal(message.content,original);
  assert.equal(messageDisplay(message,{...task,status:'running'}),original);
  assert.equal(messageDisplay(message,{...task,attempts:[{} as any]}),original);
  assert.equal(messageDisplay(message,undefined),original);
});
test('ordinary chat Markdown stays intact and recovered previews are bounded',()=>{
  const message={role:'assistant',content:'## 标题\n\n**重点**'} as Message;
  assert.equal(messageDisplay(message),message.content);
  const old={role:'assistant',content:'「任务」执行结束。\n旧输出 ## 标题\n完整内容在任务详情里。'} as Message;
  const shown=messageDisplay(old,{status:'succeeded',result:('## 内容\n\n文本段落。\n').repeat(1000)} as Task);
  assert.ok(shown.length<1300);assert.match(shown,/完整内容在任务详情里/);
});
