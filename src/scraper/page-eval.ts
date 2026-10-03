/**
 * 页面侧求值的序列化边界（Scraper 层）。
 *
 * Parser 的浏览器侧函数（`extractDetailInPage` 等）跨运行时边界：Puppeteer 取
 * `Function.prototype.toString()` 把函数源码送进页面执行。序列化只搬运源码，
 * 不搬运模块作用域——所以这类函数体内不能引用任何模块级符号。
 *
 * 但构建工具会往函数体里注入辅助符号：dev 模式走 tsx（esbuild），`keepNames`
 * 会给赋值给变量的函数表达式加保名调用 `__name(fn, "name")`。这行代码随源码
 * 进入页面，而页面里没有 `__name`，于是抛 `ReferenceError: __name is not defined`。
 * 生产构建走 tsc，不做保名注入，因此缺陷只在 dev 暴露——同一段逻辑在两种构建下
 * 执行不同源码，这本身就是隐患。
 *
 * 这里在被序列化函数的 IIFE 局部作用域内补一个与 esbuild 语义等价的 shim：
 * 页面照常执行，不污染页面全局、不改动页面可观测指纹。生产构建下 shim 是死代码。
 */

/** 浏览器侧提取函数的形态：无参数，返回可结构化克隆的值。 */
export type PageExtractor = () => unknown;

/**
 * 把浏览器侧提取函数转成可直接交给 `page.evaluate` 的源码字符串。
 *
 * 返回字符串而非函数，与 `stealth.ts` 的 `evaluateOnNewDocument(字符串)` 一致：
 * 跨运行时边界只传源码。shim 用 `var` 声明在 IIFE 内，限定在被序列化函数的
 * 执行范围，不泄漏到页面全局。
 */
export function toPageScript(extractor: PageExtractor): string {
  const shim =
    'var __name=function(target,value){' +
    'try{Object.defineProperty(target,"name",{value:value,configurable:true});}catch(_e){}' +
    'return target;};';
  return `(function(){${shim}return (${extractor.toString()})();})()`;
}
