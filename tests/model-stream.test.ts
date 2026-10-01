import test from 'node:test';
import assert from 'node:assert/strict';
import { readModelStream } from '../server/model-stream';

const frame=(delta:unknown,finish_reason:unknown=null)=>`data: ${JSON.stringify({choices:[{delta,finish_reason}]})}\r\n\r\n`;
function response(text:string,split=false) {
  const bytes=new TextEncoder().encode(text);
  return new Response(new ReadableStream({start(c){if(split)for(const byte of bytes)c.enqueue(new Uint8Array([byte]));else c.enqueue(bytes);c.close();}}),{headers:{'Content-Type':'text/event-stream'}});
}
test('model SSE decodes split UTF-8 and CRLF, publishes cumulative text before completion',async()=>{
  const updates:string[]=[];
  const message=await readModelStream(response(': heartbeat\r\n\r\n'+frame({content:'你好'})+frame({content:'，在呢。'})+frame({},'stop')+'data: [DONE]\r\n\r\n',true),new AbortController().signal,t=>updates.push(t));
  assert.deepEqual(updates,['你好','你好，在呢。']);assert.equal(message.content,'你好，在呢。');
});
test('fragmented parallel tool calls are assembled by index with complete JSON arguments',async()=>{
  const message=await readModelStream(response(frame({tool_calls:[{index:1,id:'b',function:{name:'get_task_status',arguments:'{"id":'}},{index:0,id:'a',function:{name:'list_tasks',arguments:'{'}}]})+frame({tool_calls:[{index:0,function:{arguments:'}'}},{index:1,function:{arguments:'"task"}'}}]})+frame({},'tool_calls')),new AbortController().signal,()=>{});
  assert.deepEqual(message.tool_calls.map((c:any)=>[c.id,c.function.name,JSON.parse(c.function.arguments)]),[['a','list_tasks',{}],['b','get_task_status',{id:'task'}]]);
});
test('truncation and interrupted transport never become successful replies',async()=>{
  await assert.rejects(readModelStream(response(frame({content:'半句'})),new AbortController().signal,()=>{}),/中断/);
  await assert.rejects(readModelStream(response(frame({content:'半句'})+frame({},'length')),new AbortController().signal,()=>{}),/未完整/);
  await assert.rejects(readModelStream(response('data: {bad}\n\n'),new AbortController().signal,()=>{}));
});
test('cancelling while waiting for the next network chunk releases the stream',async()=>{
  let cancelled=false;
  const controller=new AbortController();
  const pending=readModelStream(new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Type':'text/event-stream'}}),controller.signal,()=>{});
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending,/cancelled/);assert.equal(cancelled,true);
});
test('non-streaming compatible endpoints still return their final response',async()=>{
  assert.equal((await readModelStream(Response.json({choices:[{message:{content:'done'}}]}),new AbortController().signal,()=>{})).content,'done');
});
