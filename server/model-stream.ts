import { ApiError } from './config';

/** Decode UTF-8 SSE across arbitrary network boundaries, including tool argument fragments. */
export async function readModelStream(response:Response, signal:AbortSignal, onText:(text:string)=>void) {
  if(!response.headers.get('content-type')?.includes('text/event-stream')) {
    const body:any=await response.json(); return body.choices?.[0]?.message;
  }
  if(!response.body)throw new ApiError(502,'模型响应流为空');
  const reader=response.body.getReader(), decoder=new TextDecoder();
  let buffer='',content='',finished=false,doneSeen=false;
  const calls=new Map<number,any>();
  const consume=(frame:string)=>{
    const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data)return;
    if(data==='[DONE]'){finished=true;doneSeen=true;return;}
    const body=JSON.parse(data);if(body.error)throw new ApiError(502,'模型响应流返回错误');
    const choice=body.choices?.[0]; if(!choice)return;
    if(choice.finish_reason && !['stop','tool_calls'].includes(choice.finish_reason))throw new ApiError(502,'模型未完整完成回复，请缩小问题范围或重试');
    if(choice.finish_reason)finished=true;
    const delta=choice.delta||{};
    if(typeof delta.content==='string'){content+=delta.content;onText(content);}
    for(const part of delta.tool_calls||[]){
      if(!Number.isInteger(part.index)||part.index<0||part.index>=8)throw new ApiError(502,'工具调用序号无效');
      const call=calls.get(part.index)||{id:'',type:'function',function:{name:'',arguments:''}};
      if(part.id)call.id+=part.id;
      if(part.function?.name)call.function.name+=part.function.name;
      if(part.function?.arguments)call.function.arguments+=part.function.arguments;
      calls.set(part.index,call);
    }
  };
  const abort=()=>{void reader.cancel(signal.reason).catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  try {
    while(true){
      signal.throwIfAborted();const {value,done}=await reader.read();
      buffer+=decoder.decode(value,{stream:!done});
      buffer=buffer.replace(/\r\n/g,'\n');
      let end:number;while((end=buffer.indexOf('\n\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+2);}
      if(buffer.length>1024*1024 || content.length>128000)throw new ApiError(502,'模型响应过大');
      if(doneSeen)break;
      if(done){if(buffer.trim())consume(buffer);break;}
    }
    signal.throwIfAborted();
    if(!finished)throw new ApiError(502,'模型连接中断，回复未完整接收');
    return {role:'assistant',content, ...(calls.size?{tool_calls:[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,c])=>c)}:{})};
  } finally {signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
