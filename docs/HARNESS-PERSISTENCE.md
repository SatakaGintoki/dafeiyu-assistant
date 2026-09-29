# Harness 常驻和外部任务派发验收

日期：2026-09-30。

## 运行方式

- 首次对话初始化 Harness，正常回复后保留进程及会话。
- 后续发送新输入、当前任务和偏好快照，不重复注入完整历史。
- 每 24 个成功轮次切换新会话，带入 SQLite 最近 24 条消息；运行进程继续复用。更早历史仍在数据库，但不保证模型记得所有历史。
- 取消、错误、配置变化或退出时关闭运行进程，下次请求重建。不会自动重发失败轮次，避免重复执行工具。
- 进度区分“正在初始化本地助手”和“正在等待模型回复”。当前仍以完整文本显示最终回复，尚未实现逐字流式输出。

## 自动测试

后端 58 项测试通过。真实 SDK + 模拟模型的集成测试增加了连续对话、历史保留、不重复注入历史、运行中取消、取消后重建，以及第 25 轮切换会话的断言。

## 真实 Harness

使用用户已在大肥鱼中保存的模型配置及凭据，在独立测试数据目录中执行两轮真实云端调用：

- 第一轮调用 dispatch_task 创建 demo 任务，约 4.76 秒。
- 第二轮调用 list_tasks，确认同一个任务 succeeded，并正确复述上一轮测试内容，约 3.98 秒。第二轮没有初始化事件。
- 只创建一个任务，没有委派给真实编码执行器，也没有修改项目文件。管家的模型调用是真实的，任务执行器是 demo。

单次耗时仅作为本次记录，不代表稳定性能基准。可运行 `node node_modules/tsx/dist/cli.mjs scripts/check-harness-live.ts` 复查；此脚本会使用应用保存的密钥产生真实模型调用费用。

## ZCode

本机桌面 ZCode 3.14.3 携带 CLI 0.16.9，入口为 `D:/Zcode/resources/glm/zcode.cjs`。该入口未加入 PATH，直接运行还需要指定它自己的 provider 配置路径。

本次使用 CLI 支持的 `--prompt`、`--cwd`、`--mode plan` 和 `--json`，请求读取独立测试文件并计算 17 + 25。真实返回 `ZCODE_DISPATCH_OK 42`，退出码 0。没有复用 ZCode 凭据到大肥鱼中，也没有修改其安装文件。

测试使用的环境变量：`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 指向 ZCode 自带的 `resources/config/provider/zcode-builtin.json`，`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 指向用户 `.zcode/v2/provider_config.json`。只向 ZCode 传入路径，没有读取或输出该文件的凭据内容。

后续已完成 ZCode 执行器适配，接入任务队列、设置和新建任务，包含结果解析、取消、超时和安装路径检测。真实写文件验收通过，详见 `ZCODE.md`。
