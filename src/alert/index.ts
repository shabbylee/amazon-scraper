import { sendLocalNotification } from './local.js';
import { sendWebhook, type WebhookPayload } from './webhook.js';

/**
 * Alert 分发器：根据 Watch 配置决定走哪些通道。
 * 见 docs/adr/0005-phase4-persistence-scheduler.md。
 */

export interface AlertContext {
  readonly watchKeyword: string;
  readonly marketplace: string;
  readonly webhookUrl: string | null;
  readonly notifyLocal: boolean;
  readonly payload: WebhookPayload;
}

export interface AlertResult {
  readonly webhookSent: boolean;
  readonly webhookOk?: boolean;
  readonly localSent: boolean;
}

export async function dispatchAlert(ctx: AlertContext): Promise<AlertResult> {
  let webhookSent = false;
  let webhookOk: boolean | undefined;
  let localSent = false;

  if (ctx.webhookUrl) {
    const wr = await sendWebhook(ctx.webhookUrl, ctx.payload);
    webhookSent = true;
    webhookOk = wr.ok;
    if (!wr.ok) {
      console.warn(`[alert] webhook failed: ${wr.error ?? `HTTP ${wr.status}`}`);
    }
  }

  if (ctx.notifyLocal) {
    const summary = ctx.payload.changes
      .slice(0, 3)
      .map((c) => `${c.title.slice(0, 30)}: ${c.oldPriceText ?? '?'} → ${c.newPriceText ?? '?'}`)
      .join('\n');
    const extra = ctx.payload.changes.length > 3 ? `\n…还有 ${ctx.payload.changes.length - 3} 条` : '';
    sendLocalNotification({
      title: `价格变化 — "${ctx.watchKeyword}"`,
      message: summary + extra,
    });
    localSent = true;
  }

  return { webhookSent, webhookOk, localSent };
}
