# 大肥鱼管家

一个有性格、能管理 AI 工作进度的 Windows 桌面搭档。聊天交代任务、记录事务和日程，后台执行，遇到中断后继续做。

当前版本 **0.2.9 · 早期预览**。[下载 Windows x64 预览版](https://github.com/SatakaGintoki/zhuochong/releases/tag/v0.2.9)。提供压缩包，解压全部文件后运行“大肥鱼管家.exe”；不是安装器，也未签名。不需要另装 Node.js；真实工作仍需个人模型凭据与已登录的执行器。

若 Windows 阻止启动，请查看系统提示和来源信息；不要关闭系统保护。尚无正式稳定版，已知限制见下文及发行说明。

## 能做什么

- 常驻桌宠、短对话、托盘召回和专注模式。
- 通过 DeepSeek 理解需求，调用已安装的 Codex、Claude Code 或 ZCode。
- 查看后台任务状态、结果、错误及文件变化，支持取消、超时和中断续做。
- Claude 优先恢复保存的会话；旧任务可从已有文件和日志继续，保留原任务 ID。
- 通用事务项目、待办、日程、笔记和确认后执行的学习/工作计划。
- 重复日程、时区、桌面提醒、免打扰和稍后提醒，重启后补查。
- 编码项目、模板、显式偏好与有限范围文件检查点。

适合已使用 AI 编程工具的学生和个人开发者。桌宠是入口，任务管理与可恢复执行是主要工作流。

## 第一次运行

需要 Windows、Git、Node.js 24 和 npm。下载或克隆仓库后，在**仓库根目录**打开 PowerShell：

```powershell
npm ci
npm --prefix desktop ci
npm run check
npm --prefix desktop run check
npm start
```

保持后端终端运行，在第二个终端的仓库根目录执行：

```powershell
npm --prefix desktop start
```

Electron 二进制缺失时执行 `npm --prefix desktop rebuild electron` 后重试。依赖下载需要联网。

**不花模型额度试用：** 双击角色打开面板，在设置中选择“演示”并保存。到任务页新建任务，执行器选择“演示”，填写“验证队列”。结束后应看到结果，但不会修改项目或调用模型。退出重开后，任务记录应仍存在。

**开始真实工作：** 设置中填写自己的 DeepSeek API Key，选择“直连管家”，指定测试项目目录，并选择已安装、登录的执行器。只需安装你要用的执行器。先尝试“只阅读项目并简短说明结构，不修改文件”。

本地检查只证明配置或程序路径可用，不代表账号、额度和权限通过。模型与执行器费用由各自服务收取。

## 出错时

| 现象 | 下一步 |
| --- | --- |
| 模型请求失败 | 检查 Key、地址、模型 ID 和额度；不要把 Key 发到 Issue |
| 找不到执行器 | 安装并登录 CLI，或设置程序绝对路径 |
| Claude permission denied | 查看日志里的权限模式和被拒工具，检查 CLI/项目/组织策略 |
| 任务失败或中断 | 处理错误后点“继续任务”；会话不可用时选“从文件继续” |
| 桌宠看不到 | 单击托盘图标召回，检查置顶开关；专注模式不取消桌宠置顶 |

继续任务保留原 ID、产物和失败历史，不保证外部操作可幂等重放。文件恢复生成副本，不覆盖项目。详见[任务续做](docs/task-resume.md)。

## 权限、数据与限制

- 默认 API 直连，Harness 可选；两者均可派发任务，演示模式不调用模型。
- Claude 默认仅允许文件工具；完全访问需显式开启，仍可能受 CLI 或组织策略限制。目录校验不是操作系统沙箱。
- 成功状态表示执行器报告成功并正常退出，不是独立证明业务目标完成。
- 同时只执行一个任务，只有一条管家对话。尚无日程、语音、逐字流式回复或费用预算功能。
- 凭据暂存在本地文件，尚未迁移到系统凭据保险库。聊天、检查点和任务结果也可能含私人数据。
- 开发数据在 `.data/`；安装版数据在 `%APPDATA%/dayu-desktop-pet/`。不要上传。开发版前后端分别退出；安装版退出会停止自己管理的后端和任务。
- Windows 是当前验证平台；浏览器预览不能代替原生窗口验收。签名、包体和稳定分发仍需完善。

## 开发与验收

```powershell
npm run check
npm run check:repository
npm --prefix desktop run check
npm --prefix desktop run test:desktop
npm run docs
```

Windows CI 从锁文件安装依赖并运行隔离验收；首次推送后才会实际运行 GitHub Actions。实时模型测试不属于 CI，手动运行会消耗服务额度。

[架构](docs/ARCHITECTURE.md) · [OpenAPI](docs/openapi.json) · [前端开发](desktop/README.md) · [发布门槛](docs/PUBLIC-PREVIEW.md) · [版本记录](CHANGELOG.md) · [贡献指南](CONTRIBUTING.md)

## 许可与素材

项目整体许可证尚待作者确认，目前未授予整体开源许可。第三方素材许可不等于本项目许可。[素材来源](desktop/assets/CREDITS.md) 已单独记录。本项目为非官方爱好者作品，与 DeepSeek 无关联。
