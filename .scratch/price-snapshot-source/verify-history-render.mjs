/**
 * 验证价格曲线的价源分组渲染（ADR-0010）。
 *
 * 在真实浏览器里加载前端页面，用一组「搜索价 ↔ Buy Box 价 交替」的快照调用
 * renderHistorySvg，断言：
 *   1. 页面脚本无语法错误、函数可调用
 *   2. 两种价源各画一条独立折线（不跨源连线）
 *   3. 图例列出两个口径
 *
 * 用法：先 `npm run build && npm start`，再 `node .scratch/price-snapshot-source/verify-history-render.mjs`
 */
import puppeteer from 'puppeteer';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL ?? 'http://localhost:3456';

// 与 src/scraper/browser.ts 的 launch 参数保持一致（少 --no-sandbox 等会启动不稳）
const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROME,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--lang=zh-CN',
  ],
});
const existing = await browser.pages();
const page = existing[0] ?? (await browser.newPage());

const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(err.message));

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(() => {
  const points = [
    { capturedAt: '2026-10-01T00:00:00.000Z', priceText: '$100.00', priceNum: 100, source: 'listing' },
    { capturedAt: '2026-10-01T01:00:00.000Z', priceText: '$150.00', priceNum: 150, source: 'buybox' },
    { capturedAt: '2026-10-01T02:00:00.000Z', priceText: '$100.00', priceNum: 100, source: 'listing' },
    { capturedAt: '2026-10-01T03:00:00.000Z', priceText: '$140.00', priceNum: 140, source: 'buybox' },
    { capturedAt: '2026-10-01T04:00:00.000Z', priceText: '$100.00', priceNum: 100, source: null },
  ];
  const html = renderHistorySvg(points);
  return {
    html,
    polylines: (html.match(/<polyline/g) || []).length,
    circles: (html.match(/<circle/g) || []).length,
    colors: [...new Set((html.match(/stroke="(#[0-9A-Fa-f]{6})"/g) || []))],
  };
});

await browser.close();

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  process.stdout.write(`  ${ok ? 'OK  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}\n`);
};

process.stdout.write(`[verify] page errors = ${consoleErrors.length}${consoleErrors.length ? ` -> ${consoleErrors.join('; ')}` : ''}\n`);
process.stdout.write(`[verify] polylines = ${result.polylines}, circles = ${result.circles}\n`);
process.stdout.write(`[verify] 折线颜色 = ${result.colors.join(', ')}\n`);

// 3 个价源分组，每组 >=2 个点才连线：listing 3 点、buybox 2 点连线；unknown 只有 1 点不连线
check('polyline 数量（listing + buybox 各一条）', result.polylines, 2);
check('散点数量（全部 5 个快照）', result.circles, 5);
check('页面无脚本错误', consoleErrors.length, 0);

for (const [label, needle] of [
  ['图例含 Buy Box 价', 'Buy Box 价（2）'],
  ['图例含搜索价', '搜索价（2）'],
  ['图例含价源未知', '价源未知（1）'],
]) {
  const ok = result.html.includes(needle);
  if (!ok) failures += 1;
  process.stdout.write(`  ${ok ? 'OK  ' : 'FAIL'} ${label}\n`);
}

process.stdout.write(failures === 0 ? '[verify] PASS\n' : `[verify] FAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
