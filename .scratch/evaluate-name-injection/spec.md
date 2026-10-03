# 页面侧提取函数序列化（page-eval serialization）规格

日期：2026-10-03。上游：Value Delta 多 Listing 聚合切片收尾时记录的开发链缺陷——`npm run dev`（tsx watch）下详情抓取恒失败，生产路径正常。

## 问题

`npm run dev` 启动后调用 `POST /api/detail`，详情抓取失败并返回：

```
__name is not defined
```

同一份源码，`npm run build && npm start` 正常。也就是说 **dev 与生产执行的是不同源码**，dev 是坏的。

## 根因

Parser 的浏览器侧函数（`extractDetailInPage` 等）要跨运行时边界：Puppeteer 取 `Function.prototype.toString()` 把函数序列化成源码，送进页面执行。序列化只搬运源码，**不搬运模块作用域**。

dev 模式走 tsx（esbuild），esbuild 的 `keepNames` 会给**赋值给变量的函数表达式**注入保名辅助调用：

```js
const text = /* @__PURE__ */ __name((el) => (el?.textContent ?? '').trim(), "text");
```

这行 `__name(...)` 随源码一起进入页面，而页面里没有 `__name` 的定义，于是 `ReferenceError: __name is not defined`。

这解释了为什么**只有详情路径炸**：`extractDetailInPage` 体内把两个箭头函数赋值给了变量（`text` / `src`），需要保名；而 `extractSearchResultsInPage` 体内的箭头是**内联作为 `forEach` 参数**，无需保名，所以没有注入。生产构建走 tsc，不做保名注入，因此从不暴露。

## 证据

探针 `.scratch/evaluate-name-injection/probe.ts` 复用同一段序列化源码，在「裸 VM 上下文 + 最小 document stub」里**真正调用**它（只解析不调用无法暴露：注入点在函数体内，不执行就不报错）：

```
[probe] extractDetailInPage
  contains __name = true
  invoke in bare page context = THREW: __name is not defined
[probe] extractSearchResultsInPage
  contains __name = false
  invoke in bare page context = OK
```

同时确认 vitest 环境**不注入** `__name`（`vitest-probe` 实测两项均为 `false`），因此回归测试不能依赖构建链是否注入，必须直接锁定「序列化边界的契约」。

## 方案

在 Scraper 层新增序列化边界 `src/scraper/page-eval.ts`：`toPageScript(extractor)` 把提取函数包进自执行 IIFE，并在**局部作用域**声明一个与 esbuild 语义等价的 `__name` shim。

```js
(function(){var __name=function(target,value){...return target;};return (<原函数源码>)();})()
```

选择这个方案而非在页面全局注入 `__name`：shim 严格限定在被序列化函数的执行范围内，不污染页面环境、不改变页面可观测指纹，也不依赖脚本注入时序。返回字符串而非函数，与 `stealth.ts` 已有的 `evaluateOnNewDocument(字符串)` 注入方式一致——跨运行时边界只传源码。

生产构建下 shim 是死代码（tsc 不注入 `__name`），两种构建产物的行为因此一致。

## 验收

1. `extractDetailInPage` / `extractSearchResultsInPage` 经 `toPageScript` 包装后，在无 `__name` 的上下文可执行。
2. 回归测试能在不使用真实浏览器、不依赖 bundler 行为的前提下捕获本缺陷（用一个体内引用 `__name` 的构造函数作对照组）。
3. `npm run dev` 下真实调用 `POST /api/detail` 不再报 `__name is not defined`。
4. 三个跨边界调用点（详情提取 / 搜索提取 / CAPTCHA 探测）统一走同一边界。

## 非目标

- 不改 `extractDetailInPage` 的提取逻辑与选择器。
- 不改 CAPTCHA 判定语义（`captcha` 失败分类与「识别即停止」硬约束不变）。
- 不引入 puppeteer-extra 或其他依赖。
