import fs from 'node:fs';
import puppeteer, { type Browser, type LaunchOptions } from 'puppeteer';

/** 系统常见 Chrome/Chromium 路径，按 macOS → Linux → Windows 顺序探测。 */
export const CHROME_PATH_CANDIDATES: readonly string[] = [
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
  /** 代理 URL（ADR-0003）；null = 直连。 */
  readonly proxy: string | null;
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
  if (opts.proxy) args.push(`--proxy-server=${opts.proxy}`);
  const launchOpts: LaunchOptions = { headless: opts.headless, args };
  // chromePath 未显式配置时回落到系统探测：README 承诺"不填也能自动找系统 Chrome"，
  // 而 health 早已基于同一函数上报检测结果，这里必须用同一份逻辑，否则 health 显示就绪、
  // 抓取却去找 Puppeteer 自带浏览器（版本缺失时直接失败）。
  const executablePath = opts.chromePath ?? detectChromePath();
  if (executablePath) launchOpts.executablePath = executablePath;
  return puppeteer.launch(launchOpts);
}
