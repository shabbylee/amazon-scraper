import { describe, expect, it } from 'vitest';
import { stealthInitScript } from './stealth.js';

describe('stealthInitScript', () => {
  it('produces a syntactically valid script', () => {
    const script = stealthInitScript();
    expect(() => new Function(script)).not.toThrow();
  });

  it('hides the most obvious automation fingerprints', () => {
    const script = stealthInitScript();
    expect(script).toContain("'webdriver'");
    expect(script).toContain('window.chrome');
    expect(script).toContain("'languages'");
    expect(script).toContain("'plugins'");
  });

  it('never touches authentication or CAPTCHA bypass logic', () => {
    const script = stealthInitScript();
    expect(script).not.toMatch(/captcha|password|token|login/i);
  });
});
