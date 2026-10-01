import { APP_VERSION } from '../shared/version';
import { workflowPaths,workflowSchemas } from './workflow-openapi';
import { agendaPaths,agendaSchemas } from './agenda-openapi';
const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
const json=(schema:unknown)=>({'application/json':{schema}});
const response=(description:string,schema?:unknown)=>({description,...(schema?{content:json(schema)}:{})});
const body=(schema:unknown)=>({required:true,content:json(schema)});
const errorResponses={'400':response('参数错误',ref('Error')),'401':response('认证失败',ref('Error')),'403':response('来源或目录不允许',ref('Error')),'404':response('资源不存在',ref('Error')),'409':response('忙碌或幂等冲突',ref('Error')),'503':response('尚未配置凭据或服务关闭',ref('Error'))};
const id={name:'id',in:'path',required:true,schema:{type:'string'}};
const string={type:'string'};
const settingsProperties={claudeFullAccess:{type:'boolean',default:false},runtime:{type:'string',enum:['harness','deepseek','demo']},model:string,baseUrl:{type:'string',format:'uri'},defaultExecutor:ref('Executor'),workspace:string,nickname:string,codexPath:string,claudePath:string,zcodePath:string,executorModel:string,taskTimeoutMinutes:{type:'integer',minimum:1,maximum:240}};

