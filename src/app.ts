import cors from 'cors';
import express, { type Express } from 'express';
import path from 'node:path';
import type { AppConfig } from './config.js';
import { healthHandler } from './routes/health.js';
import { scrapeHandler } from './routes/scrape.js';

export function createApp(config: AppConfig): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.static(config.publicDir));

  app.get('/api/health', healthHandler(config));
  app.post('/api/scrape', scrapeHandler(config));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  return app;
}
