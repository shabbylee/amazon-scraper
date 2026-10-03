#!/usr/bin/env python3.12
"""端到端验收：Value Delta 数据质量（.scratch/value-delta-stratified/spec.md）。

退出码非 0 表示回归。只读 data/amazon.db。
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "modeling" / "src"))

from modeling.aggregate import aggregate  # noqa: E402
from modeling.connect import (  # noqa: E402
    open_readonly,
    read_all_variants,
    read_listing_variants,
)
from modeling.value_delta import compute_listing_deltas, parse_config  # noqa: E402

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    print(f"  [{'PASS' if condition else 'FAIL'}] {message}")
    if not condition:
        failures.append(message)


def main() -> None:
    conn = open_readonly(REPO_ROOT / "data" / "amazon.db")

    print("== A. 双维度变化不再被伪造成单维度 ==")
    check(
        parse_config("32GB|1TB") == {"memory_gb": 32.0, "storage_gb": 1000.0},
        "parse_config('32GB|1TB') 同时保留内存与存储",
    )
    check(
        parse_config("14 inch | 4 GB | 64 GB eMMC") == {"memory_gb": 4.0, "storage_gb": 64.0},
        "parse_config('14 inch | 4 GB | 64 GB eMMC') 同时保留内存与存储",
    )
    for asin in ("B0H1C6RCSF", "B0G2X81X3B"):
        rows = compute_listing_deltas(read_listing_variants(conn, "com", asin))
        check(rows == [], f"{asin} 不再产出污染观测（当前 {len(rows)} 行）")

    print("== B. 非单调变体组被标记并由聚合剔除 ==")
    rows = compute_listing_deltas(read_listing_variants(conn, "com", "B0HJTT6HP8"))
    check(
        len(rows) > 0 and all(not r.monotonic for r in rows),
        "B0HJTT6HP8（16GB 比 32GB 贵）全部标记非单调",
    )

    print("== C. 聚合分布 ==")
    all_rows = []
    for _asin, data in read_all_variants(conn, "com"):
        all_rows.extend(compute_listing_deltas(data))
    conn.close()

    result = {r.dimension: r for r in aggregate(all_rows)}
    memory = result.get("memory_gb")
    storage = result.get("storage_gb")
    check(
        memory is not None and memory.min >= 100.0,
        f"memory_gb 不再含 13.96 这类非单调脏值（min={memory.min if memory else None}）",
    )
    check(
        memory is not None and memory.dropped_nonmonotonic >= 1,
        f"memory_gb 如实报告被剔除的非单调观测数（{memory.dropped_nonmonotonic if memory else None}）",
    )
    check(
        memory is not None and memory.iqr is not None and memory.mad is not None,
        "memory_gb 产出稳健统计（IQR / MAD）",
    )
    check(
        storage is not None and storage.max <= 2.1,
        f"storage_gb 上界不再含 3.35 这类假值（max={storage.max if storage else None}）",
    )
    check(
        memory is not None and memory.ci95_low is None,
        "样本不足时不报置信区间（避免假精度）",
    )

    print()
    if failures:
        print(f"验收失败 {len(failures)} 项")
        raise SystemExit(1)
    print("验收全部通过")


if __name__ == "__main__":
    main()
