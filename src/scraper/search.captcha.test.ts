import { describe, expect, it } from 'vitest';
import {
  classifyHttpStatus,
  detectCaptchaFromSignals,
  type CaptchaSignals,
} from './search.js';

const baseSignals: CaptchaSignals = {
  url: 'https://www.amazon.com/s?k=laptop',
  title: 'Amazon.com : laptop',
  hasValidateCaptchaForm: false,
  hasCaptchaImage: false,
  hasRobotCheckHeading: false,
  hasSupportEmailMarker: false,
};

describe('detectCaptchaFromSignals', () => {
  it('returns false for a normal search result page', () => {
    expect(detectCaptchaFromSignals(baseSignals)).toBe(false);
  });

  it('detects the /errors/validateCaptcha URL', () => {
    expect(
      detectCaptchaFromSignals({
        ...baseSignals,
        url: 'https://www.amazon.com/errors/validateCaptcha',
      })
    ).toBe(true);
  });

  it.each([
    ['captcha in title', { title: 'Enter the characters you see below' }],
    ['robot in title', { title: 'Robot Check' }],
    ['CAPTCHA uppercase in title', { title: 'CAPTCHA Required' }],
  ])('detects %s', (_label, patch) => {
    expect(detectCaptchaFromSignals({ ...baseSignals, ...patch })).toBe(true);
  });

  it('detects the validateCaptcha form element', () => {
    expect(
      detectCaptchaFromSignals({ ...baseSignals, hasValidateCaptchaForm: true })
    ).toBe(true);
  });

  it('detects a captcha image asset', () => {
    expect(detectCaptchaFromSignals({ ...baseSignals, hasCaptchaImage: true })).toBe(true);
  });

  it('detects the "Robot Check" heading', () => {
    expect(
      detectCaptchaFromSignals({ ...baseSignals, hasRobotCheckHeading: true })
    ).toBe(true);
  });

  it('detects the api-services-support@amazon.com marker in body text', () => {
    expect(
      detectCaptchaFromSignals({ ...baseSignals, hasSupportEmailMarker: true })
    ).toBe(true);
  });

  it('any single signal is enough — no threshold required', () => {
    // 每个信号单独命中都应返回 true
    const signals: (keyof CaptchaSignals)[] = [
      'hasValidateCaptchaForm',
      'hasCaptchaImage',
      'hasRobotCheckHeading',
      'hasSupportEmailMarker',
    ];
    for (const key of signals) {
      expect(detectCaptchaFromSignals({ ...baseSignals, [key]: true })).toBe(true);
    }
  });
});

describe('classifyHttpStatus', () => {
  it.each([
    [200, null],
    [204, null],
    [301, null],
    [399, null],
  ])('treats %i as no-failure (null)', (status, expected) => {
    expect(classifyHttpStatus(status)).toBe(expected);
  });

  it.each([
    [429, 'network'],
    [500, 'network'],
    [502, 'network'],
    [503, 'network'],
    [504, 'network'],
  ])('classifies %i as network (transient, retryable)', (status, expected) => {
    expect(classifyHttpStatus(status)).toBe(expected);
  });

  it.each([
    [400, 'unknown'],
    [403, 'unknown'],
    [404, 'unknown'],
    [418, 'unknown'],
  ])('classifies other 4xx (%i) as unknown', (status, expected) => {
    expect(classifyHttpStatus(status)).toBe(expected);
  });
});
