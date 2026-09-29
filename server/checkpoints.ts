import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute, sep } from 'node:path';
import { ApiError } from './config';
import type { FileChange, Task } from '../shared/types';

interface Snapshot { root: string; files: Record<string,string>; bytes: number; skipped: number }
const ignored=new Set(['.git','node_modules','dist','dist-electron','release','package-resources','.data','work','.next','.venv','venv','__pycache__']);
const sensitive=(name:string)=>/^\.env(?:\.|$)/i.test(name)||/^(secrets\.json|api-token|credentials.*)$/i.test(name)||/\.(pem|key|pfx)$/i.test(name);
export const CHECKPOINT_SCOPE='保存普通文件，最多 5000 个 / 50 MB；跳过依赖、构建目录、work、.data、密钥文件和符号链接。仅覆盖此范围，不保证所有私人信息都被排除。';
export function inside(root:string,path:string){const diff=relative(root,path);return diff===''||(!isAbsolute(diff)&&diff!=='..'&&!diff.startsWith('..'+sep));}
export class Checkpoints {
  private base:string;
  constructor(dataDir:string){this.base=join(dataDir,'checkpoints');}
  private directory(id:string){if(!/^[a-zA-Z0-9-]+$/.test(id))throw new ApiError(400,'无效任务 ID');return join(this.base,id);}
  private scan(root:string,dir:string):Snapshot{
    root=realpathSync(root);
    const files:Record<string,string>=Object.create(null);let bytes=0,skipped=0,fileCount=0;
    const walk=(folder:string)=>{
      for(const entry of readdirSync(folder,{withFileTypes:true})){
        const path=join(folder,entry.name);
        if(ignored.has(entry.name.toLowerCase())||sensitive(entry.name)||entry.isSymbolicLink()||inside(resolve(this.base),resolve(path))){skipped++;continue;}
        if(entry.isDirectory()){walk(path);continue;}
        if(!entry.isFile()){skipped++;continue;}
        const stat=lstatSync(path);
        if(stat.nlink>1){skipped++;continue;}
        if(fileCount>=5000||bytes+stat.size>50*1024*1024)throw new ApiError(409,'检查点超过 5000 个文件或 50 MB，请选择更小的项目子目录');
        const content=readFileSync(path);bytes+=content.length;
        if(bytes>50*1024*1024)throw new ApiError(409,'检查点超过 50 MB');
        const hash=createHash('sha256').update(content).digest('hex');
        const blob=join(dir,hash);
        if(!existsSync(blob))writeFileSync(blob,content,{flag:'wx',mode:0o600});
        files[relative(root,path).split(sep).join('/')]=hash;
        fileCount++;
      }
    };
    walk(root);return {root,files,bytes,skipped};
  }
  capture(task:Task){
    const dir=this.directory(task.id);mkdirSync(dir,{recursive:true});
    const before=this.scan(task.workspace,dir);
    writeFileSync(join(dir,'before.json'),JSON.stringify(before),{flag:'wx',mode:0o600});
    return {status:'ready' as const,files:Object.keys(before.files).length,bytes:before.bytes,skipped:before.skipped,changes:[],note:CHECKPOINT_SCOPE};
  }
  finish(task:Task){
    const dir=this.directory(task.id);
    const before=JSON.parse(readFileSync(join(dir,'before.json'),'utf8')) as Snapshot;
    const after=this.scan(task.workspace,dir);
    const changes:FileChange[]=[];
    for(const path of new Set([...Object.keys(before.files),...Object.keys(after.files)])){
      if(before.files[path]===after.files[path])continue;
      changes.push({path,kind:!before.files[path]?'added':!after.files[path]?'deleted':'modified'});
    }
    writeFileSync(join(dir,'after.json'),JSON.stringify(after),{mode:0o600});
    return {...task.checkpoint!,status:'complete' as const,changes,skipped:Math.max(before.skipped,after.skipped)};
  }
  recover(task:Task){
    const dir=this.directory(task.id);
    const before=JSON.parse(readFileSync(join(dir,'before.json'),'utf8')) as Snapshot;
    // Recovery always creates a fresh sibling under our data directory, never overwrites a project.
    const destination=join(this.base,'recovered',`${task.id}-${randomUUID()}`);
    mkdirSync(destination,{recursive:true});
    for(const [path,hash] of Object.entries(before.files)){
      const target=resolve(destination,path);
      if(!inside(destination,target)||!/^[a-f0-9]{64}$/.test(hash))throw new ApiError(409,'检查点清单无效');
      const content=readFileSync(join(dir,hash));
      if(createHash('sha256').update(content).digest('hex')!==hash)throw new ApiError(409,'检查点内容校验失败');
      mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,content,{flag:'wx',mode:0o600});
    }
    return destination;
  }
  reveal(task:Task,index:number){
    if(index===-1)return realpathSync(task.workspace);
    const change=task.checkpoint?.changes[index];
    if(!change||change.kind==='deleted')throw new ApiError(404,'产物文件不存在');
    const root=realpathSync(task.workspace),target=realpathSync(resolve(root,change.path));
    if(!inside(root,target))throw new ApiError(403,'产物路径已离开项目目录');
    return target;
  }
}
