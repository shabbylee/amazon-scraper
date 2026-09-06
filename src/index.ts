import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { closeDatabase, openDatabase } from './db/index.js';
import { createScheduler } from './scheduler/index.js';

const config = loadConfig();

// Phase 4：打开数据库（幂等，自动建表）
openDatabase(config.dbPath);

// Phase 4：创建调度器并注入 app
const scheduler = config.schedulerEnabled ? createScheduler(config) : null;
const app = createApp(config, { scheduler: scheduler ?? undefined });

const server = app.listen(config.port, () => {
  if (scheduler) scheduler.start();
  console.log(`
Amazon Scraper running at http://localhost:${config.port}

Chrome      : ${config.chromePath ?? 'bundled (puppeteer)'}
Headless    : ${config.headless}
Marketplace : ${config.defaultMarketplace}
Interval    : ${config.requestIntervalMs}ms (search) / ${config.detailIntervalMs}ms (detail)
Database    : ${config.dbPath}
Scheduler   : ${scheduler ? `active (${scheduler.scheduledCount} watches)` : 'disabled'}
Port        : ${config.port}
`);
});

function shutdown(signal: string): void {
  console.log(`[shutdown] ${signal} received, closing server...`);
  if (scheduler) scheduler.stop();
  server.close(() => {
    closeDatabase();
    console.log('[shutdown] done');
    process.exit(0);
  });
  setTimeout(() => {
    closeDatabase();
    process.exit(0);
  }, 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
