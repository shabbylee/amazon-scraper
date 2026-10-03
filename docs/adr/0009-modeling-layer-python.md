# 建模层选 Python：独立目录 + SQLite 文件衔接

## 背景

AI 商业智能学习系统规划图对应的能力可拆成两层：采集层（抓取 Amazon 公开数据，产出"事实"）与建模层（Value Delta 配置-价差归因、BSR→销量模型、产品市场价值模型、需求预测、动态定价等统计与机器学习能力）。

现有仓库 `amazon-scraper` 是 TypeScript strict + ESM 的成熟采集层（搜索页 / 详情页 / 持久化 / 调度 / 价格提醒，112 项测试）。但建模层的成熟开源件几乎全在 Python 生态：统计建模（numpy/pandas/scipy）、时序预测（ARIMA/Prophet/LightGBM）、动态定价（RL/Bandits）。GitHub 技能清单（`AI商业智能学习系统_GitHub技能清单.md`）收录的建模类仓库同样是 Python notebook 与研究代码为主。

## 决定

- **建模层用 Python（requires-python >= 3.11）**，放在独立目录 `modeling/`，独立 `pyproject.toml`，与 TS 采集层同仓库但不混语言。
- **采集层保持 TypeScript 不变**：继续负责抓取、反爬、持久化、调度，产出写入 `data/amazon.db`。
- **衔接机制 = SQLite 文件**：建模层以只读方式打开 `data/amazon.db`，读取 `listings` / `price_snapshots` / `watches` / `price_alerts`。采集层只写，建模层只读；建模层的派生数据（模型参数、预测结果）落库位置另行定义。
- **不引入 HTTP/消息中间层**：SQLite 是标准跨语言格式，`better-sqlite3`（TS）与 Python 标准库 `sqlite3` 可读写同一文件，本地单机工具无需为跨层通信再起服务。
- **schema 成为跨语言契约**：改表结构会同时影响 TS 与 Python，必须走 ADR，不允许单边改。

## 被拒绝的替代方案

- **TypeScript 单栈**：统计、预测、定价在 TS 生态没有等价成熟度，重写代价高，且建模层算法几乎需要照搬 Python 论文实现再验证。
- **Python 重写采集层**：抛弃现有 TS 采集资产（反爬、代理、调度、112 项测试），纯浪费。
- **HTTP API 衔接**：本地工具引入常驻服务与端口管理，增加运维复杂度；SQLite 文件已满足"采集层写、建模层读"的耦合需求。

## 后果

- 仓库变为 TS + Python 双语言，各自有依赖管理（npm / uv）。
- `data/amazon.db` 的 schema 升级必须同步 TS 与 Python 两边的读取逻辑。
- 建模层产物（模型参数、预测值、评分）需要新增表或独立库，届时按 ADR 追加。
- 环境上以 `python3.12` 为基线；`data/` 仍在 `.gitignore` 内，不提交数据库文件。
