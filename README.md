# 大肥鱼管家 · 桌面 AI 助手

当前开发版本 **0.2.0**。新增项目管理、任务模板、配置诊断、文件变更清单、检查点恢复、偏好管理和专注模式。详见 `CHANGELOG.md`、`docs/RELEASES.md`；未完成项在 `docs/ROADMAP.md`，不把路线图当作已实现功能。

项目包含本地后端和 Electron + React 桌宠前端，通过 HTTP + SSE 通信。桌面端提供聊天、任务管理、设置、托盘和角色状态动画。

## 桌宠启动

已提供 Windows 安装版：安装后直接双击桌面“大肥鱼管家”，自带后端和运行环境。安装版启动、退出与数据目录说明见 `docs/WINDOWS-APP.md`。以下命令适用于开发版。

双击根目录的 `启动桌宠.cmd`，或在 `desktop` 目录运行 `npm.cmd start`。首次构建后显示桌宠，双击角色打开面板。如果提示后端未运行，点击面板中的“启动”；也可先运行 `启动后端.cmd`。后端在独立窗口运行，退出桌宠不会停止后端任务，关闭后端请在其窗口按 Ctrl+C。

新机器先在根目录和 `desktop` 目录分别安装依赖。若提示 Electron 未安装，在 `desktop` 目录执行 `npm.cmd rebuild electron`。桌面端详细说明见 `desktop/README.md`。

尚未配置 DeepSeek 时，可在设置中选择明确标注的演示模式体验流程；真实聊天需要填写个人 API Key。

## 启动

需要 Node.js 24 或更新版本。本机依赖已安装。

```powershell
cd 'C:\Users\chens\Desktop\桌面项目'
npm.cmd start
```

也可以运行根目录的 `启动后端.cmd`。服务只监听 `127.0.0.1:4318`，健康检查为 `GET /health`。终端内按 Ctrl+C 正常停止时会取消本服务拥有的正在运行的任务。不要把服务端口发布到公网。

新机器先执行 `npm.cmd ci`，再执行 `npm.cmd run check` 和 `npm.cmd run test:harness`。依赖版本由 `package-lock.json` 锁定；Harness SDK 固定为 `0.1.7-rc.2`。

## 配置 DeepSeek

尚未配置个人 DeepSeek API Key。没有 Key 时真实聊天返回 503，不会冒充模型回复。

两种配置方式任选一种：

1. 把 `.env.example` 复制为 `.env`，填写 `DEEPSEEK_API_KEY` 后启动服务。
2. 启动服务后，在另一个 PowerShell 中执行 `./scripts/configure.ps1`，隐藏输入 API Key。脚本通过设置 API 保存凭据。

环境变量优先于保存的凭据；使用 `.env` 后若要清除 Key，应同时清除 `.env` 中的值并重启。通过设置 API 传入空字符串只清除保存的 Key 和当前进程的 Key。

默认管家模型为 `deepseek-flash`，可在设置中改为账户实际可用的模型 ID。默认 `runtime=deepseek` 直接连接 API，支持完整的管家工具循环和任务派发，减少本地运行时启动开销。`runtime=harness` 可选择 DeepSeek Harness SDK；`runtime=demo` 仅提供明确标注的离线演示回复。已有配置不会被默认值覆盖，可在设置中切换。

`baseUrl=https://api.deepseek.com` 时：Harness 使用官方 `/anthropic` Messages 接口，直接 API 模式使用 `/chat/completions`。自定义地址在 Harness 模式必须是支持 Anthropic Messages 的根地址（自动追加 `/v1/messages`）；直接 API 模式必须是 Chat Completions 根地址。不要把两种协议混用。

## 认证与前端交接

首次启动生成 `.data/api-token`。除 `/health` 外，API 请求均需 `Authorization: Bearer <令牌>`。它是本地后端令牌，与 DeepSeek API Key 不同；不要把 DeepSeek Key 放进前端代码。

前端开发从以下文件开始：

- `docs/API.md`：接口、事件与对接顺序。
- `docs/openapi.json`：OpenAPI 3.1 规范，亦可认证访问 `/api/v1/openapi.json`。
- `shared/types.ts`：数据结构。
- `docs/ARCHITECTURE.md`：后端边界与运行机制。
- `docs/VERIFICATION.md`：实际验收结果和未验证项。

默认允许来自 `http://127.0.0.1:5173` 和 `http://localhost:5173` 的开发前端。其他来源通过 `DAYU_CORS_ORIGINS` 显式配置。未来桌面壳应从本机令牌文件读取令牌并通过受控 IPC 提供给渲染层，不应把令牌提交到仓库。

## 已实现

- ZCode 已作为第三个真实执行器接入任务队列、设置和新建任务界面，支持取消、超时和结果校验。使用方式和限制见 `docs/ZCODE.md`。

- 真实 Harness SDK 子进程 + 自定义管家工具插件，管家不加载 shell 工具。
- DeepSeek 对话、任务委派、任务查询/取消、显式偏好记忆。
- Codex / Claude Code 本地 CLI 适配，模型通过参数选择，未指定时沿用执行器默认。
- 单工作队列、任务重试、跟进任务、取消、超时、重启后的中断标记。
- SQLite 持久化消息、任务、设置、偏好与事件；同数据目录单实例锁。
- 任务完成通知、SSE 回放、前端状态快照、宠物状态事件。
- 请求校验、来源校验、Bearer 鉴权、日志脱敏、幂等创建任务。

工作目录默认是本项目下 `projects/`，可通过设置修改为真正的目标项目。模型工具不能任意选择配置目录以外的工作目录。

## 执行权限与第一版边界

Codex 使用 `workspace-write` 沙箱且不绕过审批；无法自动执行的动作应报错。Claude Code 使用 `dontAsk`，自动允许 Read/Edit/Write/Glob/Grep，不自动放开 Bash。实际权限不足将记录为失败，不伪装成功；这意味着部分需要执行命令的 Claude 任务暂不能全自动完成。

任务目录校验用于限制调度目标，并不能代替操作系统沙箱。Claude 的文件访问边界仍受其自身权限实现约束。项目代码和已配置的 CLI 扩展应视为可信本地内容。

`succeeded` 的含义是执行器以成功结果结束，不是后端对所有业务成果做了独立验收。结果字段会保存执行器报告。程序不自动发布、推送或联系他人。

目前只维护一条管家对话；Harness 常驻并复用会话，每 24 个成功轮次用近期历史切换新会话，正常对话不重新启动运行进程。完整本地消息保留在数据库。暂未实现多会话界面、复杂自动选模型、费用估算、工具级权限审批或语音。补充任务会新建后续工作，不会假称已实时注入正在运行的 CLI。v0.2.0 的文件变更清单来自检查点扫描，不是独立的业务结果验收。

正常关闭会终止本服务拥有的子进程；断电或强制杀进程后，遗留执行器是否还在运行需检查，系统只将原任务标记为中断，不会自动重跑该任务。

## 开发与验证

```powershell
npm.cmd run check         # TypeScript 检查 + 自动化测试，不调用付费模型
npm.cmd run test:harness  # 真实 Harness 握手，不发送模型请求
npm.cmd run test:live     # 真实执行器联通测试，会调用各自配置的模型
npm.cmd run docs          # 导出 OpenAPI
```

`work/` 保存测试临时目录，`.data/` 保存运行数据与敏感配置，均已忽略。请保管整个 `.data/`：凭据在本地文件中保存，并非操作系统凭据保险库。后续发布版本应迁移到系统凭据存储。
