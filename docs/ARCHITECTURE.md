# 后端架构与维护边界

```text
Electron + React 桌宠前端（desktop/）
    │ HTTP + SSE / API Token
Express API ─── SQLite Store（消息、任务、偏好、事件）
    │
管家 Runtime 接口
    ├── HarnessRuntime（可选，官方 SDK 子进程）
    │     └── 自定义 dayu-butler-tools 插件
    │            └── 本机 internal/tool（独立临时令牌）
    ├── DirectRuntime（默认，DeepSeek Chat Completions 工具循环）
    └── DemoRuntime（显式离线说明）
                  │
              ButlerTools
                  │
             TaskManager（单任务并发）
                  ├── Codex CLI
                  ├── Claude Code CLI
                  ├── ZCode
                  └── Demo executor
```

## Harness 集成

使用官方 `@deepseek-ai/dsh-sdk-client@0.1.7-rc.2`，首次对话启动本地 SDK runtime，正常回复后保留进程和会话，后续轮次复用。使用 sdk-minimal 模板，在本服务数据目录生成覆盖配置：禁用 Windows/Linux shell 工具及其终端栈，安装任务、状态、偏好及事务管家工具（包括 resume_task、query_agenda、manage_agenda）。实际测试检查模型收到的工具名单。

运行数据隔离在 `.data/harness`，不复用或修改用户全局 DSH_HOME。子进程只继承必要的系统环境、显式 DeepSeek 凭据和插件回连信息。默认使用 DeepSeek 官方 Messages 接口；不存在对本服务的 Codex/Claude 凭据转发。

官方 SDK 目前没有每个 prompt 的中途取消接口，因此取消管家回复时关闭该 runtime。已经持久化的委派任务由 TaskManager 管理，生命周期与该次回复独立。

新会话从最近 24 条消息、任务摘要和偏好初始化；后续轮次只提供本轮输入和当前任务、偏好快照，历史由同一 Harness 会话保持。每 24 个成功轮次切换新会话，以本地近期历史重新初始化，但不重启运行进程。这是有界近期历史策略，不是无损长期记忆或语义摘要。完整历史仍保存在 SQLite。取消、失败、配置变化或退出会关闭运行进程；下一次用户请求再初始化，失败轮次不自动重试，避免重复派发工作。

## 任务与执行器

工具调用只创建任务，立即返回 ID。任务队列默认串行，减少多个执行器同时修改同一项目的冲突。执行器进程通过 `spawn(..., {shell:false})` 启动，任务文本经 stdin 传入，不拼接到 shell 命令中。

CLI stdout 通过 StringDecoder 和有长度限制的 NDJSON 解码器解析。仅收到成功终态且进程退出码为 0 时标记 succeeded；Claude permission_denials 和错误结果均标记失败。仅检测到安装路径不代表账号或网络可用。

取消、任务超时及正常服务关闭会终止服务拥有的进程树。重启后不会重跑遗留 running/cancelling 任务，它们变成 interrupted。强杀/断电后可能遗留外部进程，需先确认；当前不声称提供操作系统级的崩溃进程回收。

resume 在原任务 ID 上继续未完成工作，Claude 优先使用保存的会话 ID，其他情况根据文件和记录续做。followup 仍创建带摘要的新任务；两者均不是运行中注入指令。详见 task-resume.md。

## 一致性与存储

SQLite WAL 保存任务、消息、设置、偏好和追加事件。任务创建与 Idempotency-Key 记录使用同一个事务。日志事件单独推送，避免每个日志片段都携带整份任务历史。任务状态与事件写入不是跨模块的统一事务，因此客户端重连必须用 /state 校准，不能仅凭事件回放重建全部事实。

同一个数据目录通过本机 PID 锁避免多实例同时消费队列。锁损坏时明确报错，不猜测删除；旧 PID 不存在时才清除过期锁。

凭据单独存于 `.data/secrets.json`，后端令牌存于 `.data/api-token`，都不通过 GET 返回。当前是本地明文文件，不是操作系统保险库；仅适合受信任的个人电脑开发使用。数据库包含用户消息与任务结果，备份也应按私人数据保管。

## 后续扩展位置

- 新执行器：`server/executors.ts` 中的 Runner 接口。
- 新管家能力：`server/tools.ts` 和 `server/harness-plugin.mjs`，同步维护工具 schema 与测试。
- 替换模型运行层：实现 `server/runtime.ts` 的 Runtime 接口。
- 前端：仅依赖 `shared/types.ts`、OpenAPI 和事件协议，不导入 Harness 内部包。
- 多并发/多工作区：扩展 TaskManager，先实现同目录互斥再增加并发。

## 依据

- [DeepSeek Harness 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [官方 TypeScript SDK](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md)
- [Harness 工具扩展契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md)
- [DeepSeek 工具调用](https://api-docs.deepseek.com/guides/tool_calls/)
- [Claude Code 非交互执行](https://code.claude.com/docs/en/headless)
- [Codex 非交互执行](https://developers.openai.com/codex/noninteractive)
