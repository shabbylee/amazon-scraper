// 批量探测：用 twisterPlus 正确选择器，找出硬件配置维度清晰的多变体 Windows 笔记本。
import { launchBrowser } from '../../dist/scraper/browser.js';

const DEFAULT_ASINS = [
  'B0D1YQJKY2', 'B0DZZWMB2L', 'B0HF3J55CY', 'B0HF7WTGSR', 'B0HJCRV1J6',
  'B0F195W823', 'B0HFVPJ71V', 'B0HGY43C6R', 'B0HJTGGMN6', 'B09R6FNNS1',
  'B0GR6FHGXX', 'B0HJTT6HP8', 'B0HFJ9BNPL', 'B0HGFRTYSY', 'B0HGFVP1VN',
  'B0F53SQRH4',
];
const ASINS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_ASINS;

const browser = await launchBrowser({ chromePath: null, headless: true, proxy: null });
try {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  );

  for (let i = 0; i < ASINS.length; i++) {
    const asin = ASINS[i];
    try {
      await page.goto(`https://www.amazon.com/dp/${asin}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await new Promise((r) => setTimeout(r, 2500));
      const p = await page.evaluate(() => {
        const t = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const rows = [...document.querySelectorAll('[id^="inline-twister-row-"]')];
        const dims = rows.map((row) => {
          const dimId = row.id.replace('inline-twister-row-', '');
          const label = t(document.querySelector(`#inline-twister-dim-title-${dimId}`));
          const opts = [...row.querySelectorAll('li[data-asin]')].map((li) => ({
            t: t(li.querySelector('.swatch-title-text-display, .a-button-text') ?? li).slice(0, 40),
            asin: li.getAttribute('data-asin'),
          }));
          return { dimId, label, n: opts.length, sample: opts.slice(0, 3) };
        });
        return {
          title: t(document.querySelector('#productTitle')).slice(0, 70),
          twisterPlus: Boolean(document.querySelector('#twister_feature_div')),
          dims,
        };
      });
      console.log(
        `[${asin}] tw+=${p.twisterPlus}` +
          (p.dims.length
            ? ' | ' + p.dims.map((d) => `${d.dimId}(${d.n}): "${d.label}"`).join(' || ')
            : ' | (无变体)')
      );
      if (p.dims.length) {
        for (const d of p.dims) {
          for (const s of d.sample) console.log(`      ${d.dimId} -> "${s.t}" [${s.asin}]`);
        }
      }
    } catch (e) {
      console.log(`[${asin}] 失败: ${e.message?.slice(0, 60)}`);
    }
    if (i < ASINS.length - 1) await new Promise((r) => setTimeout(r, 2000));
  }
} finally {
  await browser.close();
}
