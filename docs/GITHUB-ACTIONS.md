# GitHub Actions 与失败邮件

GitHub Actions 是仓库的自动构建和测试服务。邮件里出现 workflow failed 表示某次检查失败，具体失败步骤在邮件对应的 Actions 链接中；它不直接表示你电脑上的程序运行失败。历史失败会保留，之后修好也不会撤回已经收到的邮件。

## 已确认的两次历史失败

| 检查 | 原因 | 处理 |
| --- | --- | --- |
| [首次 Windows 发布构建](https://github.com/SatakaGintoki/zhuochong/actions/runs/36818804145) | 打包时 `desktop/node_modules/electron/dist` 不存在 | 发布流程明确执行 Electron 安装脚本，后续发布成功 |
| [0.2.11 分支验收](https://github.com/SatakaGintoki/zhuochong/actions/runs/36902773763) | 设置页异步加载项目，固定等待 900ms 后过早断言“管理项目（1）” | 改为有上限的条件等待；[修正后检查成功](https://github.com/SatakaGintoki/zhuochong/actions/runs/36904245997) |

[0.2.12 验收](https://github.com/SatakaGintoki/zhuochong/actions/runs/36978262380)及[发布构建](https://github.com/SatakaGintoki/zhuochong/actions/runs/36978291907)均已通过。当前状态以[main 分支检查](https://github.com/SatakaGintoki/zhuochong/actions/workflows/verify.yml)为准。

## 自动检查怎样触发

- 分支代码提交、Pull Request 和手动触发执行 Windows 验收。版本标签不再重复触发同一套验收；发布流程仍对标签源码运行测试和打包启动检查。
- 只有 Markdown 文档、展示截图或 Issue 模板的修改，跳过桌面验收。代码、锁文件、OpenAPI JSON 和工作流修改仍触发。
- 同一分支或 PR 有新提交时，取消旧的未完成验收，运行最新提交。
- Electron 二进制显式安装，避免仅装了 npm 包却没有运行时。
- 失败时上传隔离验收目录（报告及已生成截图），保留七天。数据来自测试环境，不使用个人 API Key。

## 收到新失败邮件

打开邮件中的对应链接，展开红色步骤。类型或测试错误查看该步骤日志；Electron 界面问题同时下载页面底部的 `isolated-desktop-test` 附件。不要只看旧失败记录的红色状态，要核对提交和时间。

若想调整邮件通知，可到 GitHub 个人 Settings → Notifications 中调整 Actions 通知，参见 [GitHub 官方说明](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)。当前没有更改个人通知偏好。

分支和路径过滤规则参见 [GitHub 工作流语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)。以后如果把这套检查设为必须通过的分支保护规则，要同时评估文档改动跳过检查后的合并策略。
