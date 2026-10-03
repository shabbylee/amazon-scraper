# Value Delta 数据质量与样本量切片规格

日期：2026-10-03。上游：`.scratch/value-delta-multi/`（聚合跑通，但 `n=5`）。架构决策：`docs/adr/0009-modeling-layer-python.md`。

## 目标

让 Value Delta 的每个观测都经得起追问，并把样本量推到当前语料的真实上限。上游切片留下的 `n=5` 不是统计方法不够强，而是三件事叠加：解析误判制造假观测、采集层 label 脏化污染输入、语料结构本身封顶。本切片依次拆掉前两层，量化第三层，并把「分层」推迟到 n 足够时。

## 侦察结论（2026-10-03，实测）

`46` 个 com Listing → `25` 含变体 → `108` 个变体选项 → `164` 个候选配对。逐层收窄：

| 环节 | 数量 | 说明 |
|---|---|---|
| 候选配对 | 164 | 组内两两组合 |
| 单维度可归因（v1） | 24 | 其余 140 个是多维同变/无配置文本/凭证缺失 |
| 单维度可归因（v2） | 26 | 修解析后净增 2 |
| 两端有价格（v1 / v2） | 14 / 13 | 选项价格缺失 51 个 |
| 方向过滤后正观测 | 10 / 9 | v1 的 10 个里至少 2 个是假的 |
| **语料天花板** | **26** | 即使价格全补齐也到不了这里 |

三条具体缺陷，均已复现：

**D1 双维度变化被伪造成单维度。** `'32GB|1TB' -> '64GB|2TB'`（B0H1C6RCSF）内存与存储同时翻倍。v1 的 `_TB_RE` 先认走 `1TB/2TB`，而 `32GB` 因后跟 `|` 不匹配任何内存正则，内存被静默丢弃，差值退化为纯存储 `+1000GB`，产出污染的 `3.35 CNY/GB`。同理 `'14 inch | 4 GB | 64 GB eMMC' -> '16GB | 128GB UFS'`（B0G2X81X3B）实际同时变了内存与存储，v1 只取到内存 `4 -> 16`，产出假的内存观测。

**D2 存储文本被误判为内存。** `_GB_LONE_RE` 兜底把无后缀的 `N GB` 一律归内存，于是 `'128GB Storage'` 成了 `memory_gb=128`。同时 `_GB_SSD_RE` 只认 `GB SSD|PCIe|NVMe`，`'500GB HDD & 128GB Storage'`、`'4GB RAM | 384GB Storage'` 的存储量全部丢失。

**D3 采集层 label 脏化。** 浏览器侧 `extractDetailInPage` 用 `text(li)` 取 `<li>` 的全量 `textContent`，把 `<li>` 内 `<style>` 标签的 CSS 规则体一并吸入。7 个 `color_name` 选项的 label 是整段 `.centralizedApexPriceSavingsOverrides {...} CNY 1,742.50 ... In Stock`，另有 `'See available options'`、`'Currently unavailable.'`、`'This item cannot be shipped to...'` 等状态文本残留。`parseVariantText` 只删 `/* */` 注释（测试也只覆盖这一形态），未删 CSS 规则块。

## 设计决策

**Q1 正确性优先于样本量。** 扩样本前必须先修正确性：当前 10 个正观测里 2 个是假的，此时扩量只是放大错误。解析器与清洗先落地并复验，再谈采集扩展。

**Q2 两侧都修，职责分明。** 采集层负责让 label 的**源头**干净（剔除 `style`/`script` 子树、剥离状态文本）；建模层负责**防御性清洗**（即使面对已落库的脏 label 也能还原）。已落库的 25 个 Listing 不回炉重抓也能受益于建模层清洗，这是两件事拆开的原因。

**Q3 分层推迟到 n 足够时。** `n=5` 分两层即每层 `n=2`，统计上无意义，报出来是自欺。分层作为**能力**实现并测试，但按 `n` 阈值门控，未达阈值时如实报告「样本不足以分层」。

**Q4 稳健统计替代正态近似。** 上游的 `n>=30` 正态近似 CI 在当前语料永远达不到。改用中位数 + IQR + MAD 描述分布，对 D1 这类污染观测不敏感；同时保留 `n` 与极值，让读者自己判断。小数点后保留与量纲一致的位数。

