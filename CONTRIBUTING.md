# 参与开发

当前整体许可证待作者确认；正式接收外部代码贡献前先完成许可证选择。

使用 Node.js 24，在根目录和 desktop 分别运行 npm ci，再运行 README 中的验收命令。不提交依赖、数据、私人项目、聊天记录、凭据或安装目录。

前端位于 desktop，后端位于 server，协议在 shared。API 变化同步 shared/types.ts、server/openapi.ts 和生成的 docs/openapi.json。工具变化同时维护 Direct 与 Harness 定义。

修复提供复现步骤和回归测试，明确使用模拟执行器还是实际模型。没有执行的验证不能写为通过；不要为解决权限错误默认开启完全访问。任务状态、会话恢复和检查点变化需考虑旧数据和重复请求。

提交 Issue 前隐藏用户名、私人路径和任务内容。不发送 API Key、Authorization、secrets.json、数据库或整个数据目录。