export const openApiDocument={
  openapi:'3.1.0',info:{title:'大肥鱼管家后端',version:APP_VERSION,description:'独立本地后端。通过 Bearer Token 认证；SSE 使用 fetch 流。CLI 运行成功表示执行器已结束，不等于独立验证业务目标。'},
  servers:[{url:'http://127.0.0.1:4318'}],security:[{bearerAuth:[]}],
  paths:{
    ...agendaPaths,
    ...workflowPaths,
    '/health':{get:{summary:'公开的存活检查',security:[],responses:{'200':response('服务存活',{type:'object',properties:{ok:{type:'boolean'},service:string,version:string}})}}},
    '/api/v1/state':{get:{summary:'获取前端完整快照（最近 200 条消息/任务）',responses:{'200':response('当前状态',ref('State')),...errorResponses}}},
    '/api/v1/settings':{
      get:{summary:'读取设置；永不返回 API Key',responses:{'200':response('设置',ref('Settings')),...errorResponses}},
      patch:{summary:'更新设置；工作期间返回 409',requestBody:body({type:'object',additionalProperties:false,properties:{...settingsProperties,apiKey:{type:'string',writeOnly:true,description:'省略则保持原值，空字符串清除。使用 .env 时应同时清除环境变量。'}}}),responses:{'200':response('更新后的设置',ref('Settings')),...errorResponses}},
    },
    '/api/v1/executors':{get:{summary:'检测执行器程序；available 不代表已登录或联网成功',responses:{'200':response('执行器列表',{type:'array',items:ref('ExecutorInfo')}),...errorResponses}}},
    '/api/v1/tasks':{
      get:{summary:'最近 200 个任务（创建顺序）',responses:{'200':response('任务列表',{type:'array',items:ref('Task')}),...errorResponses}},
      post:{summary:'创建后台任务',parameters:[{in:'header',name:'Idempotency-Key',schema:{type:'string',maxLength:160},description:'同一个键和请求体不重复派发；同键不同请求返回 409'}],requestBody:body(ref('CreateTask')),responses:{'201':response('已持久化并排队',ref('Task')),...errorResponses}},
    },
    '/api/v1/tasks/{id}':{get:{summary:'任务详情',parameters:[id],responses:{'200':response('任务',ref('Task')),...errorResponses}}},
    '/api/v1/tasks/{id}/cancel':{post:{summary:'取消任务；等待进程退出后返回',parameters:[id],responses:{'200':response('最终状态',ref('Task')),...errorResponses}}},
    '/api/v1/tasks/{id}/retry':{post:{summary:'为已结束任务创建新尝试，保留原任务',parameters:[id],responses:{'201':response('新任务',ref('Task')),...errorResponses}}},
    '/api/v1/tasks/{id}/resume':{post:{summary:'继续未完成任务，保留原 ID、日志和文件；Claude 优先恢复会话',parameters:[id],requestBody:{required:false,content:json({type:'object',additionalProperties:false,properties:{fromFiles:{type:'boolean',default:false,description:'放弃模型会话恢复，只根据现有文件与任务记录继续'}}})},responses:{'200':response('原任务已重新排队',ref('Task')),...errorResponses}}},
    '/api/v1/tasks/{id}/followup':{post:{summary:'创建新的排队任务并携带原任务摘要；不是向运行中 CLI 实时注入',parameters:[id],requestBody:body({type:'object',required:['instruction'],additionalProperties:false,properties:{instruction:{type:'string',minLength:1,maxLength:8000}}}),responses:{'201':response('跟进任务',ref('Task')),...errorResponses}}},
    '/api/v1/chat':{post:{summary:'发送消息；异步回复从 SSE 获取',requestBody:body({type:'object',required:['message'],additionalProperties:false,properties:{message:{type:'string',minLength:1,maxLength:12000}}}),responses:{'202':response('已接受',{type:'object',properties:{messageId:string,status:{const:'accepted'}}}),...errorResponses}}},
    '/api/v1/chat/cancel':{post:{summary:'取消当前管家回复；已委派任务独立运行',responses:{'200':response('已取消',{type:'object',properties:{cancelled:{type:'boolean'}}}),...errorResponses}}},
    '/api/v1/messages':{get:{summary:'最近 200 条消息',responses:{'200':response('消息列表',{type:'array',items:ref('Message')}),...errorResponses}}},
    '/api/v1/preferences':{get:{summary:'读取已保存的显式偏好',responses:{'200':response('偏好列表',{type:'array',items:ref('Preference')}),...errorResponses}}},
    '/api/v1/preferences/{key}':{delete:{summary:'删除偏好',parameters:[{in:'path',name:'key',required:true,schema:string}],responses:{'204':response('已删除'),...errorResponses}}},
    '/api/v1/events':{get:{summary:'SSE 事件流；每次连接收到 sync.required 后获取 /state 校准',parameters:[{in:'header',name:'Last-Event-ID',schema:{type:'integer',minimum:0}}],responses:{'200':{description:'持久化事件最多回放 1000 条，再发送 sync.required；每 15 秒心跳。',content:{'text/event-stream':{schema:string}}},...errorResponses}}},
    '/api/v1/openapi.json':{get:{summary:'此接口规范',responses:{'200':response('OpenAPI 3.1 文档',{type:'object'}),...errorResponses}}},
  },
  components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer'}},schemas:{
    ...agendaSchemas,
    ...workflowSchemas,
    Executor:{type:'string',enum:['codex','claude','zcode','demo']},
    TaskStatus:{type:'string',enum:['queued','running','cancelling','succeeded','failed','cancelled','interrupted']},
    Error:{type:'object',required:['error'],properties:{error:string}},
    CreateTask:{type:'object',required:['title','instruction'],additionalProperties:false,properties:{title:{type:'string',minLength:1,maxLength:160},instruction:{type:'string',minLength:1,maxLength:24000},executor:ref('Executor'),model:{type:'string',maxLength:120},workspace:{type:'string',description:'默认使用设置的工作目录，显式目录必须在其内部'},projectId:{type:'string',format:'uuid'},parentId:{type:'string',format:'uuid'}}},
    Task:{type:'object',required:['id','title','instruction','executor','model','workspace','status','createdAt','updatedAt','result','error','logs'],properties:{id:{type:'string',format:'uuid'},title:string,instruction:string,executor:ref('Executor'),model:string,workspace:string,status:ref('TaskStatus'),createdAt:{type:'string',format:'date-time'},updatedAt:{type:'string',format:'date-time'},result:string,error:string,logs:{type:'array',items:string,maxItems:100},checkpoint:ref('Checkpoint'),projectId:{type:'string',format:'uuid'},parentId:{type:'string',format:'uuid'},sessionId:string,resumeMode:{enum:['session','workspace']},attempts:{type:'array',items:{type:'object',properties:{at:string,status:ref('TaskStatus'),result:string,error:string,sessionId:string}}}}},
    Message:{type:'object',required:['id','role','content','createdAt'],properties:{id:string,role:{enum:['user','assistant','system']},content:string,createdAt:{type:'string',format:'date-time'},taskId:string}},
    Settings:{type:'object',properties:{...settingsProperties,hasApiKey:{type:'boolean',readOnly:true}}},
    ExecutorInfo:{type:'object',properties:{id:ref('Executor'),name:string,available:{type:'boolean'},detail:string}},
    Preference:{type:'object',properties:{key:string,value:string}},
    Event:{type:'object',properties:{seq:{type:'integer'},type:string,data:{},at:{type:'string',format:'date-time'}}},
    State:{type:'object',properties:{messages:{type:'array',items:ref('Message')},tasks:{type:'array',items:ref('Task')},settings:ref('Settings'),executors:{type:'array',items:ref('ExecutorInfo')},busy:{type:'boolean'},petState:{enum:['idle','thinking','working','waiting']}}},
  }},
};
