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
│   └── inspect_db.py      # 验证 TS→Python 的 SQLite 衔接
├── src/
│   └── modeling/
│       ├── __init__.py
│       └── connect.py     # 只读打开 data/amazon.db
```

## 依赖

`numpy` / `pandas` 已随 bundled Python 提供。后续建模需要的 `scipy`、`statsmodels` 等用 `uv` 按需追加，不提前堆依赖。
