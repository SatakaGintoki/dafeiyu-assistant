# 事务本后端契约（未发布，API v1）

这是通用项目/事务管理，不局限于科目。后端实现位于 `server/agenda*.ts`，共享类型为 `shared/agenda.ts`，完整接口规范为 `docs/openapi.json`。前端尚未实现，已安装的 0.2.8 不包含此功能。

## 边界

- 保留原 `/api/v1/projects`、`/tasks` 编码工作流。事务本使用独立 `/api/v1/agenda` 和独立数据库记录种类，无工作目录、执行器或自动编码派发。
- 数据沿用本地 SQLite，无外部账号或日历服务。模型 API 不参与定时检查，没网络也可生成提醒。
- 后端提供持久通知收件箱及 SSE。操作系统通知、聊天卡片和日历界面由前端实现；仅完成本后端不能声称用户已收到桌面通知。
- 应用彻底退出/电脑关机时不执行；启动或唤醒后下一次 tick 补查。一次性提醒无补查时间限制；重复日程只补最近 30 天内最新一次，避免一次弹出几十次。
- 普通提醒不创建聊天消息，避免重复插入聊天历史。前端可以显示通知卡片，不能假装成模型已经回复。
- 无物理删除接口。事务 done/cancelled，项目 archived，计划草案 cancelled，记录保留。项目归档不修改事务完成状态，但暂停提醒并取消已有待处理提醒；恢复项目后重新参与检查，已经触发过的同一提醒不会重发。

## 认证及版本控制

沿用 `Authorization: Bearer <token>`、现有本地来源限制。401 应停止业务重试，进入重连/认证提示，避免渲染死循环。浏览器开发用配对的后端地址/令牌，不读取另一个实例的真实令牌。

所有写接口支持可选 `Idempotency-Key`（1–160 个字母、数字、下划线、点、冒号、连字符）。前端应为每一次用户操作生成 UUID，网络重试复用；不同操作使用新键。同键不同操作/参数返回 409。同键相同参数返回最初响应，之后 GET 校准，不能假定返回的是记录此刻的最新版本。

修改项目/事务/计划、确认计划和处理通知均要求当前 `revision`，服务端成功后加一。旧版本返回 409，重新读取并提示用户，不自动覆盖。新增、计划接受及幂等记录在同一个 SQLite 事务内提交。

## 数据结构

| 对象 | 含义及重点字段 |
|---|---|
| AgendaProject | 通用分类/项目。name、description、archived |
| AgendaItem | kind 为 todo/event/note；projectId 可空（收件箱）；title、notes、status |
| AgendaPlan | draft/accepted/cancelled；steps、itemIds；仅接受草案才生成待办 |
| AgendaNotification | pending/snoozed/acknowledged/cancelled；itemId、scheduledAt、occurrenceAt、snoozedUntil |

实体共有 `id`、`revision`、`createdAt`、`updatedAt`。通知另有 `itemRevision`。模型工具也经过同一组校验及事务服务。

### 待办、日程、笔记

- todo：可设 dueAt；可没有截止时间；reminderAt 或 reminderMinutesBefore 二选一。
- event：必须有 startsAt/endsAt，持续时间大于 0 且不超过 7 天；不接受 dueAt。可设置 recurrence。
- note：只保存文字，不接受时间或提醒。
- status 默认 open，改为 done/cancelled 会取消待处理和延后提醒。重开不会重新发送同一 scheduledAt 已触发的提醒；需要再次提醒时明确设置新时间。
- 改提醒时间/日程/时区/所属项目会取消旧待处理提醒，按新记录调度。仅改标题/笔记保留待处理提醒并更新其标题和版本。
- 传 `null` 清除 nullable 字段；省略字段表示不修改。更改 kind 时必须同时清除不适用字段。
- 历史截止时间允许保存。新设的过去提醒会在下一次非免打扰 tick 补发，不默默改成明天。

### 时间与重复规则

