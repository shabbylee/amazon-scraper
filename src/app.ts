import cors from 'cors';
import express, { type Express } from 'express';
import path from 'node:path';
import type { AppConfig } from './config.js';
import type { Persistence } from './db/persistence.js';
import { healthHandler } from './routes/health.js';
import { scrapeHandler } from './routes/scrape.js';
import { detailHandler } from './routes/detail.js';
import { historyHandler } from './routes/history.js';
import { listingsHandler } from './routes/listings.js';
import {
  watchCreateHandler,
  watchDeleteHandler,
  watchListHandler,
} from './routes/watch.js';

export function createApp(config: AppConfig, store: Persistence): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.static(config.publicDir));

  app.get('/api/health', healthHandler(config));
  app.post('/api/scrape', scrapeHandler(config, store));
  app.post('/api/detail', detailHandler(config, store));
  app.get('/api/history', historyHandler(store));
  app.get('/api/listings', listingsHandler(store));
  app.post('/api/watch', watchCreateHandler(store));
  app.get('/api/watch', watchListHandler(store));
  app.delete('/api/watch/:id', watchDeleteHandler(store));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  return app;
}
