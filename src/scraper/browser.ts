import fs from 'node:fs';
import vanillaPuppeteer, { type Browser, type LaunchOptions } from 'puppeteer';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { ParsedProxy } from '../proxy/index.js';

/**
 * Phase 2：接入 puppeteer-extra + stealth 插件。见 docs/adr/0003-phase2-scrape-stability.md。
 * stealth 会覆盖 navigator.webdriver / chrome.runtime / permissions.query / plugins / languages /
 * iframe contentWindow / WebGL vendor 等十几个 Chromium 反检测点，比手写脚本更完整。
 *
 * 用 addExtra(vanillaPuppeteer) 显式包装（不走 puppeteer-extra 的默认导出），
 * 避免 NodeNext + CJS interop 下 default 导入的类型歧义。
 * `.use()` 是全局副作用，只需在模块加载时调用一次。
 */
const puppeteer = addExtra(vanillaPuppeteer);
puppeteer.use(StealthPlugin());

/** 系统常见 Chrome/Chromium 路径，按 macOS → Linux → Windows 顺序探测。 */
const CHROME_PATH_CANDIDATES: readonly string[] = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

/**
 * 检测 Chrome 可执行文件。优先 CHROME_PATH 环境变量，否则遍历常见路径。
 * 返回 null 表示使用 Puppeteer 自带的 Chromium。
 */
export function detectChromePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const custom = env.CHROME_PATH?.trim();
  if (custom) return custom;
  for (const p of CHROME_PATH_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

export interface LaunchBrowserOptions {
  readonly chromePath: string | null;
  readonly headless: boolean;
  /** Phase 2：可选代理；仅 serverFlag 进启动参数，credentials 由 scrapeSearchPage 走 page.authenticate。 */
  readonly proxy?: ParsedProxy | null;
}

export async function launchBrowser(opts: LaunchBrowserOptions): Promise<Browser> {
  const args: string[] = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--lang=zh-CN',
  ];
  if (opts.proxy) args.push(`--proxy-server=${opts.proxy.serverFlag}`);
  const launchOpts: LaunchOptions = { headless: opts.headless, args };
  if (opts.chromePath) launchOpts.executablePath = opts.chromePath;
  // puppeteer-extra 的 launch 与 puppeteer.launch 签名兼容；返回的 Browser 类型也一致。
  return (await puppeteer.launch(launchOpts)) as Browser;
}
