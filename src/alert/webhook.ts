/**
 * Webhook 回调：POST JSON 到用户配置的 URL（飞书机器人 / 钉钉 / Slack / 自定义）。
 * 超时 10s；失败记录但不重试（ADR-0005）。
 */

export interface WebhookPayload {
  readonly event: 'price_change';
  readonly watchKeyword: string;
  readonly marketplace: string;
  readonly changes: readonly {
    asin: string;
    title: string;
    oldPrice: number | null;
    newPrice: number | null;
    oldPriceText: string | null;
    newPriceText: string | null;
    changePct: number | null;
  }[];
  readonly detectedAt: string;
}

export interface WebhookResult {
  readonly ok: boolean;
  readonly status?: number;
  readonly error?: string;
}

export async function sendWebhook(url: string, payload: WebhookPayload): Promise<WebhookResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