**Q5 扩大 Listing 基数是唯一能把 n 做大的路径。** 语料转化率约 13%（46 Listing → 6 个含可算价差），要把每组 n 推到 30 量级需要数百个详情抓取。这受 AGENTS.md 的限速与 CAPTCHA 硬约束约束，必须按现有 `collect.sh` 的串行限速跑、命中 CAPTCHA 即停，且需要用户明确授权。

## 工单

1. `modeling/src/modeling/value_delta.py`：`parse_config` 重写——清洗脏 label、扩展存储线索词、内存/存储正确区分、紧凑格式 `GB|GB` 与 `GB+TB` 支持、凭证缺失时用合法集消歧。
2. `modeling/src/modeling/clean.py`（新）：`clean_label` 纯函数——剥 CSS 注释/规则块/声明、价格串、库存与配送状态文本。
3. `modeling/src/modeling/value_delta.py`：观测级过滤——`unavailable` 选项不参与配对；单维度判定增加「同组内价格与配置量单调性」校验，非单调组标记低置信。
4. `src/parser/detail-page.ts`：label 提取剔除 `style`/`script` 子树；`parseVariantText` 增补 CSS 规则块与状态文本清洗。
5. `modeling/src/modeling/aggregate.py`：稳健统计字段（`q1`/`q3`/`iqr`/`mad`）+ 分层能力（按价格段切分）与 `n` 阈值门控。
6. 端到端：重跑聚合，报告清洗前后观测集合差异与最终分布。
7. 采集扩展（需授权）：多关键词 × 多页扩基数，验证 n 能到多少。

## 验收标准

1. 建模层测试绿：`clean_label` 对 7 类脏 label 形态（CSS 规则块、CSS 注释、价格串、状态文本、紧凑格式、干净格式、空串）行为正确；`parse_config` 对真实库全部 label 的解析结果逐个核对，`'32GB|1TB'`/`'4GB RAM | 384GB Storage'`/`'128GB Storage'` 等关键形态正确。
2. 假观测消失：`B0H1C6RCSF '32GB|1TB'->'64GB|2TB'` 与 `B0G2X81X3B` 的污染对不再产出观测。
3. 稳健统计与分层门控测试绿：`n` 低于阈值时分层字段为 `None` 并给出原因，不产出空分层。
4. 采集层测试绿：含 `<style>` 子树与状态文本的 `li` 解析出干净 label；既有测试保持通过。
5. TS `npm run typecheck` + `npm test` 通过；Python 全量测试通过。
6. 真实库端到端：报告清洗前后观测集合、每组 `n`，并明确标注语料天花板。

## 验收结果（2026-10-03）

1. 通过：Python 建模层 41 项测试全绿（新增 `test_clean` 6 项、`parse_config` 真实格式 6 项、单调性 4 项、稳健统计与分层 7 项）。
2. 通过：TS 采集层 137 项测试全绿（`detail-page` 新增 3 项），`npm run typecheck` 与 `npm run build` 通过。
3. 通过：污染对消失——`B0H1C6RCSF`（`'32GB|1TB' -> '64GB|2TB'`）与 `B0G2X81X3B` 各产出 0 个 delta 行。
4. 通过：真实库分布收敛——`memory_gb` `n` 5→3、`min` 13.96→125.67；`storage_gb` `n` 5→4、`max` 3.35→2.05。
5. 通过：分层按门控不产出，脚本如实报告「每个价格段需 n >= 30」而非给出无意义分层。
6. 通过（反向验证）：把建模层与采集层回退到 HEAD，`memory_gb min=13.96` / `storage_gb max=3.35` 复现，说明新验收脚本对该回归有区分度。
7. 未做（本轮范围外）：扩样本采集。语料天花板经实测为 26 个可归因对，当前 13 两端有价，扩样本是唯一能把每组 `n` 推到 30 量级的路径，待授权。

## 边界

不做：汇率换算、跨 Seller 同款匹配、BSR→销量、动态定价、schema 变更与结果落库。分层在 `n` 不足时不产出，不为了「有输出」而报无意义的分层。
