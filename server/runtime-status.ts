import type { Config } from './config';
import { executorCatalog } from './executors';
import { APP_VERSION } from '../shared/version';

export function runtimeStatus(config: Config) {
  return {
    version: APP_VERSION, runtime: config.value.runtime,
    defaultExecutor: config.value.defaultExecutor,
    observedAt: new Date().toISOString(),
    claudeFullAccess: !!config.value.claudeFullAccess,
    executors: executorCatalog(config),
    note: 'available 仅表示程序已找到，不代表云端连接已验证。历史任务错误不代表当前配置；配置变化不会自动重试旧任务。',
  };
}
