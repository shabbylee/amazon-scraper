export interface ProxyCredentials {
  readonly username: string;
  readonly password: string;
}

/**
 * 解析后的代理端点：既能给 Chromium 的 --proxy-server 用，也能给 page.authenticate 用。
 */
export interface ParsedProxy {
  /** 原始 URL，作为 ProxyPool 内部的唯一键。 */
  readonly url: string;
  /** Chromium --proxy-server= 的值，形如 `http=host:port` 或 `socks5=host:port`。 */
  readonly serverFlag: string;
  /** 若 URL 携带 user:pass，则填充；否则 null。 */
  readonly credentials: ProxyCredentials | null;
}

/**
 * 把 `http://user:pass@host:port` 之类的 URL 解析成 ParsedProxy。
 * 无效 URL / 缺 hostname / 缺 port 时返回 null（调用方应过滤）。
 */
export function parseProxyUrl(rawUrl: string): ParsedProxy | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (!u.hostname || !u.port) return null;
  const scheme = u.protocol.replace(/:$/, '');
  if (!['http', 'https', 'socks4', 'socks5'].includes(scheme)) return null;
  const serverFlag = `${scheme}=${u.hostname}:${u.port}`;
  const credentials: ProxyCredentials | null = u.username
    ? {
        username: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
      }
    : null;
  return { url: trimmed, serverFlag, credentials };
}

/**
 * 解析 HTTP_PROXY_LIST 环境变量：逗号分隔的代理 URL 列表。
 * 空/未设置返回空数组；空白项会被剔除。
 */
export function parseProxyList(env: string | undefined | null): string[] {
  if (!env) return [];
  return env
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
