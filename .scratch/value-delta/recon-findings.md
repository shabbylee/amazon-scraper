# Value Delta 侦察发现

日期：2026-10-02。方法：真实抓取 amazon.com（`com`，直连无代理），逐页 dump 变体区 DOM。

## 结论摘要

Value Delta 切片的两个决定性问题都有答案，且最小闭环已跑通。

| 问题 | 答案 |
|---|---|
| Q-A 配置维度能解析吗 | 能。变体组件是 **twisterPlus**（不是老 `#twister`），维度名分两类 |
| Q-B 变体价格能拿到吗 | 能。选项文本里直接带"起始价"，**不用逐子 ASIN 抓** |

## 关键发现

### 1. 变体组件是 twisterPlus

老选择器 `#variation .selection` / `#twister` 已失效（16 个 ASIN 全部返回空）。真实结构：

- 容器：`#twister_feature_div`
- 维度行：`[id^="inline-twister-row-"]`，维度名从 id 后缀取（`inline-twister-row-<dimId>`）
- 维度标题：`#inline-twister-dim-title-<dimId>`（如 `"大小: 16GB RAM | 512GB SSD"`）
- 选项：`li[data-asin]`，子 ASIN 在 `data-asin` 属性
- 选项文本：`.swatch-title-text-display` 或 `.a-button-text`

### 2. 维度语义分两类

- **组合维度**（`set_name` / `size_name`）：配置挤在一个文本，如 `"32GB DDR5 RAM,1TB PCIe SSD"`，需拆解成配置向量。
- **独立维度**（`processor_description` / `computer_memory_size` / `hard_disk_size` / `graphics_coprocessor`）：一个维度一个硬件属性，天然结构化。
- **坑**：维度名 ≠ 语义。MacBook 的 `configuration` 是"含/不含 AppleCare+"，硬件（存储）藏在 `style_name` 里。不能按维度名假设含义。

### 3. 起始价直接在选项文本里

选项文本格式：`<配置> <N个选项，起始价：CNY X,XXX.XX>`。正则 `起始价\s*[：:]\s*(?:CNY|US\$|\$|€|£)?\s*([\d,]+(?:\.\d+)?)` 可程序化提取。

验证样本 `B0HFVPJ71V`（HP Pavilion，`set_name` 三变体）：

| 配置 | 起始价 CNY |
|---|---|
| 32GB DDR5 RAM, 1TB PCIe SSD | 7,372.27 |
| 64GB DDR5 RAM, 1TB PCIe SSD | 14,738.12 |
| 64GB DDR5 RAM, 2TB PCIe SSD | 16,078.55 |

价差：内存 32→64GB = 7,365.85；硬盘 1TB→2TB = 1,340.43。数量级合理，Value Delta 链路成立。

### 4. 数据质量坑（解析前必须清洗）

- 选项文本混入 CSS 注释垃圾：`"/* Temporary CSS overrides for savings. "`（`B0HF3J55CY` 颜色维度）。
- 脏配置值：`"7GB"`、`"2GB"`（`set_name` 里混入无关商品）。
- 库存状态混在文本里：`"目前无货"`、`"无法配送此商品至您所选的配送地点"`、`"N个选项"`。
- 货币本地化：中国 IP 返回 CNY 与中文标签，美国 IP 返回 USD 与英文（`from $X`）。解析要兼容多币种/多语言。
- 起始价是"最低价"（from price），不是该配置成交价；对边际价值归因已足够，但不是精确成交价。

## 对切片数据层的含义

1. `detail` parser 需新增 twisterPlus 提取：遍历 `[id^="inline-twister-row-"]`，每维度取标题 + `li[data-asin]` 的 `data-asin` 与完整文本。
2. 配置向量拆解：组合维度文本需拆 `"32GB DDR5 RAM,1TB PCIe SSD"` → `{memory: 32GB, storage: 1TB}`；独立维度直接映射。
3. 价格从选项文本正则提取起始价，记录币种；不做逐子 ASIN 抓（省抓取量，也守限速约束）。
4. 脏数据清洗是数据层的硬任务，不是可选项。

## 侦察脚本

- `.scratch/value-delta/recon-variants.mjs` — 批量探测 twisterPlus 维度
- `.scratch/value-delta/recon-deep.mjs` — 找真实变体组件 id
- `.scratch/value-delta/recon-twisterplus.mjs` — dump 单维度原始 HTML
- `.scratch/value-delta/recon-price.mjs` — 精确提取起始价并验证价差
