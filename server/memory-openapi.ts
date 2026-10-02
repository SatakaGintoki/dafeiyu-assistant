import { zodToJsonSchema } from 'zod-to-json-schema';
import { memoryInput, memoryUpdate } from './project-memory';
const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
const json=(schema:unknown)=>({'application/json':{schema}});
const responses=(schema:unknown,status='200')=>({[status]:{description:'操作结果',content:json(schema)},...Object.fromEntries([400,401,404,409,502,503].map(code=>[String(code),{description:'请求失败',content:json(ref('Error'))}]))});
const body=(schema:unknown)=>({required:true,content:json(schema)});
const schema=(s:any):any=>zodToJsonSchema(s,{$refStrategy:'none'});
const version={type:'object',required:['revision'],additionalProperties:false,properties:{revision:{type:'integer',minimum:1}}};
const id={in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}};
const key={in:'header',name:'Idempotency-Key',schema:{type:'string',maxLength:160}};
export const personalSchemas={
 ProjectMemory:{type:'object',required:['id','projectId','kind','content','revision','createdAt','updatedAt','source'],properties:{id:{type:'string',format:'uuid'},...schema(memoryInput).properties,revision:{type:'integer',minimum:1},createdAt:{type:'string',format:'date-time'},updatedAt:{type:'string',format:'date-time'},source:{type:'object',required:['type'],properties:{type:{enum:['manual','conversation']},messageId:{type:'string',format:'uuid'}}}}},
 ConnectionCheck:{type:'object',required:['ok','mode','detail'],properties:{ok:{type:'boolean'},mode:{enum:['api','demo']},detail:{type:'string'}}},
};
export const personalPaths={
 '/api/v1/project-memories':{
   get:{summary:'指定事务项目的当前记忆；删除后不再返回',parameters:[{in:'query',name:'projectId',required:true,schema:{type:'string',format:'uuid'}}],responses:responses({type:'array',items:ref('ProjectMemory')})},
   post:{summary:'手动保存项目记忆',parameters:[key],requestBody:body(schema(memoryInput)),responses:responses(ref('ProjectMemory'),'201')},
 },
 '/api/v1/project-memories/{id}':{
   patch:{summary:'按 revision 更新记忆，手动编辑更新来源标记',parameters:[id,key],requestBody:body(schema(memoryUpdate)),responses:responses(ref('ProjectMemory'))},
   delete:{summary:'删除活动记忆；不清除原始聊天、幂等记录或备份',parameters:[id,key],requestBody:body(version),responses:responses(ref('ProjectMemory'))},
 },
 '/api/v1/connection-check':{post:{summary:'测试已保存的模型 API 配置；消耗少量额度，不验证 Harness/CLI',requestBody:body({type:'object',additionalProperties:false}),responses:responses(ref('ConnectionCheck'))}},
};
