# Lite 与 Full 发行构建

默认推荐 Lite：支持直连 DeepSeek、演示、所有本项目管家工具、项目记忆、日程提醒和编码任务。Full 额外包含官方 Harness SDK。模型 Key 和编码执行器仍需用户自行配置。

两版都保留独立 Node.js 运行时，减少对本机环境的依赖。Lite 不安装 Harness 依赖树；Full 删除管家未使用的 Office 转换可选二进制。两版移除依赖中的 `.map` 调试映射，不删除许可证，也不声称支持 Harness 的通用 Office 转换功能。

## 本地构建

```powershell
npm --prefix desktop run build
npm --prefix desktop run package:prepare
node desktop/scripts/check-packaged-backend.mjs
```

`package:prepare` 默认 lite；使用 `npm --prefix desktop run package:prepare:full` 准备 Full。两版共用生成目录，但每次先清理已验证路径中的生成后端，避免 Full 依赖混进 Lite。不要并行准备两个版本。

在 desktop 目录用 electron-builder `--dir` 构建目录，指定 `--config.directories.output=release/lite` 或 `release/full`。准备的类型必须和输出目录相符。NSIS 构建入口为 `package:win` / `package:win:full`，公开预览流程继续使用 ZIP，不宣称本机 NSIS 已稳定。

Lite 锁文件为 `desktop/backend-lite.package-lock.json`，依赖清单为 `desktop/backend-lite.package.json`。根依赖改变时须同步核心依赖与锁文件；仓库检查会比对清单和版本。

## 切换与数据

两版使用相同的 `%APPDATA%/dayu-desktop-pet/` 个人数据。切换前等待任务和对话结束，并退出旧版。已有 Harness 配置在 Lite 中会保留，但会明确提示该能力缺失；用户可自行选择直连，或使用 Full。不是应用内自动下载 SDK：目前通过下载/安装 Full 获得可选 Harness 能力。

`Settings.harnessAvailable` 为只读能力字段，界面禁用轻量版的 Harness 按钮。后端同样拒绝选择不可用的 Harness，防止绕过界面；不会伪装为成功或自动回退演示。

## 验证

`check-packaged-backend.mjs` 直接启动产出的后端，验证依赖裁剪、能力字段、项目记忆、Direct 工具循环、演示任务；Full 额外通过真实 SDK 与本地模拟模型验证 Harness 工具调用。没有使用实际模型凭据。

`verify-packaged-app.mjs <应用目录> <隔离输出目录>` 验证原生启动、置顶、托盘/面板流程、HTTP 联通及演示任务。两个版本通过后，发行流程创建 ZIP、校验并上传，`release-版本.json` 记录下载与解压体积、SHA256、源码提交和构建运行 ID。

本机部分新构建 Electron 仍有启动前退出 2147483651 的问题，不能将后端测试当成原生窗口通过；以实际结果报告为准。旧安装目录、个人数据和过往版本不在裁剪范围内。
