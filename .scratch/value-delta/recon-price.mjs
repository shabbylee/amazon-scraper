// 精确提取变体起始价，验证"配置价差 = Value Delta"能否从父页面直接算出。
import { launchBrowser } from '../../dist/scraper/browser.js';

const ASIN = process.argv[2] ?? 'B0HFVPJ71V';

const browser = await launchBrowser({ chromePath: null, headless: true, proxy: null });
try {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  );
  await page.goto(`https://www.amazon.com/dp/${ASIN}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 5000));

  const data = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[id^="inline-twister-row-"]')];
    const out = rows.map((row) => {
      const dimId = row.id.replace('inline-twister-row-', '');
      const options = [...row.querySelectorAll('li[data-asin]')].map((li) => {
        const fullText = (li.textContent ?? '').replace(/\s+/g, ' ').trim();
        // 配置 = 开头到 "N个选项/N options" 之前；价格 = 起始价/from 后的数字
        const config = (fullText.match(/^(.*?)\d+\s*(?:个选项|options?)/i)?.[1] ?? fullText)
          .trim()
          .slice(0, 80);
        const price = fullText.match(
          /起始价\s*[：:]\s*(?:CNY|US\$|\$|€|£)?\s*([\d,]+(?:\.\d+)?)/i
        )?.[1] ?? null;
        const priceNum = price ? Number.parseFloat(price.replace(/,/g, '')) : null;
        return {
          asin: li.getAttribute('data-asin'),
          config,
          priceText: price,
          priceNum,
          fullText: fullText.slice(0, 140),
        };
      });
      return { dimId, options };
    });
    return out;
  });

  for (const dim of data) {
    console.log(`\n维度 [${dim.dimId}]`);
    for (const o of dim.options) {
      console.log(`  ${o.asin}  config="${o.config}"  price=${o.priceNum}`);
      console.log(`       raw="${o.fullText}"`);
    }
  }
} finally {
  await browser.close();
}
