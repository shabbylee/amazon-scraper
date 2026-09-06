import cors from 'cors';
import express, { type Express } from 'express';
import path from 'node:path';
import type { AppConfig } from './config.js';
import { createProxyPoolFromEnv, type ProxyPool } from './proxy/index.js';
import { detailHandler } from './routes/detail.js';
import { healthHandler } from './routes/health.js';
import { scrapeHandler } from './routes/scrape.js';

export interface AppDeps {
  /** Phase 2：代理池；未注入则从 HTTP_PROXY_LIST 环境变量创建内存池（可能为空池）。 */
  readonly proxyPool?: ProxyPool;
}

export function createApp(config: AppConfig, deps: AppDeps = {}): Express {
  const proxyPool = deps.proxyPool ?? createProxyPoolFromEnv();
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.static(config.publicDir));

  app.get('/api/health', healthHandler(config, proxyPool));
  app.post('/api/scrape', scrapeHandler(config, proxyPool));
  app.post('/api/detail', detailHandler(config, proxyPool));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  return app;
}
