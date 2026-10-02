import { ApiError, type Config } from './config';
import type { ConnectionCheck } from '../shared/types';
export async function checkModelConnection(config:Config,fetcher:typeof fetch=fetch):Promise<ConnectionCheck> {
  if(config.value.runtime==='demo')return {ok:true,mode:'demo',detail:'演示模式可用；未验证在线模型或执行器。'};
  if(!config.apiKey)throw new ApiError(503,'请先保存 DeepSeek API Key');
  try {
    const response=await fetcher(config.value.baseUrl.replace(/\/+$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},body:JSON.stringify({model:config.value.model,messages:[{role:'user',content:'仅回复 OK'}],max_tokens:16,stream:false,thinking:{type:'disabled'}}),signal:AbortSignal.timeout(20000),redirect:'error'});
    if(!response.ok)throw new ApiError(502,`模型连接检查失败（HTTP ${response.status}），请检查地址、模型、凭据及额度`);
    const result=await response.json() as any;
    if(typeof result.choices?.[0]?.message?.content!=='string'||!result.choices[0].message.content.trim())throw new ApiError(502,'模型未返回有效文本');
    return {ok:true,mode:'api',detail:'模型 API 已响应。此检查会消耗少量额度，不验证 Harness 进程或编码执行器。'};
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(502,'模型连接检查超时或网络不可用，请检查接口地址和网络');}
}
