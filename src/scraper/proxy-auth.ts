import type { Page } from 'puppeteer';
import { parseProxyCredentials, type Proxy } from './proxy.js';

/**
 * 代理认证（ADR-0003 的收尾）：Chrome 不会自动用 URL 里的 userinfo 做代理认证，
 * 通过 CDP Fetch 域响应 407 challenge，注入 Proxy-Authorization。
 * 只在代理 URL 带凭证时启用；无凭证 = 不拦截，零开销。
 */

export async function applyProxyAuth(page: Page, proxy: Proxy): Promise<void> {
  const credentials = parseProxyCredentials(proxy.url);
  if (!credentials) return;

  let session: Awaited<ReturnType<Page['createCDPSession']>> | null = null;
  try {
    session = await page.createCDPSession();
    await session.send('Fetch.enable', { handleAuthRequests: true });
    session.on('Fetch.authRequired', async (event) => {
      try {
        await session?.send('Fetch.continueWithAuth', {
          requestId: event.requestId,
          authChallengeResponse: {
            response: 'ProvideCredentials',
            username: credentials.username,
            password: credentials.password,
          },
        });
      } catch {
        // 请求可能已取消/页面已关闭，忽略
      }
    });
  } catch (err) {
    console.warn('[proxy-auth] setup failed:', err instanceof Error ? err.message : String(err));
  }
}
