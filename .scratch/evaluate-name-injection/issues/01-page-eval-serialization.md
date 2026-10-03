# 01-page-eval-serialization

Type: bugfix
Status: resolved

dev 模式（tsx watch）下详情抓取恒失败并报 `__name is not defined`，生产路径正常。规格见同目录 `spec.md`。

根因：esbuild 的 `keepNames` 把保名调用 `__name(fn, "name")` 注入了 `extractDetailInPage` 的函数体（体内两个箭头函数赋给了变量）。这行代码随 `toString()` 序列化进页面执行，而页面里没有 `__name`。`extractSearchResultsInPage` 体内箭头是内联的 `forEach` 参数、无需保名，所以不受影响——这解释了"只有详情报错"。

## Answer

- `src/scraper/page-eval.ts`：新增 `toPageScript(extractor)`，把浏览器侧提取函数包进自执行 IIFE 并在局部作用域补 `__name` shim；返回字符串（与 `stealth.ts` 的字符串注入方式一致）。
- `src/scraper/detail.ts`：详情提取改走 `page.evaluate(toPageScript(extractDetailInPage))`。
- `src/scraper/search.ts`：搜索结果提取改走同一边界；`isCaptchaPage` 内的匿名箭头提取为模块级 `detectCaptchaInPage` 并同样走该边界。
- `src/scraper/page-eval.test.ts`：锁定序列化边界契约。
- `.scratch/evaluate-name-injection/probe.ts`：探针，复用序列化源码在裸上下文真实调用。

## 验证

- 探针（修复前）：`extractDetailInPage` `contains __name = true` 且裸上下文调用抛 `__name is not defined`。
- 探针（修复后）对比：

```
[probe] extractDetailInPage
  contains __name        = true
  direct serialize       = THREW: __name is not defined
  toPageScript wrapped   = OK
[probe] extractSearchResultsInPage
  contains __name        = false
  direct serialize       = OK
  toPageScript wrapped   = OK
```

- `npm run dev` 受控对照（同一服务、同一 ASIN，只改调用写法）：

```
旧写法：{"saved":0,"detail":null,"attempts":[{"ok":false,"failure":"unknown","message":"__name is not defined"}]}
新写法：{"saved":1,"detail":{...完整变体数据...},"attempts":[{"ok":true,"durationMs":9464}]}
```

- 回归测试含对照组：`new Function` 构造体内引用 `__name` 的函数，包装前抛错、包装后正常。该用例不依赖 vitest 是否注入（实测 vitest 不注入），锁的是序列化边界契约本身。
- `detectCaptchaInPage` 提取后新增 5 项判定用例（此前该逻辑内联在 `evaluate` 里，不可测）。
- `typecheck` + `build` 通过，全量 130/130 通过。

## Comments

本工单由「先清这两条」中的第一条发起。缺陷危害不是"dev 跑不起来"，而是**开发链路与生产链路执行不同源码**：任何依赖函数序列化的后续改动（新增提取字段、新增 Marketplace Parser）都会在 dev 静默失败、在生产通过，诱导误判。因此修的是序列化边界本身，而非给单个函数打补丁。
