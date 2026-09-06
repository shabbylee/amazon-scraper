# 后端从 CommonJS JS 迁移到 TypeScript（strict）

v1.0 的后端是 207 行 CommonJS JS，所有类型（Listing、Scrape Job、Failure Class）都只活在 README 与开发者脑子里。Phase 1 要把 `server.js` 拆成 `src/{config,browser,parser,scraper,routes}` 多个模块，Phase 3 还要扩展 Listing schema 到 Buy Box / 卖家 / 运费 / 变体。跨模块传递的领域对象越多，"某一处忘了改"的风险越大。我们决定**在 Phase 1 拆模块的同时迁到 TypeScript（strict）**，让编译器承担一致性检查。

## 决定

- **语言**：TypeScript 5.x，`strict: true`，`noUncheckedIndexedAccess: true`
- **模块系统**：编译产物 ESM（`"type": "module"`），源码用 ESM `import`
- **运行时**：Node ≥ 20（原生 ESM + 稳定的 fetch）；开发期用 `tsx watch`，生产用 `node dist/`
- **构建**：`tsc -p tsconfig.build.json` → `dist/`；不引入 bundler（esbuild/swc）
- **测试**：vitest + supertest；测试文件与源码同级 `*.test.ts`
- **前端不动**：`public/index.html` 保持零依赖单文件；本 ADR 只覆盖后端

## 为什么现在迁

- **Phase 1 本来就要动每一行**：拆模块 = 每个文件都要重写导入导出，"顺手迁 TS"的边际成本远低于"以后再迁"。
- **Phase 3 会加很多可选字段**：Buy Box / 卖家 / 运费 / 变体大多是 optional，JS 里靠约定，TS 里靠类型；后者才不会在 Phase 4 落库时炸掉。
- **Failure Class 是判别联合**：`{ kind: 'network' | 'timeout' | 'captcha' | 'parser-miss' | 'unknown', ... }` 在 TS 里能被 switch 穷尽检查，在 JS 里只能靠注释。

## 被拒绝的替代方案

- **留在 JS + JSDoc**：改动最小，但 supertest / puppeteer / express 5 的类型提示要靠 `@types/*` 拼，且 JSDoc 的严格度取决于编辑器，不像 `tsc` 是硬门槛。
- **先拆 JS 再迁 TS**：同一批文件动两次，两次 diff 都不可读；且第一次拆完的模块边界很可能在迁 TS 时又要调整（因为类型暴露了隐藏耦合）。
- **用 bundler（esbuild / tsup）**：更快，但引入构建配置复杂度，且这个项目没有 bundle 需求（服务端 Node 直接跑）。留到真需要单文件产物时再上。

## 后果

- `npm start` 语义变化：从"直接跑 server.js"变成"跑 dist/index.js"，必须先 `npm run build`；`npm run dev` 用 `tsx watch` 免构建。README 与 AGENTS.md 命令表要同步更新。
- `puppeteer` 的 `evaluate` 里传的函数（当前的 `SCRAPE_JS`）在浏览器上下文里执行，不能用外部类型；parser 需要拆成"注入浏览器执行的字符串"与"Node 侧的类型化包装"两部分。
- Node 版本下限从 18 提到 20；`package.json` engines 与 Dockerfile base image 都要跟上。
- CommonJS 依赖（如果有）在 ESM 下需要 `default` 导入或 `createRequire`；`express` / `puppeteer` / `cors` 目前都提供 ESM 兼容入口，无需特殊处理。
