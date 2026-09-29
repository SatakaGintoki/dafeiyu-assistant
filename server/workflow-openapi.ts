const str={type:'string'};
const reference=(name:string)=>({$ref:`#/components/schemas/${name}`});
const json=(schema:unknown)=>({'application/json':{schema}});
const id={name:'id',in:'path',required:true,schema:str};
const errors={'400':{description:'参数无效'},'401':{description:'未认证'},'403':{description:'目录越界'},'404':{description:'未找到'},'409':{description:'忙碌、重复项目或不可恢复'}};
const get=(schema:unknown)=>({responses:{'200':{description:'成功',content:json(schema)},...errors}});
const post=(input:unknown,output:unknown,code='200')=>({requestBody:{required:true,content:json(input)},responses:{[code]:{description:'成功',content:json(output)},...errors}});
const remove={parameters:[id],responses:{'204':{description:'记录已删除，项目文件保持不变'},...errors}};
const obj=(properties:object,required:string[]=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const project=obj({name:{type:'string',maxLength:80},workspace:str,executor:reference('Executor'),notes:{type:'string',maxLength:4000}},['name','workspace','executor']);
const template=obj({name:{type:'string',maxLength:80},instruction:{type:'string',maxLength:12000}});
export const workflowSchemas={
  Project:{...project,properties:{...project.properties,id:str},required:['id','name','workspace','executor','notes']},
  TaskTemplate:{...template,properties:{...template.properties,id:str},required:['id','name','instruction']},
  FileChange:obj({path:str,kind:{enum:['added','modified','deleted']}}),
  Checkpoint:obj({status:{enum:['ready','complete','partial']},files:{type:'integer'},bytes:{type:'integer'},skipped:{type:'integer'},changes:{type:'array',items:reference('FileChange')},note:str},['status','files','bytes','skipped','changes']),
};
export const workflowPaths={
  '/api/v1/projects':{get:get({type:'array',items:reference('Project')}),post:post(project,reference('Project'),'201')},
  '/api/v1/projects/{id}':{delete:remove},
  '/api/v1/projects/{id}/activate':{post:{parameters:[id],...post(obj({}),reference('Settings'))}},
  '/api/v1/templates':{get:get({type:'array',items:reference('TaskTemplate')}),post:post(template,reference('TaskTemplate'),'201')},
  '/api/v1/templates/{id}':{delete:remove},
  '/api/v1/preferences/remove':{post:{requestBody:{required:true,content:json(obj({key:str}))},responses:{'204':{description:'偏好已移除'},...errors}}},
  '/api/v1/preferences/save':{post:post(obj({key:str,value:str}),reference('Preference'))},
  '/api/v1/diagnostics':{get:get(obj({version:str,checks:{type:'array',items:obj({name:str,ok:{type:'boolean'},detail:str})}}))},
  '/api/v1/tasks/{id}/recover':{post:{parameters:[id],...post(obj({}),obj({path:str})),description:'把任务执行前的检查点恢复到新的独立目录，不覆盖原项目'}},
  '/api/v1/tasks/{id}/reveal':{post:{parameters:[id],...post(obj({index:{type:'integer',minimum:-1,maximum:10000}}),obj({path:str})),description:'返回验证后的产物路径，index=-1 返回项目目录'}},
};
