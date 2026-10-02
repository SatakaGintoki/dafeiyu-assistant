# 大肥鱼桌宠 · 前端

DeepSeek 大肥鱼（鲸鱼娘）形象的桌面宠物，Electron + React 19 + Vite，负责和后端管家通信的全部交互界面。

Windows 桌面交付版自带后端和 Node.js，双击桌面“大肥鱼管家”即可使用。安装包、免安装部署和数据目录详见 `../docs/WINDOWS-APP.md`。以下命令和独立后端窗口说明适用于开发版。

角色立绘来自 [1190fasheqi/dafeiyu-pet](https://github.com/1190fasheqi/dafeiyu-pet)（MIT）：`src/assets/{front,side,back}.png` 三张原图**未做任何重绘或改色**，原三视图动画使用位移、缩放、旋转、CSS keyframes 与叠加层；用户提供的眨眼、点头、思考逐帧素材另见 [素材说明](assets/CREDITS.md)。

## 运行

```bash
# 1. 先启动后端（项目根目录，另开一个终端）
cd ..            # 或直接在根目录
npm start        # http://127.0.0.1:4318

# 2. 桌宠本体
cd desktop
npm install      # 若 Electron 二进制未下载，见下方「Electron 二进制」
npm run dev      # Vite + Electron，改前端代码热更新
```

只想在浏览器里看界面（不需要打包 Electron）：

```bash
cd desktop
npm run dev:web  # http://127.0.0.1:5173
```

浏览器模式渲染的是一个「假桌面」：壁纸、任务栏、宠物窗口和面板窗口，方便截图和调样式。可用参数：

隔离预览时，在启动 Vite 的终端设置 `DAYU_DATA_DIR` 为隔离后端数据目录的绝对路径。代理会从该目录读取 `connection.json` 和 `api-token`，令牌仅在 Vite 服务端使用。令牌文件更新后，下次请求自动读取；后端端口变化则需重启 Vite。

也可以显式设置 `DAYU_BACKEND_URL`，但必须同时指定 `DAYU_DATA_DIR`、`DAYU_TOKEN_FILE` 或 `DAYU_API_TOKEN`，避免把真实后端的令牌误配给测试后端。显式令牌优先于令牌文件。

认证回归脚本：在项目根目录运行 `node node_modules/tsx/dist/cli.mjs desktop/scripts/check-auth-preview.ts`。需可用的 Playwright 和 Chrome；可通过 `PLAYWRIGHT_MODULE_PATH` 指定 Playwright 的绝对模块路径。测试使用隔离演示后端，覆盖 401、令牌轮换、断线与恢复，不调用模型、不启动真实桌宠。

浏览器验证不等于 Electron 验收：透明窗口、鼠标穿透、IPC、内置后端及退出清理仍需桌面模式验证。

| 参数 | 作用 |
| --- | --- |
| `?panel=chat\|tasks\|agenda\|settings` | 直接展开管家面板 |
| `?pet=idle\|thinking\|working\|waiting\|celebrate\|error\|sleeping\|offline\|dragging\|walking` | 强制宠物情绪，方便看动画 |

### Electron 二进制

`npm install` 只会装 npm 包，Electron 的 `electron.exe`（约 100MB）可能没有下载。判断方法：

```bash
ls node_modules/electron/dist/electron.exe   # 不存在就是没下
npm rebuild electron                         # 或者 npx install-electron
```

### 构建

```bash
npm run check    # 类型检查 + 连接恢复回归测试（需要根目录依赖）
npm run build    # 类型检查 + vite build + esbuild 打包主进程
npm start        # 构建后直接起 Electron
npm run test:desktop # 独立数据目录，验证真实 Electron 窗口、演示聊天、任务与实时更新
```

产物：渲染进程 → `dist/`，主进程/preload → `dist-electron/*.cjs`。

根目录的 `启动桌宠.cmd` 提供双击启动入口。后端离线时可点击聊天面板的“启动”按钮；后端在独立窗口运行，退出桌宠不停止后端，停止后端请在对应窗口按 Ctrl+C。

`test:desktop` 会短暂显示测试窗口，使用临时偏好和临时后端数据库，截图保存在根目录 `work/desktop-smoke-*`。它不调用付费模型，不修改正式设置。鼠标穿透、手动拖动、多显示器和托盘菜单仍需人工交互验收。

连接恢复时重新读取后端地址和令牌；浏览器开发代理也会在每次请求时重新读取令牌，所以先开预览、后开后端不需要重启 Vite。

## 结构

```
electron/main.ts        主进程：两个透明窗口、托盘、菜单、IPC、SSE、启动后端
electron/preload.ts     contextBridge 暴露 window.dayu（唯一跨进程接口）
src/lib/{host,webHost}  渲染进程这一侧的抽象：Electron 走 IPC，浏览器走 Vite 代理
src/lib/{api,store,sse} 后端协议：Bearer 鉴权、快照 + SSE 事件归约
src/pet/                桌宠：Pet.tsx（状态机/交互）、Bubble、Effects、sprites、台词库
src/panel/              管家面板：Chat / Tasks / Settings / Markdown
src/ui/                 图标、toast
src/styles.css          全部设计系统（含暗色模式与 reduced-motion）
```

### 两个窗口

| 窗口 | 尺寸 | 说明 |
| --- | --- | --- |
| 桌宠 | 360×460 | 透明、无边框、不占任务栏、默认置顶，常驻托盘 |
| 面板 | 440×680 | 透明、无边框，贴在宠物旁边，按需显示/隐藏 |

两个窗口加载同一个 `index.html`，用 hash（`#pet` / `#panel`）区分渲染内容。

### 鼠标穿透

桌宠窗口默认 `setIgnoreMouseEvents(true, { forward: true })`，所以桌面其他地方照常可点。渲染进程每次 `mousemove` 做一次命中检测（`document.elementFromPoint` + `[data-hit]` 标记，外加对精灵图的 alpha 掩码检测），只有真的落在角色或气泡上时才把窗口切成可交互。精灵图用 `?inline` 导入，避免 `file://` 下 canvas 被污染。

### 安全边界

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`
- 后端 token 只存在于主进程；渲染进程通过 `api:request` 走白名单路径（`^/api/v1/[\w/.-]*$`，拒绝 `..`）
- 所有 `window.open` 被拒绝，外链交给系统浏览器；`will-navigate` 一律阻止
- 浏览器模式不把 token 交给页面代码，而是由 Vite dev server 在代理层加 `Authorization`

## 和桌宠玩

| 操作 | 反应 |
| --- | --- |
| 单击 | 打个招呼 |
| 在头上来回摸 | 会害羞（猜左右方向） |
| 连着戳 | 会生气 |
| 拖动 | 侧身被拎着走，松手会喘口气 |
| 双击 | 打开对话面板 |
| 右键 | 菜单：聊天 / 任务 / 大小 / 散步 / 置顶 / 托盘 |
| 鼠标靠近 | 浮出快捷按钮（对话 / 任务 / 更多） |
| 闲置 3 分钟 | 打瞌睡（zzz 粒子） |

任务和对话的状态会实时反映到形象上：后台跑任务时转身面向桌面干活、头顶显示任务名，完成时跳起来庆祝，出错时冒汗，后端断开时褪色发灰并挂一个「!」。
