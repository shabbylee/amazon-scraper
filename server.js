const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m || m[1].startsWith('#')) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv();

function detectChromePath() {
  const custom = process.env.CHROME_PATH;
  if (custom) return custom;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const CHROME_PATH = detectChromePath();
const HEADLESS = process.env.HEADLESS !== 'false';

const SCRAPE_JS = () => {
  const items = [];
  function parsePrice(text) {
    if (!text) return null;
    const s = text.replace(/[,\s]/g, '');
    const m = s.match(/[\d.]+/);
    if (!m) return null;
    const n = parseFloat(m[0]);
    return isNaN(n) ? null : n;
  }
  const cards = document.querySelectorAll('[data-component-type="s-search-result"]');
  cards.forEach(card => {
    const asin = card.getAttribute('data-asin');
    if (!asin) return;
    const titleEl = card.querySelector('h2 a span, h2 span');
    const title = titleEl ? titleEl.textContent.trim() : '';
    let priceRaw = '';
    const offscreen = card.querySelector('.a-price .a-offscreen');
    if (offscreen) {
      priceRaw = offscreen.textContent.trim();
    } else {
      const whole = card.querySelector('.a-price-whole');
      const frac = card.querySelector('.a-price-fraction');
      if (whole) {
        priceRaw = whole.textContent.trim();
        if (frac) priceRaw += frac.textContent.trim();
      }
    }
    const hasPrice = priceRaw && !priceRaw.includes('—');
    const imgEl = card.querySelector('.s-image');
    const image = imgEl ? imgEl.getAttribute('src') : '';
    const ratingEl = card.querySelector('.a-icon-alt');
    let rating = null;
    if (ratingEl) {
      const m = ratingEl.textContent.match(/([0-9.]+)/);
      if (m) rating = parseFloat(m[1]);
    }
    items.push({
      asin,
      title,
      href: 'https://www.amazon.com/dp/' + asin,
      priceText: hasPrice ? priceRaw.replace(/\s+/g, ' ') : '没有标记价格或即将推出',
      hasPrice,
      priceNum: hasPrice ? parsePrice(priceRaw) : null,
      image,
      rating,
    });
  });
  return items;
};

async function scrapePage(browser, keyword, pageNum) {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}&page=${pageNum}&ref=nb_sb_noss`;
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 20000 }).catch(() => { });
  const results = await page.evaluate(SCRAPE_JS);
  await page.close();
  return results;
}

function launchBrowser() {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--lang=zh-CN',
  ];
  if (CHROME_PATH) {
    return puppeteer.launch({ executablePath: CHROME_PATH, headless: HEADLESS, args });
  }
  return puppeteer.launch({ headless: HEADLESS, args });
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    chromePath: CHROME_PATH || '(using bundled Chromium)',
    headless: HEADLESS,
    chromeDetected: !!CHROME_PATH,
  });
});

app.post('/api/scrape', async (req, res) => {
  const { keyword, pages } = req.body || {};
  const k = (keyword || 'laptop').trim();
  const n = Math.min(Math.max(parseInt(pages, 10) || 3, 1), 10);
  if (!k) return res.status(400).json({ error: 'keyword required' });

  let browser = null;
  try {
    browser = await launchBrowser();
    const all = [];
    for (let i = 1; i <= n; i++) {
      const pageItems = await scrapePage(browser, k, i);
      all.push(...pageItems);
    }

    const withPrice = all.filter(x => x.hasPrice).sort((a, b) => (a.priceNum || 0) - (b.priceNum || 0));
    const withoutPrice = all.filter(x => !x.hasPrice);

    const minPrice = withPrice.length ? withPrice[0].priceText : null;
    const maxPrice = withPrice.length ? withPrice[withPrice.length - 1].priceText : null;
    const avg = withPrice.length
      ? Math.round(withPrice.reduce((s, x) => s + (x.priceNum || 0), 0) / withPrice.length)
      : null;

    res.json({
      keyword: k,
      pagesScraped: n,
      total: all.length,
      withPrice: withPrice.length,
      withoutPrice: withoutPrice.length,
      minPrice,
      maxPrice,
      avgPrice: avg ? `CNY ${avg.toLocaleString()}` : null,
      items: [...withPrice, ...withoutPrice],
    });
  } catch (err) {
    console.error('[scrape error]', err && err.message);
    res.status(500).json({ error: (err && err.message) || 'scrape failed' });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = parseInt(process.env.PORT || '3456', 10);
const server = app.listen(PORT, () => {
  console.log(`
  Amazon Scraper running at http://localhost:${PORT}

  Chrome : ${CHROME_PATH || 'bundled (puppeteer)'};
  Mode   : ${HEADLESS ? 'headless' : 'headed (visible)'};
  Port   : ${PORT};
  `);
});

function shutdown() {
  console.log('[shutdown] closing server...');
  server.close(() => {
    console.log('[shutdown] done');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
