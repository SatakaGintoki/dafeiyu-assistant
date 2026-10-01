# 事务本独立验收（2026-10-01）

本节以下保留修复前的验收记录。最新复验结果见文末。

验收对象：`81ef79d`（前端）及其父提交 `a01f200`（后端）。结论：主要功能可用，前后端分离保持，但正式发布验收暂不通过。此次没有修改业务代码、部署应用或使用真实用户数据。

## 已验证

- `npm run check`：后端类型检查及 86 项测试通过。
- `npm --prefix desktop run check`：前端类型检查及 13 项测试通过。
- `npm --prefix desktop run build`：React/Electron 构建通过。仍有大 chunk 和 Vite 配置将来兼容性的非阻断警告。
- `desktop/scripts/check-agenda-preview.ts`：隔离后端 + Chrome，11 项浏览器流程通过，未捕获页面错误。截图位于本地忽略目录 `work/agenda-preview-d8ozeH`。检查了提醒/项目页面截图，布局可用。
- 通用项目、待办/笔记、计划接受、归档/恢复、并发修改和编码任务隔离已有实现；沿用认证 REST/SSE，无另建前端事务数据库。

## 需要修复

### P1：错过 snoozed 中间状态会导致到期后不再弹窗

位置：`desktop/src/lib/reminders.ts:19`，同时影响 Electron 系统通知和浏览器提醒。

复现：第一次 pending 通知显示后，展示日志保存 `id:pending`；用户从其他窗口/设备操作或短时延后后，通知客户端在离线、退出或请求延迟期间没有读取到 snoozed；恢复时后端已经将同一通知改回 pending。由于日志仍是 pending，函数直接跳过，即使 revision 已从 1 变为 3，也不弹。

独立执行 deliverReminders 得到：首次 show.length=1，跳过 snoozed 快照后重新收到 pending 的 show.length=0。收件箱仍保留记录，但承诺的“稍后再提醒”没有弹窗。

建议：给每次提醒激活一个持久的投递代次或激活时间（仅新激活/延后到期更新），用 id+代次去重。不能简单用 revision，否则标题改动也会重弹。增加跨重启/断线漏掉中间状态的测试，必要时小幅扩展前后端协议。

### P2：零点截止待办被误判为上一天/已逾期

位置：`desktop/src/panel/agenda/Views.tsx:15`、`:44`。

服务端规范化时间为带毫秒的 UTC ISO，dayRange（Temporal）返回可能不带毫秒的字符串。字符串比较不是这个场景下可靠的时间比较。

复现：上海时区 2026-10-02 当天起点为 `2026-10-01T16:00:00Z`，正好零点截止的待办为 `2026-10-01T16:00:00.000Z`。二者 Date.parse 相等，但 UI 的 due >= from 为 false，due < from 为 true。因此今天列表漏项、逾期列表误收项，周范围结束边界也有类似问题。

建议：统一以 epoch milliseconds 比较范围与逾期；增加开始包含、结束排除及带/不带毫秒等价时间测试。

### P2：浏览器提醒弹层在事务改期/完成后仍保留旧内容

位置：`desktop/src/panel/agenda/WebPopups.tsx:13`。

弹层只订阅新增提醒，自己的 list 没有根据最新 snapshot 清理或更新。收件箱消失不代表弹层撤回；稍后再弹同一 id 也可能在现存 list 中产生重复项。

复现：在现有浏览器验收脚本改期并等待收件箱消失后，补查原 popup.count()，实测仍为 1。原脚本输出“rescheduling withdraws the old reminder”，但只验证收件箱，不验证右上角弹层，结论范围过宽。复现截图目录为 `work/agenda-preview-N1JUlI`，辅助脚本在忽略目录 `work/review-agenda-preview.ts`。

建议：弹层列表与后端最新 pending 集合校准，已处理/延后/取消的移除，标题修改更新，以 id 合并；增加旧弹层撤回与同 id snooze 重弹的浏览器断言。

## 桌面验收限制

本次执行 `node desktop/scripts/check-desktop.mjs`，Electron 在启动阶段退出，code=2147483651（0x80000003），没有完成本次 IPC/原生通知验收。构建成功与浏览器通过不能代替这个结果。

此前文档记录了目录树外运行成功，本轮未重复该方案，不能宣称本轮原生通知通过。也没有足够证据将本轮崩溃归因于某条 Windows 安全策略。发布前需要在可启动环境对当前产物重新跑 Electron smoke，特别是新通知投递代次的断线/重启场景。

真实 DeepSeek 口语理解、真实安装包、系统通知权限拒绝/勿扰模式的完整真机行为不在本轮已验证范围。

## 交接修复顺序

先修提醒投递语义和时间比较，再修浏览器弹层与覆盖不足的断言。重新跑现有检查、针对性回归和实际 Electron 通知验证后，再决定打包发布。保留当前用户安装版本及数据。


## 修复后复验（2026-10-01）

三个问题已修复：增加持久化 deliveryGeneration，断线错过 snoozed 状态仍可重新展示；日期区间改用时间戳；浏览器弹层按最新 pending 快照撤回、更新并按 ID 合并。

- 后端 86 项测试通过，包含重启后延后提醒代次断言。
- 前端 15 项测试通过，新增漏过中间状态/持久展示记录/旧日志兼容/免打扰和零点范围边界回归。
- React/Electron 构建通过。
- 浏览器 11 项流程通过，增加旧弹层确实 detached 的断言；截图 `work/agenda-preview-ekm8wt`。
- 当前构建复制到已存在的项目目录外隔离测试目录后，真实 Electron smoke 通过（exit=0）。IPC、提醒收件箱、两窗口/preload/图片和原有任务流程通过；主进程报告 supported=true、shown=1，展示日志为数值代次。证据：`C:/Users/chens/etest/smoke/work/desktop-smoke-bzpwvM/result.json`。

结论：本次三个缺陷修复及相应回归通过，原生通知在隔离目录外环境验证通过。原项目目录启动环境问题未根治；本次未替换用户安装版本、未发布 Release，也未进行真实 DeepSeek 云端或全部系统通知权限场景验证。
