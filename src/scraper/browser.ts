import fs from 'node:fs';
import puppeteer, { type Browser, type LaunchOptions } from 'puppeteer';

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
  const launchOpts: LaunchOptions = { headless: opts.headless, args };
  if (opts.chromePath) launchOpts.executablePath = opts.chromePath;
  return puppeteer.launch(launchOpts);
}
