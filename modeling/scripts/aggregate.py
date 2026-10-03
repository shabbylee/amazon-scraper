"""聚合 data/amazon.db 中所有 Listing 的配置边际价。

用法：
    PYTHONPATH=modeling/src <python3.12> modeling/scripts/aggregate.py [marketplace]

输出 stdout 表格；JSON 结果写 .scratch/value-delta-multi/aggregate.json。

统计口径（.scratch/value-delta-stratified/spec.md）：中位数 / IQR / MAD 为主，
`n >= 30` 时才附正态近似 95% CI；组内价格非单调（变体维度混入异型号）的观测被剔除并计数；
分层按价格段切分，每段样本量不足时整组不产出。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "modeling" / "src"))

from modeling.aggregate import (  # noqa: E402
    STRATIFY_MIN_N,
    aggregate,
    stratify,
)
from modeling.connect import open_readonly, read_all_variants  # noqa: E402
from modeling.value_delta import compute_listing_deltas  # noqa: E402


def _num(value: float | None) -> str:
    return "N/A" if value is None else f"{value:,.2f}"


def main() -> None:
    marketplace = sys.argv[1] if len(sys.argv) > 1 else None
    db = REPO_ROOT / "data" / "amazon.db"
    if not db.exists():
        print(f"[aggregate] 数据库不存在: {db}")
        print("[aggregate] 先启动采集层（npm start）并抓取详情页。")
        raise SystemExit(1)

    conn = open_readonly(db)
    variants = read_all_variants(conn, marketplace)
    conn.close()

    rows = []
    listings_with_deltas = 0
    for _asin, data in variants:
        deltas = compute_listing_deltas(data)
        if deltas:
            listings_with_deltas += 1
        rows.extend(deltas)

    scope = marketplace or "all"
    dropped_total = sum(1 for r in rows if not r.monotonic)
    print(
        f"[aggregate] marketplace={scope} listings_with_variants={len(variants)} "
        f"listings_with_deltas={listings_with_deltas} total_delta_rows={len(rows)} "
        f"nonmonotonic_rows={dropped_total}"
    )

    result = aggregate(rows)
    if not result:
        print("  无可聚合样本：没有可计算的单维度配置价差。")
        return

    for r in result:
        unit = f"{r.currency}/{r.dimension}"
        print(
            f"  {r.dimension:<12} {r.currency:<4} n={r.n:<3} "
            f"median={_num(r.median)} {unit}  "
            f"q1={_num(r.q1)} q3={_num(r.q3)} iqr={_num(r.iqr)} mad={_num(r.mad)}"
        )
        tail = (
            f"      mean={_num(r.mean)} std={_num(r.std)} "
            f"min={_num(r.min)} max={_num(r.max)}"
        )
        if r.dropped_nonmonotonic:
            tail += f" dropped_nonmonotonic={r.dropped_nonmonotonic}"
        if r.ci95_low is not None and r.ci95_high is not None:
            tail += f" ci95=[{_num(r.ci95_low)}, {_num(r.ci95_high)}]"
        print(tail)

    strata = stratify(rows)
    if strata:
        for s in strata:
            print(
                f"  [分层] {s.dimension:<12} {s.currency:<4} {s.band:<5} "
                f"n={s.n:<3} median={_num(s.median)} q1={_num(s.q1)} q3={_num(s.q3)} "
                f"mad={_num(s.mad)} cut={_num(s.cut)}"
            )
    else:
        print(
            f"  分层：未产出（每个价格段需 n >= {STRATIFY_MIN_N}，"
            "当前语料未达到，如实报告而不给无意义分层）"
        )

    out_file = REPO_ROOT / ".scratch" / "value-delta-multi" / "aggregate.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "scope": scope,
        "listings_with_variants": len(variants),
        "listings_with_deltas": listings_with_deltas,
        "total_delta_rows": len(rows),
        "nonmonotonic_rows": dropped_total,
        "aggregate": [r.to_dict() for r in result],
        "strata": [s.to_dict() for s in strata],
    }
    out_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"[aggregate] JSON 已写 {out_file}")


if __name__ == "__main__":
    main()
