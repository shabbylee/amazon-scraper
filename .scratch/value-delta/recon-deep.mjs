// 深度探测：找出详情页里变体区的真实 DOM 结构（新版 Amazon 组件名可能与 #twister 不同）。
import { launchBrowser } from '../../dist/scraper/browser.js';

const ASIN = process.argv[2] ?? 'B0GR6FHGXX';

const browser = await launchBrowser({ chromePath: null, headless: true, proxy: null });
try {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  );
  await page.goto(`https://www.amazon.com/dp/${ASIN}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 5000)); // 多等，twister 常异步渲染

  const probe = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    const idsWithTwister = new Set();
    const idsWithVariation = new Set();
    for (const el of all) {
      if (el.id && /twister/i.test(el.id)) idsWithTwister.add(el.id);
      if (el.id && /variation/i.test(el.id)) idsWithVariation.add(el.id);
    }
    const html = document.documentElement.innerHTML;
    return {
      finalUrl: location.href,
      title: (document.querySelector('#productTitle')?.textContent ?? '').slice(0, 100),
      hasCaptcha: /enter the characters|captcha|robot check/i.test(document.body?.textContent ?? ''),
      idsWithTwister: [...idsWithTwister].slice(0, 30),
      idsWithVariation: [...idsWithVariation].slice(0, 30),
      twisterCountInHtml: (html.match(/twister/gi) ?? []).length,
      variationCountInHtml: (html.match(/variation/gi) ?? []).length,
      hasTwisterPlus: Boolean(document.querySelector('#twister-plus, .twister-plus, [id*="twisterPlus"]')),
      buyboxPresent: Boolean(document.querySelector('#buybox')),
      htmlSnippet: html.slice(0, 800),
    };
  });

  console.log(JSON.stringify(probe, null, 2));
} finally {
  await browser.close();
}
