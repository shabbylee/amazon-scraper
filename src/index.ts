import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createStore } from './db/store.js';
import { startWatchScheduler } from './scheduler.js';

const config = loadConfig();
const store = createStore(config);
const app = createApp(config, store);
const stopScheduler = startWatchScheduler(config, store);

const server = app.listen(config.port, () => {
  console.log(`
Amazon Scraper running at http://localhost:${config.port}

Chrome      : ${config.chromePath ?? 'bundled (puppeteer)'}
Headless    : ${config.headless}
Marketplace : ${config.defaultMarketplace}
Interval    : ${config.requestIntervalMs}ms between attempts
DB          : ${config.dbPath === ':memory:' ? 'in-memory' : config.dbPath}
Watch       : scheduler active (60s tick)
Port        : ${config.port}
`);
});

function shutdown(signal: string): void {
  console.log(`[shutdown] ${signal} received, closing server...`);
  stopScheduler();
  server.close(() => {
    try {
      store.close();
    } catch {
      // ignore
    }
    console.log('[shutdown] done');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
