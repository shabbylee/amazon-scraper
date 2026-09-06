import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`
Amazon Scraper running at http://localhost:${config.port}

Chrome      : ${config.chromePath ?? 'bundled (puppeteer)'}
Headless    : ${config.headless}
Marketplace : ${config.defaultMarketplace}
Interval    : ${config.requestIntervalMs}ms between attempts
Port        : ${config.port}
`);
});

function shutdown(signal: string): void {
  console.log(`[shutdown] ${signal} received, closing server...`);
  server.close(() => {
    console.log('[shutdown] done');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
