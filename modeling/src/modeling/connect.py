"""采集层（TS）与建模层（Python）的 SQLite 衔接。

采集层（仓库根 src/，TypeScript）负责写 data/amazon.db，
建模层只读该库。schema 是跨语言契约，改动走 ADR（0009）。
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

# 与 src/db/schema.ts 的 MIGRATIONS 对齐；新增表需同步这里并走 ADR。
TABLES: tuple[str, ...] = (
    "listings",
    "price_snapshots",
    "watches",
    "price_alerts",
)


def open_readonly(db_path: str | Path) -> sqlite3.Connection:
    """以只读模式打开采集层生成的 SQLite 文件。

    用 URI 打开（mode=ro），避免误触写入；文件不存在时由 sqlite3 抛错，
    调用方按需提示先启动采集层。
    """
    uri = f"file:{Path(db_path).resolve()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    """返回各业务表的行数；表不存在记为 -1，便于诊断 schema 漂移。"""
    out: dict[str, int] = {}
    for name in TABLES:
        try:
            row = conn.execute(f"SELECT COUNT(*) AS n FROM {name}").fetchone()
            out[name] = int(row["n"])
        except sqlite3.OperationalError:
            out[name] = -1
    return out


def read_listing_variants(
    conn: sqlite3.Connection, marketplace: str, asin: str
) -> list[object] | None:
    """读 listings.variants 列并解析 JSON。

    契约见 .scratch/value-delta/spec.md；旧 string[] 记录按原样返回，
    由调用方（value_delta）做结构兼容判断。
    """
    row = conn.execute(
        "SELECT variants FROM listings WHERE marketplace = ? AND asin = ?",
        (marketplace, asin),
    ).fetchone()
    if row is None or not row["variants"]:
        return None
    data = json.loads(row["variants"])
    return data if isinstance(data, list) else None


def read_all_variants(
    conn: sqlite3.Connection, marketplace: str | None = None
) -> list[tuple[str, list[object] | None]]:
    """读所有（或指定 marketplace）含变体 JSON 的 Listing，返回 (asin, variants) 列表。

    只挑 variants 非空的记录；旧 string[] 记录按原样返回，由调用方做结构兼容判断。
    """
    if marketplace is None:
        rows = conn.execute(
            "SELECT asin, variants FROM listings "
            "WHERE variants IS NOT NULL AND variants != ''"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT asin, variants FROM listings "
            "WHERE marketplace = ? AND variants IS NOT NULL AND variants != ''",
            (marketplace,),
        ).fetchall()
    out: list[tuple[str, list[object] | None]] = []
    for row in rows:
        data = json.loads(row["variants"])
        out.append((row["asin"], data if isinstance(data, list) else None))
    return out
