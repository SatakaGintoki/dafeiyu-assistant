# 表情素材接入（未发布）

用户提供三组透明 PNG，眨眼、点头、思考各四帧。复制到 desktop/src/assets/expressions/{blink,nod,think}/1..4.png，未重绘或改变原始像素；来源见 desktop/assets/CREDITS.md。

- 待机约每 3.5–7 秒眨眼一次，闭眼停留约 110ms。
- 打开面板或收到助手回复后，在正面空闲/等待状态播放点头。
- 思考期间以较慢帧率循环四帧；睡觉使用眨眼的第三帧。
- 侧身与背身沿用原素材。所有新增帧解码完成前回退原三视图，失败时保留回退图。
- 使用固定显示框和等比例底部对齐；每帧按相同 contain 规则生成透明点击掩码。
- 页面隐藏或系统要求减少动态效果时停止新增帧循环。资产以独立 URL 打包，不把 PNG 内嵌入 JavaScript。

验证：前端 15 项测试、TypeScript 和构建通过；check-pet-expressions.ts 使用隔离后端验证眨眼、点头、思考、睡觉、减少动态效果和透明掩码，截图在 work/pet-expressions-nBEfGK。真实 Electron 目录外烟雾测试通过（work/desktop-smoke-EER0zE，位于本机 etest/smoke 目录）。已安装的 0.2.9 尚未包含这些新增资产，需下次版本打包部署。

复现浏览器验证：安装/指定 Playwright 模块，通过 PLAYWRIGHT_MODULE_PATH 指定其 index.mjs，然后运行 npx tsx desktop/scripts/check-pet-expressions.ts。截图输出到忽略的 work 目录，不使用真实用户数据或模型 API。
