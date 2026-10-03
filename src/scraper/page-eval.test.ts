import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { extractDetailInPage } from '../parser/detail-page.js';
import { extractSearchResultsInPage } from '../parser/search-page.js';
import { toPageScript, type PageExtractor } from './page-eval.js';

/** 最小 document stub：选择器一律落空，但足以让提取函数跑完整段函数体。 */
function documentStub(): unknown {
  const emptyList = { length: 0, forEach: () => undefined };
  return {
    title: '',
    querySelector: () => null,
    querySelectorAll: () => emptyList,
  };
}

/** 在没有 `__name` 的上下文里执行源码，等价于真实页面。 */
function runInBarePage(src: string): { value?: unknown; error?: string } {
  const ctx = vm.createContext({ document: documentStub() });
  try {
    return { value: vm.runInContext(src, ctx) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * 等价于 esbuild keepNames 注入产物的函数：体内引用 `__name`。
 * 用 `new Function` 构造，绕过测试环境的转换链，保证 `__name` 原样保留，
 * 因此本用例不依赖 vitest 是否注入 —— 它锁的是序列化边界的契约本身。
 */
const nameInjectedExtractor = new Function(`
  const helper = __name(function () { return 'ok'; }, 'helper');
  return helper();
`) as PageExtractor;

const realExtractors: ReadonlyArray<readonly [string, PageExtractor]> = [
  ['extractDetailInPage', extractDetailInPage],
  ['extractSearchResultsInPage', extractSearchResultsInPage],
];

describe('toPageScript', () => {
  it('把提取函数包成自执行 IIFE，并在局部作用域带上 __name shim', () => {
    const script = toPageScript(extractSearchResultsInPage);
    expect(script.startsWith('(function(){')).toBe(true);
    expect(script).toContain('var __name=function(');
    expect(script.endsWith('})()')).toBe(true);
  });

  it('体内引用 __name 的函数在裸页面上下文会抛错（确认回路可红）', () => {
    const result = runInBarePage(`(${nameInjectedExtractor.toString()})()`);
    expect(result.error ?? '').toMatch(/__name is not defined/);
  });

  it('同一函数经 toPageScript 包装后可正常执行（确认修复生效）', () => {
    const result = runInBarePage(toPageScript(nameInjectedExtractor));
    expect(result.error).toBeUndefined();
    expect(result.value).toBe('ok');
  });

  for (const [name, extractor] of realExtractors) {
    it(`真实的 ${name} 经包装后在裸页面上下文可执行`, () => {
      const result = runInBarePage(toPageScript(extractor));
      expect(result.error).toBeUndefined();
      expect(result.value).toBeDefined();
    });
  }
});
