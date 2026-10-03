// 深挖 twisterPlus 变体结构：dump configuration 维度的原始 DOM，确认选项文本/ASIN/价格的提取方式。
import { launchBrowser } from '../../dist/scraper/browser.js';

const ASIN = process.argv[2] ?? 'B0GR6FHGXX';

const browser = await launchBrowser({ chromePath: null, headless: true, proxy: null });
try {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  );
  await page.goto(`https://www.amazon.com/dp/${ASIN}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 5000));

  const data = await page.evaluate(() => {
    const t = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const rows = [...document.querySelectorAll('[id^="inline-twister-row-"]')];
    const dims = rows.map((row) => {
      const dimId = row.id.replace('inline-twister-row-', '');
      const title = t(document.querySelector(`#inline-twister-dim-title-${dimId}`));
      // 选项入口：twisterPlus 常用 a[data-dp-url] 或带 data-csa-c-item-id 的元素
      const anchors = [...row.querySelectorAll('a[data-dp-url], a[href*="/dp/"]')];
      const options = anchors.map((a) => ({
        text: t(a).slice(0, 70),
        dpUrl: a.getAttribute('data-dp-url') ?? a.getAttribute('href'),
        asin: (a.getAttribute('data-dp-url') ?? a.getAttribute('href') ?? '').match(/dp\/([A-Z0-9]{10})/)?.[1] ?? null,
        title: a.getAttribute('title') ?? null,
        hasPrice: /[\d,]+\.\d{2}/.test(t(a)),
      }));
      return { dimId, title, anchorCount: anchors.length, options };
    });
    const configRow = document.querySelector('#inline-twister-row-configuration');
    return {
      finalUrl: location.href,
      dimensions: dims,
      configRowHTML: (configRow?.outerHTML ?? '').slice(0, 4000),
    };
  });

  console.log(JSON.stringify(data, null, 2));
} finally {
  await browser.close();
}
