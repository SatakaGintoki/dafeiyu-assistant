# 流式回复与执行状态（0.2.11）

直连 DeepSeek 使用 `stream:true`，后端解析 UTF-8 SSE 和分片工具参数。首段文字立即发送，后续累计文字以最多约 20 次/秒刷新。工具调用只在本次模型流完整结束、参数拼接完成后执行；每次工具循环清除上一段临时文字。兼容返回普通 JSON 的 API 代理，但这种代理不提供逐字显示。

前后端继续独立：聊天请求仍返回 202，回复通过原 `/api/v1/events` 发送。

- `chat.stream`：`{id,text}`，id 是本轮用户消息 ID，text 是累计草稿，替换而不是追加。
- `chat.progress`：`{text}`，等待模型、正在回复、调用工具或整理结果。
- `/api/v1/state`：可选 `chatStream` 与 `chatProgress`，用于重连恢复；旧前端仍可读取原字段。
- `message.created`：最终持久化消息。完成后清除临时展示，避免重复。
- `chat.status` 的 `busy:false`：清除草稿和进度。取消、异常和流截断不保存草稿为成功回复，而保存明确的错误通知；已委派任务独立运行。

面板和桌宠区分聊天阶段与编码执行器运行/排队。最近十分钟内的失败任务，只有 error 明确包含权限拒绝时才显示“权限受阻”；原任务卡片一直保留该标识和具体错误。点击面板状态可定位任务，处理执行器权限后继续原任务。不会自动提升权限。其他错误保持普通失败展示。

当前 Harness SDK 的 `session.event` 支持步骤和工具事件，未暴露实时文本增量：Harness 展示阶段并在完成后展示全文。没有用伪打字动画冒充流式输出。

验收：`npm run check`、`npm --prefix desktop run check`；浏览器运行 `npx tsx desktop/scripts/check-chat-stream.ts`，可通过 `PLAYWRIGHT_MODULE_PATH` 指定外部 Playwright。脚本使用隔离数据和模拟模型流，验证首段提前显示、停止、完成去重、重载、权限处理入口，不访问真实模型凭据。

任务摘要只保留简短纯文本叙述，表格和代码保留在任务原始结果中。完整 Markdown 表格渲染扩展不在本次改动内。
