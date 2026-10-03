"""聚合 data/amazon.db 中所有 Listing 的配置边际价。

用法：
    PYTHONPATH=modeling/src <python3.12> modeling/scripts/aggregate.py [marketplace]

输出 stdout 表格；JSON 结果写 .scratch/value-delta-multi/aggregate.json。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "modeling" / "src"))

from modeling.aggregate import aggregate  # noqa: E402
from modeling.connect import open_readonly, read_all_variants  # noqa: E402
from modeling.value_delta import compute_listing_deltas  # noqa: E402


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
    print(f"[aggregate] marketplace={scope} listings_with_variants={len(variants)} "
          f"listings_with_deltas={listings_with_deltas} total_delta_rows={len(rows)}")

    result = aggregate(rows)
    if not result:
        print("  无可聚合样本：没有可计算的单维度配置价差。")
        return

    for r in result:
        unit = f"{r.currency}/{r.dimension}"
        line = (
            f"  {r.dimension:<12} {r.currency:<4} n={r.n:<3} "
            f"mean={r.mean:,.2f} {unit} median={r.median:,.2f} "
            f"std={r.std:,.2f} min={r.min:,.2f} max={r.max:,.2f}"
        )
        if r.std is None:
            line += " std=N/A"
        if r.ci95_low is not None and r.ci95_high is not None:
            line += f" ci95=[{r.ci95_low:,.2f}, {r.ci95_high:,.2f}]"
        print(line)

    out_file = REPO_ROOT / ".scratch" / "value-delta-multi" / "aggregate.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "scope": scope,
        "listings_with_variants": len(variants),
        "listings_with_deltas": listings_with_deltas,
        "total_delta_rows": len(rows),
        "aggregate": [r.to_dict() for r in result],
    }
    out_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"[aggregate] JSON 已写 {out_file}")


if __name__ == "__main__":
    main()
