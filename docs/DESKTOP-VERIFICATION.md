# 桌面端完善与验收

日期：2026-09-29。

## 本次修复

- 浏览器开发代理每次请求重新读取本地令牌，修复先开预览后开后端时认证无法恢复的问题。
- SSE 防止重复启动，重连重新读取后端地址及凭据，停止时清理重试等待。
- 初始连接查询的迟到结果不再覆盖实时连接事件；查询失败时进入离线状态。
- 开发启动失败、退出时回收 Vite 服务。
- 增加根目录“启动桌宠.cmd”和可重复运行的桌面集成验收。

## 已通过

- 前端类型检查和 4 项连接回归测试。
- 前端与 Electron 构建。
- Electron 44.4.5 官方 Windows x64 运行文件下载，SHA256 与官方发布清单一致。
- 真实 Electron 两窗口加载、preload 桥接、角色图片加载和截图检查。
- 后端离线时，聊天面板显示离线提示和启动按钮。
- 独立后端演示模式下，通过真实 Electron IPC 发送聊天、创建任务、查询任务成功，并确认 SSE 更新进入聊天和任务界面。

运行：在 `desktop` 目录执行 `npm.cmd run check`、`npm.cmd run test:desktop`。临时数据库及截图保存在 `work/`。

## 尚未完成

- 真实 DeepSeek 聊天和模型委派：未找到项目密钥配置，本次未发云端模型请求。
- 本次未重新验证 Codex / Claude Code 真实云端联通。
- 手动拖动、鼠标穿透、多显示器和托盘完整交互验收。
- Windows 安装包现已构建；本机因应用控制策略未完成 NSIS 安装，已交付并验证免安装版本，详见 `WINDOWS-APP.md`。系统凭据保险库及前端构建体积优化尚未完成。

## 事务本前端验收（2026-10-01）

浏览器与 Electron 分开验证，结论分别记录。

浏览器（`desktop/scripts/check-agenda-preview.ts`，隔离演示后端，`work/agenda-preview-*`）：项目/待办/笔记归类、截止与提前提醒、改时间后旧提醒撤回、“知道了”不改状态、重载不重弹、完成后取消提醒、稍后提醒到期再弹、计划草案不生成待办且确认一次只生成一次、周重复与例外日期、并发修改提示、归档恢复、其他页签不受影响，共 11 项通过；页面无控制台错误。

Electron（`desktop` 的 `npm run test:desktop`，真机 IPC 与主进程通知）：在原有聊天、任务、项目、模板、设置断言之外，补充事务日历 IPC、提醒入队、收件箱卡片和 `window.dayu.reminders.status()` 断言，实际观测到主进程发出 1 条系统通知并写入 `agenda-shown.json`。

注：本机 `C:\Users\chens\Desktop\桌面项目` 整个目录树会让 Electron 进程在启动阶段就以 0x80000003 静默退出——字节相同、SHA256 一致的 Electron 44.4.5 放在该目录树之外（例如用户目录下）可以正常运行。该目录带有沙箱标记（额外的 capability ACE、`Everyone` 的 `DeleteSubdirectoriesAndFiles` 拒绝项、`Kuronya\CodexSandboxUsers` 授权），单独复现拒绝项并不能复现崩溃，因此这是目录树/环境属性，不是构建产物或本次改动的缺陷。上述 Electron 结论是在目录树之外跑仓库自带的 `desktop/scripts/smoke.cjs`（未改动）得到的。

`VERIFICATION.md` 是 2026-09-28 的后端历史记录，其中“没有前端”描述不再代表当前项目。