所有时间戳输入必须带 Z 或数字偏移，如 `2026-10-08T20:00:00+08:00`，响应规范化为 UTC ISO。`timezone` 是 IANA 时区，如 `Asia/Shanghai`。显示及编辑时按记录时区转换，不能直接截取 UTC 字符串当成本地时间。

首次默认时区来自操作系统，可通过事务偏好修改；只影响以后未指定时区的新记录，不改写已有记录。

仅 event 支持重复：

```json
{
  "frequency": "weekly",
  "interval": 2,
  "weekdays": [1, 4],
  "until": "2026-12-31",
  "exceptions": ["2026-10-08"]
}
```

- frequency 仅 daily/weekly；interval 为 1–52。
- weekdays 为周一=1…周日=7；仅 weekly 接受；省略则使用开始时间所在星期。周以周一开始，interval 以起始周为锚点。
- until 是包含在内的本地日期；exceptions 是跳过的本地日期。第一条 occurrence 不早于 startsAt。
- 时区运算使用 `@js-temporal/polyfill`，重复保持本地开始钟点，持续时间保持固定毫秒数。夏令时不存在的钟点向后平移，重复钟点选较早时刻（Temporal compatible）。
- 重复日程提醒使用 reminderMinutesBefore（0–525600），不能使用单一 reminderAt。
- 第一版没有月/年重复，没有任意 RRULE、单次改期、完成单次 occurrence 或外部日历同步。可以用 exceptions 跳过一天，再创建一次性事件补录。
- 对重复日程设置 done/cancelled 影响整组，前端必须明确提示，不标成“完成本次”。

## HTTP 接口

基础路径 `/api/v1/agenda`；请求/响应为 JSON。完整字段、必填项和枚举以 OpenAPI 为准。

| 方法及相对路径 | 行为 |
|---|---|
| GET 空路径 | 全量快照 projects/items/plans/notifications/preferences/scheduler/now |
| GET /projects、/items、/plans | 对应完整数组，包含已归档/完成/取消记录，由前端过滤 |
| GET /projects/:id、/items/:id、/plans/:id | 单条详情 |
| POST /projects、/items、/plans | 新建，201；计划只保存草案 |
| PATCH /projects/:id、/items/:id、/plans/:id | 更新，200；包含 revision |
| POST /plans/:id/accept | `{revision}`，原子生成关联待办并返回 accepted 计划 |
| POST /plans/:id/cancel | `{revision}`，取消草案 |
| GET /calendar?from=...&to=...&projectId=... | 按重叠范围展开 open 日程，忽略已归档项目；最多 366 天；按开始时间排序 |
| GET /notifications | pending/snoozed 通知，与快照相同 |
| POST /notifications/:id/action | `{revision,action:"acknowledge"}` 或 `{revision,action:"snooze",until:"..."}` |
| GET /preferences | 时区及免打扰偏好 |
| PATCH /preferences | 完整 `{timezone,quietStart,quietEnd}`；禁用免打扰时两个钟点均为 null |

返回错误为 `{error:string}`：400 参数错误，401 未认证，404 不存在，409 版本/幂等/状态冲突，500 服务内部错误。不要把失败显示为成功。

`GET /calendar` 不返回待办。今天/本周视图应将 todo 的 dueAt 和 event occurrence 分开呈现；无截止日期的待办放“未安排”。查询时间窗口为 `[from,to)`，跨界事件只要与区间重叠也会返回。from/to 在 URL 中应通过 URLSearchParams 编码，避免 `+08:00` 的加号被当成空格。

### 示例

创建项目：
```json
{"name":"个人网站","description":"内容、设计与发布安排"}
```

创建待办（将 projectId 替换为真实返回的 UUID）：
```json
{
  "projectId":"00000000-0000-4000-8000-000000000001",
  "kind":"todo",
  "title":"整理首页文案",
  "timezone":"Asia/Shanghai",
  "dueAt":"2026-10-09T18:00:00+08:00",
  "reminderAt":"2026-10-08T20:00:00+08:00"
}
```

完成待办：`PATCH /items/:id`，`{"revision":1,"status":"done"}`。这会同步取消该事务 pending/snoozed 提醒。

