import { execFileSync } from 'node:child_process';

export function proxyUrl(value: string): string | undefined {
  const parts = value.trim().split(';');
  const selected = parts.find(p=>p.startsWith('https='))?.slice(6)
    || parts.find(p=>p.startsWith('http='))?.slice(5) || (parts.length===1 ? parts[0] : '');
  if (!selected || selected.includes('=')) return;
  try {
    const url = new URL(selected.includes('://') ? selected : `http://${selected}`);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname!=='/') return;
    return url.origin;
  } catch { return; }
}

/** Honor the user's enabled Windows proxy for CLIs that do not read WinINET. */
export function applyExecutorProxy(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (process.platform!=='win32' || env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy) return env;
  try {
    const registry=execFileSync('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],{encoding:'utf8',windowsHide:true,timeout:3000,stdio:['ignore','pipe','ignore']});
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/.test(registry)) return env;
    const value=registry.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/)?.[1];
    const proxy=value && proxyUrl(value);
    if (proxy) {
      env.HTTPS_PROXY=proxy;
      if (!env.HTTP_PROXY && !env.http_proxy) env.HTTP_PROXY=proxy;
      if (!env.NO_PROXY && !env.no_proxy) env.NO_PROXY='localhost,127.0.0.1,::1';
    }
  } catch { /* Preserve normal CLI behavior when no system proxy can be read. */ }
  return env;
}
