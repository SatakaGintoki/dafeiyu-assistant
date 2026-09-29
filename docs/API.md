# 前端对接协议 v1

本文件只描述协议，没有编写前端页面。基址为 `http://127.0.0.1:4318`。完整机器可读定义见 `openapi.json`；所有 JSON 使用 UTF-8。

## 接入顺序

1. 桌面宿主读取 `.data/api-token`；开发时可在本机注入。请求携带 `Authorization: Bearer <token>`。
2. `GET /api/v1/state` 获取快照，包括 messages、tasks、settings、executors、busy、petState。
3. 用支持请求头的 fetch 连接 `/api/v1/events`。原生 EventSource 无法直接设置 Authorization，不要把令牌放到 URL 查询参数。
4. 每次连接收到 `sync.required` 后重新获取 `/state`，以快照校准断线期间状态；同步期间缓存新事件，按 seq 和资源 id 去重应用。
5. `POST /chat` 收到 202 后等待事件；不要把 HTTP 202 当作模型回复。

令牌不写入源码，不发送给第三方服务。API Key 只通过设置请求写入后端，所有读取接口仅返回 hasApiKey。

## 接口列表

所有下述短路径均以 `/api/v1` 开头。

| 方法与路径 | 用途 |
| --- | --- |
| GET /state | 最近 200 条消息和 200 个任务的全量快照，按创建顺序 |
| GET /settings | 设置（不返回 API Key） |
| PATCH /settings | 局部更新设置；有对话或任务在执行/排队时返回 409 |
| GET /executors | 可执行文件检测；available 不等于认证成功 |
| POST /chat | `{ "message": "你好" }`；202 返回 messageId |
| POST /chat/cancel | 取消本轮模型回复，已经创建的任务不受影响 |
| GET /messages | 最近 200 条消息 |
| GET /tasks | 最近 200 个任务 |
| POST /tasks | 创建任务；建议发送 Idempotency-Key 请求头 |
| GET /tasks/{id} | 任务详情，包括当前保留的日志 |
| POST /tasks/{id}/cancel | 取消排队任务或终止运行任务，等待终止后返回 |
| POST /tasks/{id}/retry | 仅对终态任务，新建一个尝试，parentId 指向原任务 |
| POST /tasks/{id}/followup | `{ "instruction": "补充要求" }`，新建排队任务 |
| GET /preferences | 偏好列表 |
| DELETE /preferences/{key} | 删除一条偏好，204 |
| GET /events | SSE 事件流 |
| GET /openapi.json | OpenAPI 3.1 规范 |

`GET /health` 不需要认证。`/internal/tool` 只供 Harness 插件使用，使用不同的临时令牌，不是前端接口。

## 创建任务

```json
{
  "title": "排查登录问题",
  "instruction": "检查登录逻辑，修复问题并说明验证结果。",
  "executor": "codex",
  "model": "",
  "workspace": "C:\\projects\\my-app"
}
```

仅 title、instruction 必填。executor 为 codex、claude、demo；省略时使用设置默认值。model 为空表示执行器自身默认模型，不承诺跨执行器模型通用。workspace 省略时使用设置中的目录；显式目录必须存在且位于该目录内部。新任务立即持久化并返回 201，再由队列运行。

相同 Idempotency-Key + 相同请求体返回已有任务；同键不同请求体返回 409。重新尝试必须换键。调用 retry/followup 会新建任务，因此调用方应避免自动重复提交这两个动作。

状态：`queued → running → succeeded / failed`；运行中取消为 `cancelling → cancelled`，排队任务可直接 cancelled。重启发现遗留运行任务时变成 interrupted。终态任务不会自动重跑。

`succeeded` 表示执行器成功结束。它不是独立的质量认证，也不表示文件一定发生变化。`result` 保存最终结果，`error` 保存失败原因，`logs` 最多保留 100 条，单条最多 4000 字符；大结果会明确标记截断。

## SSE

持久化事件格式：

```text
id: 42
event: task.updated
data: {"seq":42,"type":"task.updated","data":{"id":"...","status":"running"},"at":"2026-09-28T00:00:00.000Z"}

```

上面的任务 data 仅为示意；真实 task.updated 返回完整 Task 对象。

| 事件 | data |
| --- | --- |
| message.created | Message，按 id 去重后追加 |
| task.created / task.updated | Task，按 id 替换 |
| task.log | `{taskId, text, at}`，追加并限制本地日志长度 |
| chat.status | `{busy, petState}` |
| chat.progress | `{text}`，当前阶段说明，不是模型思维链 |
| chat.error | `{error}`，本轮回复失败 |
| settings.updated | Settings（不含 API Key） |
| pet.state | `{state}`：idle / thinking / working / waiting |
| sync.required | `{type:"sync.required", data:{url:"/api/v1/state"}}`，控制事件，无 seq |

断线后携带 Last-Event-ID；最多回放 1000 条，随后要求快照同步。心跳每 15 秒一次，为 SSE 注释行。客户端需要实现重连；断开事件连接不会取消任务。

第一版按完整消息推送，不逐 token 流式显示。新前端可先做阶段提示和整条回复；后台代码执行期间可以继续发送聊天消息。

## 设置

```json
{
  "runtime": "harness",
  "model": "deepseek-flash",
  "baseUrl": "https://api.deepseek.com",
  "defaultExecutor": "codex",
  "executorModel": "",
  "workspace": "C:\\projects\\my-app",
  "nickname": "陈同学",
  "taskTimeoutMinutes": 30,
  "apiKey": "仅在写入时提交"
}
```

模型 ID 由用户选择并由提供方运行时验证；第一版未内置会过时的模型下拉目录。codexPath、claudePath 可指定 `.exe`、Node 脚本或可识别的 npm 启动器绝对路径，不能填任意 shell 命令。apiKey 省略时不改变，空字符串清除保存的密钥。

## 错误

错误响应统一为 `{ "error": "说明" }`。400 参数错误，401 后端令牌无效，403 来源/目录不允许，404 不存在，409 当前忙碌或幂等冲突，413 请求体过大，503 服务关闭或 DeepSeek 未配置。

模型调用是在 202 之后异步发生，网络、凭据或模型错误通过 chat.error 和说明消息回传。不要只根据发送接口的 HTTP 状态判断聊天成功。
