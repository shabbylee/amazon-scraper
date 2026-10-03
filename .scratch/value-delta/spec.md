# Value Delta 切片（单 Listing）规格

日期：2026-10-02。上游侦察：`recon-findings.md`（同目录）。架构决策：`docs/adr/0009-modeling-layer-python.md`。

## 目标

用真实多变体笔记本详情页，跑通"采集 → 结构化变体 → 落库 → Python 拆解配置向量 → 价差计算"的端到端代码链，产出一张**单 Listing 的配置边际价值表**。本规格只覆盖单 Listing；多 Listing 聚合与置信区间是后续切片。

## 范围

**做**：`ProductDetail.variants` 从文本数组升级为结构化 `VariantDimension[]`；detail parser 新增 twisterPlus 提取；Node 侧解析价格与清洗脏数据；Python 建模层读 `listings.variants` JSON、拆配置向量、算单 Listing 价差；前端 detail 面板适配新结构。

**不做**：多 Listing 聚合、置信区间/统计检验、跨 Seller 同款匹配、BSR→销量、动态定价、六维决策。配置向量拆解只覆盖笔记本（内存/硬盘），不追求全品类通用词典。

## 设计决策

**D1：类型升级，不留双字段**。`variants: readonly string[]` 改为 `readonly VariantDimension[]`。旧 `string[]` 语义太弱（选择器失效后全空），升级是领域建模修正而非兼容补丁；前端与测试同步改，不接受"新增 parallel 字段"的过渡态。

**D2：分层遵循既有原则**。浏览器侧 `extractDetailInPage` 只提取原始 DOM 结构（维度名 + 标题 + 每选项 `data-asin` + 文本），Node 侧 `toDetail` 做类型守卫、价格提取、脏数据清洗。配置向量拆解（`"64GB DDR5 RAM,2TB PCIe SSD"` → `{memory_gb, storage_tb}`）放 Python 建模层，不在 TS 采集层做语义拆解。

**D3：价格从选项文本提取，不逐子 ASIN 抓**。起始价在选项文本内（中文 `起始价：CNY X` / 英文 `from $X`），正则双分支提取；子 ASIN 仅作标识，不发起子页面请求。这守住 AGENTS.md 的限速硬约束。

**D4：DB 列不变，只升级 JSON 内容契约**。`listings.variants` 仍为 `TEXT` 存 JSON，内容从 `string[]` 变为 `VariantDimension[]`。物理 schema 未变，不立 ADR；契约升级在此规格固化。

## JSON 契约（TS ↔ Python）

`listings.variants` 列存以下结构（TypeScript `JSON.stringify` 产物）：

```json
[
  {
    "name": "set_name",
    "title": "大小: 32GB DDR5 RAM | 1TB PCIe SSD",
    "options": [
      {
        "asin": "B0HFVPJ71V",
        "label": "32GB DDR5 RAM,1TB PCIe SSD",
        "priceText": "CNY 7,372.27",
        "priceNum": 7372.27,
        "currency": "CNY",
        "unavailable": false
      }
    ]
  }
]
```

- `name`：twisterPlus 维度 id（`inline-twister-row-` 后缀，如 `set_name` / `size_name`）。
- `title`：维度标题原文（如 `大小: 32GB RAM | 512GB SSD`），仅展示与诊断，不参与建模。
- `label`：清洗后的配置文本，去掉了价格段、`N个选项`、库存状态、CSS 注释。
- `priceText`：从 `label` 原始文本提取的起始价原始串（含币种符号）。
- `priceNum`：`priceText` 解析的数值；提取失败为 `null`。
- `currency`：从 `priceText` 提取的币种（`CNY`/`USD` 等）；失败为 `null`。
- `unavailable`：选项文本命中"目前无货 / currently unavailable"等无货标记。

Python 侧必须容忍旧 `string[]` 记录（历史库兼容），读到数组元素非对象时跳过该维度。

## 验收标准

1. 抓取真实 ASIN `B0HFVPJ71V` 后，`POST /api/detail` 返回的 `detail.variants` 是 `VariantDimension[]`，含 `set_name` 维度与 3 个选项，每选项有 `asin`、`label`、`priceNum`。
2. `listings.variants` 落库内容符合上述 JSON 契约。
3. Python 读库后，对 3 变体算出两组单维度价差：内存 32→64GB ≈ `+7365.85 CNY`、硬盘 1→2TB ≈ `+1340.43 CNY`（与侦察基线一致，允许币种随 IP 漂移）。
4. TS 与 Python 全部测试通过；`npm run typecheck` 通过；前端 detail 面板不崩，变体按维度渲染。

## 验收结果（2026-10-02）

1. 通过：真实抓取返回 `set_name` 维度与 3 个选项，`asin`/`label`/`priceNum` 齐全。
2. 通过：落库 JSON 符合契约（`persistence.test.ts` 断言）。
3. 通过：Python 输出两组价差，与侦察基线一致：`memory_gb: 32` = `Δ7365.85 CNY`、`storage_gb: 1000` = `Δ1340.43 CNY`。
4. 通过：TS 115 项测试、Python 8 项测试全绿；`npm run typecheck` 通过；前端已改为按维度渲染。

## 工单

1. `types.ts` 新增 `VariantOption` / `VariantDimension`，`ProductDetail.variants` 改类型。
2. `parser/detail-page.ts`：浏览器侧提取 twisterPlus 原始结构；Node 侧新增 `parseVariations`（价格双分支正则 + 脏数据清洗 + 无货标记）。
3. `db/persistence.ts`：`saveDetail` 落新 JSON 契约（代码路径不变，加契约测试）。
4. `public/index.html`：detail 变体渲染适配 `VariantDimension[]`。
5. Python `modeling/`：扩展 `connect` 读变体 JSON；新增配置向量拆解与单 Listing 价差计算；`unittest` 覆盖。
6. 端到端：真实抓取 → 落库 → Python 输出价差表。
