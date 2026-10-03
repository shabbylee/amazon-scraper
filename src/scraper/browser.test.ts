import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { CHROME_PATH_CANDIDATES, detectChromePath, launchBrowser } from './browser.js';

/**
 * Browser 层：detectChromePath 的优先级，以及 launchBrowser 必须复用同一份探测结果。
 * 回归背景：launchBrowser 曾只看 config.chromePath（仅来自 CHROME_PATH 环境变量），
 * 导致 health 上报"检测到系统 Chrome"而抓取仍去找 Puppeteer 自带浏览器。
 */

vi.mock('puppeteer', () => ({
  default: { launch: vi.fn(async () => ({ close: async () => {} })) },
}));

const mockLaunch = vi.mocked(puppeteer.launch);
const firstCandidate = CHROME_PATH_CANDIDATES[0]!;

beforeEach(() => {
  mockLaunch.mockClear();
  delete process.env.CHROME_PATH;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('detectChromePath', () => {
  it('prefers CHROME_PATH from env over probing', () => {
    const spy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    expect(detectChromePath({ CHROME_PATH: '/custom/chrome' })).toBe('/custom/chrome');
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns the first existing candidate path', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === firstCandidate);
    expect(detectChromePath({})).toBe(firstCandidate);
  });

  it('returns null when no candidate exists (let Puppeteer use its bundled browser)', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(detectChromePath({})).toBeNull();
  });
});

describe('launchBrowser', () => {
  it('falls back to the detected system Chrome when chromePath is null', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === firstCandidate);

    await launchBrowser({ chromePath: null, headless: true, proxy: null });

    expect(mockLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: firstCandidate })
    );
  });

  it('keeps an explicitly configured chromePath', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    await launchBrowser({ chromePath: '/explicit/chrome', headless: true, proxy: null });

    expect(mockLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: '/explicit/chrome' })
    );
  });

  it('omits executablePath when nothing is configured or detected', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    await launchBrowser({ chromePath: null, headless: true, proxy: null });

    const argument = mockLaunch.mock.calls.at(-1)?.[0];
    expect(argument).not.toHaveProperty('executablePath');
  });

  it('still wires the proxy into launch args', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    await launchBrowser({ chromePath: null, headless: true, proxy: 'http://p.example:8080' });

    const argument = mockLaunch.mock.calls.at(-1)?.[0];
    expect(argument?.args).toContain('--proxy-server=http://p.example:8080');
  });
});
