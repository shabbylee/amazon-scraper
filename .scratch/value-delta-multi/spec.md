# Value Delta 多 Listing 聚合切片规格

日期：2026-10-03。上游：`.scratch/value-delta/`（单 Listing 配置边际价值已验收）。架构决策：`docs/adr/0009-modeling-layer-python.md`。

## 目标

把多个 Listing 的单维度配置价差归一化为**每单位边际价**，跨 Listing 合并，按 `(dimension, currency)` 分组产出统计分布：`n / mean / median / std / min / max`，样本量足够时附 95% 置信区间。这是图中 Value Delta 的统计形态，单 Listing 只是它的一个观测。

## 范围

**做**：Python 建模层新增聚合模块（纯函数，零新依赖）；入口脚本读全库 `listings.variants`；采集 orchestration 脚本（scratch 层，走现有 API，串行限速）；真实数据跑通并报告样本量与分布。

**不做**：汇率换算（只按币种分组）；小样本 t 分布区间（`n < 30` 不报 CI，避免假精度）；跨 Seller 同款匹配、BSR→销量、动态定价、六维决策；schema 变更与聚合结果落库（ADR-0009 建模层产物落库位置待定，本切片只输出 stdout + JSON 文件）。

## 设计决策

**D1：带符号归一化 + 方向一致性过滤**。单 Listing 的 `DeltaRow` 是"价差 + 变化量"（如 `memory_gb: +32, Δ7365.85`），不同 Listing 变化量不同。聚合前归一化为每单位边际价：`price_delta / change`（带符号除法）。配置升级且涨价、配置降级且降价，两种正常视角的商都是正值，量纲统一为 `CNY/GB`；"升级却降价 / 降级却涨价"的反向对归一化后为负，是促销或异型号变体混入的噪声，直接过滤。这样既统一量纲，又挡住单 Listing 两两配对在脏变体组里产生的异常对。

**D2：币种分组，不换算**。侦察发现货币随 IP 漂移（中国 IP 返回 CNY，美国 IP 返回 USD）。聚合按 `(dimension, currency)` 分组，只合并同币种样本；不引入汇率源与换算，避免把汇率波动混进边际价值。

**D3：标准库统计，零新依赖**。`mean/median/std/min/max` 用 Python 标准库 `statistics`，不引入 numpy/scipy。95% CI 只在 `n ≥ 30` 时用正态近似（`mean ± 1.96 * std / sqrt(n)`）报告；小样本 CI 本身不稳，不报，只给描述统计。

**D4：样本获取走现有 API，不新增 TS 采集代码**。采集层已有 `/api/scrape`（搜索页→ASIN 列表）与 `/api/detail`（详情→variants 落库），orchestration 是 scratch 层脚本的编排职责，不是新的采集能力。脚本串行调用、相邻请求间隔 ≥ 2.5s（守住 AGENTS.md 限速硬约束）、遇 CAPTCHA 失败即停止。

**D5：聚合结果不落库**。物理 schema 不变；聚合产物写 stdout 与 `.scratch/value-delta-multi/aggregate.json`，不碰 `data/amazon.db` 写路径。

## 聚合契约

输入：跨 Listing 汇总的 `DeltaRow[]`（每个 Listing 用 `compute_listing_deltas` 产出）。

输出：每个 `(dimension, currency)` 一组：

```text
dimension: memory_gb  currency: CNY  n: 12
  mean: 214.33 CNY/GB  median: 198.50  std: 41.2  min: 152.0  max: 296.7
  ci95: [189.1, 239.6]   (n >= 30 时报告)
```

Python `aggregate.py` 导出 `AggregateRow`（dataclass）与 `aggregate(rows: list[DeltaRow]) -> list[AggregateRow]`，纯函数、可单测。

## 验收标准

1. `aggregate` 单元测试绿：归一化正确、按 `(dimension, currency)` 分组、`n/mean/median/std/min/max` 数值正确、`n < 30` 不报 CI 且 `n ≥ 30` 报 CI、混合币种分组不串。
2. `collect.sh` 跑通：搜索页拿 ASIN 列表 → 逐 ASIN 抓详情，串行且相邻请求间隔 ≥ 2.5s，CAPTCHA 失败即停。
3. 真实数据跑聚合：入口脚本输出每个 `(dimension, currency)` 组的统计分布，`n` 如实报告（可为 0，但不允许静默跳过失败）。
4. TS 采集层零改动，`npm run typecheck` 与既有测试保持通过。

## 工单

1. `modeling/src/modeling/aggregate.py`：`AggregateRow` + `per_unit_observations` + `aggregate` 纯函数。
2. `modeling/src/modeling/connect.py`：新增 `read_all_variants`，读所有含变体 JSON 的 Listing。
3. `modeling/scripts/aggregate.py`：入口脚本，读全库 → 汇总 `DeltaRow[]` → 聚合 → stdout + JSON 文件。
4. `modeling/tests/test_aggregate.py`：单元测试覆盖验收标准 1。
5. `.scratch/value-delta-multi/collect.sh`：搜索 + 逐 ASIN 详情 orchestration，限速，CAPTCHA 即停。
6. 真实数据端到端：跑 collect → 跑 aggregate，记录样本量与分布。

## 验收结果（2026-10-03）

1. 通过：Python 建模层 18 项测试全绿（8 value_delta + 10 aggregate），覆盖归一化、`(dimension, currency)` 分组、统计量、CI 边界、方向一致性过滤。
2. 通过：`collect.sh` 跑通。搜索 2 页落库 32 个 ASIN，逐 ASIN 抓详情 32/32 成功、零 CAPTCHA，串行间隔 2.5s。
3. 通过：真实数据聚合输出 `memory_gb`（n=5，mean=139.31 CNY/GB）与 `storage_gb`（n=5，mean=1.78 CNY/GB）两组分布，n 如实报告，n<30 不报 CI。
4. 通过：TS 采集层零改动，`npm run typecheck` 通过，TS 115 项测试全绿。

## 实测发现（留给下一层清洗）

- **方向过滤有效但不够**。带符号归一化挡掉了"升级却降价 / 降级却涨价"的反向异常对（`B0HJTT6HP8` 的 4 个反向对被过滤），但挡不住"同向但幅度异常"的脏对：该 Listing 变体组混入异型号，剩下的降级对每 GB 内存仅 13.96 CNY，远低于市场水平，仍拉宽了分布。
- **内存边际价跨机型差异大**（13.96-259.71 CNY/GB），存储相对集中（0.67-3.35 CNY/GB）。要得到稳定的市场边际价，需按价格段/品类分层，或用变体组价格单调性校验 + 稳健统计（MAD/IQR）做第二层清洗。
- **dev 模式 detail 抓取存在运行时缺陷**：`tsx watch` 下 `page.evaluate(extractDetailInPage)` 报 `__name is not defined`（esbuild 序列化残留），生产构建（`npm run build && npm start`）正常。本切片用生产构建绕过，未修 dev 链路。
