import type { RequestHandler } from 'express';
import type { AppConfig } from '../config.js';
import { detectChromePath } from '../scraper/browser.js';

export function healthHandler(config: AppConfig): RequestHandler {
  const detected = config.chromePath ?? detectChromePath();
  return (_req, res) => {
    res.json({
      ok: true,
      chromePath: detected ?? '(using bundled Chromium)',
      chromeDetected: Boolean(detected),
      headless: config.headless,
      defaultMarketplace: config.defaultMarketplace,
      requestIntervalMs: config.requestIntervalMs,
      maxConcurrentAttempts: config.maxConcurrentAttempts,
    });
  };
}