## SSE、提醒与重连

复用认证的 `GET /api/v1/events`（fetch 流，不使用不能传 Authorization 的裸 EventSource）。

- `agenda.changed`：data 为 `{operation,id}`，是失效提示，合并/防抖后刷新事务快照。
- `agenda.reminder`：data 为完整 AgendaNotification。提示收件箱变化，不是已送达证明。
- 现有 `sync.required`：除原 `/state` 外，还要重新 GET `/api/v1/agenda`；刷新状态后统一处理 pending 提醒。新模块快照不会塞入旧 `/state`，保护现有前端兼容。
- SSE 事件外层沿用 `{seq,type,data,at}`。保存 Last-Event-ID，但不能只依赖回放，因为旧事件可能已经被完成、改期或确认。

前端处理提醒顺序：刷新快照 → 确认通知仍是 pending → 根据本地免打扰设置判断展示 → 用 notification.id 去重后显示系统通知/卡片。新通知第一次出现展示一次；snoozed 期间不展示，之后同 id 从 snoozed 转回 pending 时允许再次展示。仅 title/revision 变化不重新弹窗。保存本地展示记录，以免重连/窗口重建重复弹窗；多窗口应由一个 Electron 主进程负责系统通知。

`acknowledge` 仅表示“知道了”，不完成事务。“完成”操作调用 item.update，“稍后提醒”调用 notification.action。按钮操作前取最新 revision；延后时间必须在未来 366 天内。

系统通知权限被拒绝时保留应用内未读卡片。不要在收到 SSE 时自动 acknowledge，否则用户可能根本没看到。系统弹窗是否成功不由后端保证。

调度器每 15 秒扫描一次；start() 立即扫描。`scheduler.running/lastTickAt/lastError` 可用于连接诊断。lastError 非空时提示提醒检查异常；服务下次 tick 会重试。免打扰期间不触发新通知或唤醒 snooze，结束后补查；已存在的 pending 卡片可以保留，但前端同样不弹出新系统通知。

提醒唯一键为 itemId + scheduledAt。写入通知与触发记录在同一事务内，即使 SSE 丢失，快照仍能恢复。现阶段 API 面向个人规模、全量读取，无分页与自动清理。

## 模型工具及计划约束

两种运行模式共享 `query_agenda` / `manage_agenda` 定义。模型使用严格校验的后端工具；日常事务不会产生编码 Task。日期歧义应追问。

计划：用户请求 → 模型/前端保存 draft → 展示步骤 → 用户确认 → accept → 生成关联 todo。后端保证状态机与原子性，是否用户明确要求/确认由聊天规则及前端确认交互落实。接受后通过 itemIds 修改实际待办，不允许重新编辑或重复接受原草案；每个步骤可独立完成。

模型上下文现在包含当前时间、事务默认时区、最多 200 条近期任务状态及近期通知引用的任务；直连每次工具循环刷新快照。状态询问要求实时调用查询工具，结果中的测试结论应归因于执行器。此改动改善状态来源，不代表通过测试模型就永远不会误述。

## 验证与开发

```text
npm run build
npm test
npm run docs
```

`tests/agenda.test.ts` 使用隔离数据库和可控时钟验证时区、补提醒、去重、计划回滚、HTTP/认证、模型工具流程；Harness 测试运行真实 SDK + 插件，模型服务器为本地模拟，不使用真实 API 凭据。

开发前端时可以在 PowerShell 为独立服务设置 `DAYU_DATA_DIR` 为仓库 `work/agenda-preview` 的绝对路径，`DAYU_PORT=4329`，再运行 `npm run dev`。不要同时使用已安装 App 的数据目录。令牌取该隔离目录的 api-token，通过现有代理配置配对；禁止在代码、截图或提交中泄露。

参考：Super Productivity 的任务与提醒分离、Khoj 的结构化自动化接口。本实现未复制两者源码。新增依赖为 Temporal 时区计算和 zod-to-json-schema 契约生成；FullCalendar 是后续前端的候选，不在本次安装范围。
