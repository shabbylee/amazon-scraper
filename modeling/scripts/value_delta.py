"""从 data/amazon.db 读一个 ASIN 的变体，输出单 Listing 配置边际价值表。

用法：
    PYTHONPATH=modeling/src <python3.12> modeling/scripts/value_delta.py [ASIN] [marketplace]
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "modeling" / "src"))

from modeling.connect import open_readonly, read_listing_variants  # noqa: E402
from modeling.value_delta import compute_listing_deltas  # noqa: E402


def main() -> None:
    asin = (sys.argv[1] if len(sys.argv) > 1 else "B0HFVPJ71V").upper()
    marketplace = sys.argv[2] if len(sys.argv) > 2 else "com"
    db = REPO_ROOT / "data" / "amazon.db"
    if not db.exists():
        print(f"[value-delta] 数据库不存在: {db}")
        print("[value-delta] 先启动采集层（npm start）抓取详情页。")
        raise SystemExit(1)

    conn = open_readonly(db)
    variants = read_listing_variants(conn, marketplace, asin)
    rows = compute_listing_deltas(variants)
    print(f"[value-delta] {marketplace}/{asin}")

    if variants is None:
        print("  无变体数据：可能未抓取，或抓取时 twisterPlus 未命中。")
    elif not rows:
        print("  有变体数据，但无可计算的单维度配置价差。")
    else:
        for r in rows:
            delta_desc = ", ".join(f"{k}: {v:g}" for k, v in r.delta.items())
            print(f"  {r.from_asin} -> {r.to_asin}  [{delta_desc}]  Δ{r.price_delta:g} {r.currency}")

    conn.close()


if __name__ == "__main__":
    main()
