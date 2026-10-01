# 版本管理与回退

仓库使用 Git 管理，源码和发行标签按发布流程推送至 GitHub。`v0.1.0` 保留接入 Git 前的代码基线；`release/v0.2.0` 是历史分支名称，不代表当前版本。当前发行版本为 `v0.2.11`，包含流式回复、细分执行状态、事务本和持久提醒。源码与标签已推送至 GitHub。

尚无公开稳定版分发。本机安装目录部署成功不等于 NSIS 安装包构建成功；近期 NSIS 构建曾失败，不应上传中间 EXE。公开前按 `PUBLIC-PREVIEW.md` 逐项验收。

版本来源：根目录和 desktop 的 package.json / package-lock.json，以及 `shared/version.ts`；发布前保持一致。更新说明在根目录 `CHANGELOG.md`。

构建：根目录 `npm run check`，desktop 目录 `npm run check`、`npm run test:desktop`、`npm run package:win`。构建后从 desktop 运行 `node scripts/release-manifest.mjs`，记录 Git 提交、版本、SHA256 和未签名状态。构建时应使用已提交、干净的工作区。

本机部署：运行根目录 `scripts/deploy-desktop.ps1 -Version 0.2.0`。程序复制到 `%LOCALAPPDATA%/Programs/Dayu/versions/0.2.0`，临时数据下完成隔离验收后才更新桌面快捷方式。原版本的程序文件保持不变，上一目标另存为“大肥鱼管家-上一版本”。若 Windows 拦截或验证失败，则保留原入口，桌面仍保留新安装包及版本清单；不调整安全策略。

回退：退出当前应用，从“上一版本”入口启动。版本共用 `%APPDATA%/dayu-desktop-pet` 数据目录；0.2.0 使用兼容的新增记录和任务字段，旧版本会忽略这些新增信息，但不会展示项目、模板或检查点。回退程序不等于回退用户数据。重要数据请先备份整个用户数据目录，且在程序退出后备份。

任务检查点位于用户数据目录的 `data/checkpoints/`，恢复副本在其 `recovered/` 下。不会自动上传。数据未加密，可能包含个人文件；请自行保护应用数据目录。当前不自动清理检查点，长期使用需注意磁盘空间。


## v0.2.9 Windows 预览版

- Release：https://github.com/SatakaGintoki/zhuochong/releases/tag/v0.2.9
- 发布源码：938b6cc1b0cd6d7f315c86a5b70419f7f3b681c9。
- Windows 验证：https://github.com/SatakaGintoki/zhuochong/actions/runs/36863674185（成功）。
- Windows 构建、打包及发布：https://github.com/SatakaGintoki/zhuochong/actions/runs/36863722563（成功）。
- 提供 Dafeiyu-0.2.9-windows-x64.zip、SHA256SUMS.txt、release-0.2.9.json 和 README-WINDOWS.txt。
- 本地发布包整理到桌面“大肥鱼管家-发布包/0.2.9”，程序按版本放在 `%LOCALAPPDATA%/Programs/Dayu/versions/0.2.9`，桌面快捷方式指向程序；旧版可回退。
- ZIP 是未签名的完整程序目录，非 NSIS 安装器。事务本与编码任务保持独立。关闭应用或电脑关机期间不能实时提醒，重新启动后补查。

## v0.2.11 Windows 预览版

- Release：https://github.com/SatakaGintoki/zhuochong/releases/tag/v0.2.11
- 发布源码：b7ef7d784cde0aec243a0ea150151e68ceeaaba0。
- Windows 构建、目录启动验证和发行包校验：https://github.com/SatakaGintoki/zhuochong/actions/runs/36902798764（成功）。
- Electron 冒烟最初一次因设置页异步加载与固定 900ms 等待产生竞态失败；改为有界条件等待，未改变应用实现，修正提交 978ae77。重新验证：https://github.com/SatakaGintoki/zhuochong/actions/runs/36904245997（成功）。
- ZIP SHA256：8f391eb5ddfd234e8d0f3c1c77c9a087425cc54c5bbfeb93db6228526c081b9f。
- 包含 93 项后端和 17 项前端测试，以及隔离浏览器流式流程验收。直连支持文字增量；当前 Harness SDK 展示阶段并在结束后显示全文。
