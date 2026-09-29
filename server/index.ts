import { existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
if(existsSync(join(root,'.env')))process.loadEnvFile(join(root,'.env'));
const port=Number(process.env.DAYU_PORT || 4318);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('DAYU_PORT 必须为有效端口');
const service=createApp({root,dataDir:process.env.DAYU_DATA_DIR,origins:process.env.DAYU_CORS_ORIGINS?.split(',').map(s=>s.trim())});
const server=service.app.listen(port,'127.0.0.1',()=>{
  const url=`http://127.0.0.1:${port}`;service.setInternalUrl(url);service.start();
  writeFileSync(join(service.store.dir,'connection.json'),JSON.stringify({url,tokenFile:join(service.store.dir,'api-token')},null,2),{mode:0o600});
  console.log(`大肥鱼后端已启动：${url}\n认证令牌文件：${join(service.store.dir,'api-token')}\n配置状态：${service.config.value.hasApiKey?'已配置 DeepSeek 凭据':'等待配置 DeepSeek API Key'}`);
});
server.on('error',async(error)=>{console.error('启动失败：',error.message);await service.close();process.exitCode=1;});
let closing=false;
async function shutdown(){if(closing)return;closing=true;await service.close();server.close();}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
