# Modeling Layer

WOWPC AI 商业智能系统的建模层。决策见 `docs/adr/0009-modeling-layer-python.md`。

## 职责边界

- **采集层**（仓库根 `src/`，TypeScript）：抓取 Amazon 公开数据，写入 `data/amazon.db`。
- **建模层**（本目录，Python ≥ 3.11）：以只读方式打开 `data/amazon.db`，产出统计与预测结果。

`data/amazon.db` 的 schema 是跨语言契约，改动走 ADR，禁止单边修改。

## 衔接验证

```bash
# 用 bundled Python 3.12（系统 Python 3.9 太旧）
PYTHONPATH=src /Users/lixu/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 \
  scripts/inspect_db.py
```

数据库不存在时会提示先启动采集层（`npm start`）生成 `data/amazon.db`。

## Value Delta（单 Listing）

```bash
PYTHONPATH=src <python3.12> scripts/value_delta.py B0HFVPJ71V com
```

读取 `listings.variants`（TS 落库的 twisterPlus JSON 契约），拆配置向量、算单 Listing 配置边际价值。规格见 `.scratch/value-delta/spec.md`。

## Value Delta（多 Listing 聚合）

```bash
PYTHONPATH=src <python3.12> scripts/aggregate.py [marketplace]
```

跨 Listing 汇总配置边际价，按 `(dimension, currency)` 分组。统计口径以**中位数 / IQR / MAD** 为主，`n >= 30` 时才附正态近似 95% CI；组内价格非单调（变体维度混入异型号）的观测被剔除并计数；分层按价格段切分且门控——每段样本量不足时整组不产出，不为了「有输出」而给无意义分层。

规格见 `.scratch/value-delta-multi/spec.md` 与 `.scratch/value-delta-stratified/spec.md`。

## 测试

```bash
<python3.12> -m unittest discover -s tests -v
```

## 目录

```
modeling/
├── pyproject.toml
├── README.md
├── scripts/
│   ├── inspect_db.py      # 验证 TS→Python 的 SQLite 衔接
│   ├── value_delta.py     # 单 Listing 配置边际价值表
│   └── aggregate.py       # 跨 Listing 聚合 + 稳健统计 + 分层门控
├── src/
│   └── modeling/
│       ├── __init__.py
│       ├── clean.py       # 脏 label 清洗（CSS / 内嵌价格 / 状态文本）
│       ├── connect.py     # 只读打开 data/amazon.db + variants 读取
│       ├── value_delta.py # 配置向量拆解 + 价差计算 + 组内单调性置信
│       └── aggregate.py   # 归一化 + 分组统计 + 分层
└── tests/
    ├── test_clean.py
    ├── test_value_delta.py
    └── test_aggregate.py
```

## 依赖

`numpy` / `pandas` 已随 bundled Python 提供。后续建模需要的 `scipy`、`statsmodels` 等用 `uv` 按需追加，不提前堆依赖。
