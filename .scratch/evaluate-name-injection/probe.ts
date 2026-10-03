/**
 * 探针：验证 tsx(esbuild) 把 keepNames 辅助函数注入到跨边界序列化的函数里，
 * 并对比「直接序列化」与「经 toPageScript 包装」两种方式在裸页面上下文的执行结果。
 *
 * 为什么要 document stub：函数体若因缺 DOM 提前抛错，就掩盖了 __name 这一真凶。
 * 为什么必须真正调用：注入点在函数体内部，只解析函数定义不会触发。
 */
import vm from 'node:vm';
import { extractDetailInPage } from '../../src/parser/detail-page.js';
import { extractSearchResultsInPage } from '../../src/parser/search-page.js';
import { toPageScript, type PageExtractor } from '../../src/scraper/page-eval.js';

/** 最小 document stub：所有选择器都返回空，但结构足以让函数体继续执行。 */
function makeDocumentStub(): unknown {
  const emptyList = { length: 0, forEach: () => undefined };
  return {
    title: 'probe',
    querySelector: () => null,
    querySelectorAll: () => emptyList,
  };
}

/** 在无 __name 的上下文里执行一个「完整的可执行表达式」。 */
function evalInBarePage(expression: string): { ok: boolean; error?: string } {
  const ctx = vm.createContext({ document: makeDocumentStub() });
  try {
    vm.runInContext(expression, ctx);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const targets: ReadonlyArray<readonly [string, PageExtractor]> = [
  ['extractDetailInPage', extractDetailInPage],
  ['extractSearchResultsInPage', extractSearchResultsInPage],
];

for (const [name, fn] of targets) {
  const src = fn.toString();
  const direct = evalInBarePage(`(${src})()`);
  const wrapped = evalInBarePage(toPageScript(fn));
  process.stdout.write(
    `[probe] ${name}\n` +
      `  contains __name        = ${src.includes('__name')}\n` +
      `  direct serialize       = ${direct.ok ? 'OK' : `THREW: ${direct.error}`}\n` +
      `  toPageScript wrapped   = ${wrapped.ok ? 'OK' : `THREW: ${wrapped.error}`}\n`
  );
}
