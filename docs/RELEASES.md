# 版本管理与回退

仓库为本机 Git 仓库，不自动推送远端。`v0.1.0` 保留接入 Git 前的代码基线；`release/v0.2.0` 是历史分支名称，不代表当前版本。当前桌面版本为 `v0.2.8`，发布准备文档与测试更新可在其后单独提交。

尚无公开稳定版分发。本机安装目录部署成功不等于 NSIS 安装包构建成功；近期 NSIS 构建曾失败，不应上传中间 EXE。公开前按 `PUBLIC-PREVIEW.md` 逐项验收。

版本来源：根目录和 desktop 的 package.json / package-lock.json，以及 `shared/version.ts`；发布前保持一致。更新说明在根目录 `CHANGELOG.md`。

构建：根目录 `npm run check`，desktop 目录 `npm run check`、`npm run test:desktop`、`npm run package:win`。构建后从 desktop 运行 `node scripts/release-manifest.mjs`，记录 Git 提交、版本、SHA256 和未签名状态。构建时应使用已提交、干净的工作区。

本机部署：运行根目录 `scripts/deploy-desktop.ps1 -Version 0.2.0`。程序复制到 `%LOCALAPPDATA%/Programs/Dayu/versions/0.2.0`，临时数据下完成隔离验收后才更新桌面快捷方式。原版本的程序文件保持不变，上一目标另存为“大肥鱼管家-上一版本”。若 Windows 拦截或验证失败，则保留原入口，桌面仍保留新安装包及版本清单；不调整安全策略。

回退：退出当前应用，从“上一版本”入口启动。版本共用 `%APPDATA%/dayu-desktop-pet` 数据目录；0.2.0 使用兼容的新增记录和任务字段，旧版本会忽略这些新增信息，但不会展示项目、模板或检查点。回退程序不等于回退用户数据。重要数据请先备份整个用户数据目录，且在程序退出后备份。

任务检查点位于用户数据目录的 `data/checkpoints/`，恢复副本在其 `recovered/` 下。不会自动上传。数据未加密，可能包含个人文件；请自行保护应用数据目录。当前不自动清理检查点，长期使用需注意磁盘空间。
