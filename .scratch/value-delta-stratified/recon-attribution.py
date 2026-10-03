#!/usr/bin/env python3.12
"""侦察：listings.variants -> DeltaRow 的损耗归因、解析质量、价格单调性。

目的：量化「25 个含变体 Listing 只有 6 个产出 deltas」的损耗结构，
为 Value Delta 第二层（分层 + 稳健清洗）定方案。
只读 data/amazon.db。
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "modeling" / "src"))

from modeling.connect import open_readonly  # noqa: E402
from modeling.value_delta import (  # noqa: E402
    config_diff,
    option_from_json,
    parse_config,
)

DB = REPO_ROOT / "data" / "amazon.db"

# label 里的存储线索词；命中却被解析成 memory_gb 即为误判
STORAGE_HINT = ("storage", "hdd", "ssd", "nvme", "pcie", "hard drive", "emmc")
RAM_HINT = ("ram", "ddr")


def analyze(data: list[object]) -> dict[str, object]:
    groups = [d for d in data if isinstance(d, dict) and isinstance(d.get("options"), list)]
    reasons: Counter[str] = Counter()
    per_unit: list[tuple[str, float, str, str, float, float]] = []
    nonmono: list[tuple] = []
    suspect: list[tuple[str, dict]] = []
    n_options = 0
    pairs = 0
    deltas = 0

    for g in groups:
        opts = [o for o in (option_from_json(x) for x in g["options"]) if o is not None]
        n_options += len(opts)
        if len(opts) < 2:
            reasons["group_lt2"] += 1
            continue
        cfgs = [parse_config(o.label) for o in opts]
        if all(not c for c in cfgs):
            reasons["no_config_text"] += 1
            continue

        # 解析质量：label 明说是存储、且无内存线索，却被归为 memory_gb
        for o, c in zip(opts, cfgs):
            low = o.label.lower()
            if (
                "memory_gb" in c
                and any(h in low for h in STORAGE_HINT)
                and not any(h in low for h in RAM_HINT)
            ):
                suspect.append((o.label, dict(c)))

        # 单调性：单键组内，配置量升序时价格也应升序；逆序 = 疑似异型号混入
        pts = []
        for o, c in zip(opts, cfgs):
            if o.price_num is None:
                continue
            items = sorted(c.items())
            if len(items) == 1:
                pts.append((items[0][1], o.price_num, o.label))
        if len(pts) >= 2:
            pts.sort()
            for x, y in zip(pts, pts[1:]):
                if y[1] < x[1]:
                    nonmono.append((x, y))

        for i, a in enumerate(opts):
            for b in opts[i + 1 :]:
                pairs += 1
                if a.price_num is None or b.price_num is None:
                    reasons["no_price"] += 1
                    continue
                if a.currency and b.currency and a.currency != b.currency:
                    reasons["cross_currency"] += 1
                    continue
                ca, cb = parse_config(a.label), parse_config(b.label)
                d = config_diff(ca, cb)
                if d is None:
                    keys = set(ca) | set(cb)
                    changed = [k for k in keys if ca.get(k) != cb.get(k)]
                    if not changed:
                        reasons["same_config"] += 1
                    elif any(ca.get(k) is None or cb.get(k) is None for k in changed):
                        reasons["asym_parse"] += 1
                    else:
                        reasons["multi_key"] += 1
                    continue
                deltas += 1
                dim, change = next(iter(d.items()))
                pu = (b.price_num - a.price_num) / change
                if pu > 0:
                    per_unit.append((dim, pu, a.label, b.label, a.price_num, b.price_num))
                else:
                    reasons["negative_pu"] += 1

    return {
        "n_groups": len(groups),
        "n_options": n_options,
        "pairs": pairs,
        "deltas": deltas,
        "positive": len(per_unit),
        "reasons": reasons,
        "per_unit": per_unit,
        "nonmono": nonmono,
        "suspect": suspect,
    }


def main() -> None:
    conn = open_readonly(DB)
    rows = conn.execute(
        "SELECT asin, title, price_num, variants FROM listings "
        "WHERE marketplace='com' AND variants IS NOT NULL AND variants != '' "
        "ORDER BY price_num"
    ).fetchall()
    conn.close()

    total_reasons: Counter[str] = Counter()
    all_pu: list[tuple[str, float, str, str, str]] = []
    n_nonmono_groups = 0
    n_suspect = 0
    n_with_deltas = 0
    n_with_positive = 0

    print(f"含变体 Listing：{len(rows)}")
    print()
    print(
        f"{'asin':<12}{'price':>10}{'grp':>5}{'opt':>5}{'pair':>6}{'dlt':>5}{'pos':>5}  "
        f"{'reason':<30}title"
    )
    for r in rows:
        data = json.loads(r["variants"])
        if not isinstance(data, list):
            continue
        a = analyze(data)
        reason = ",".join(f"{k}={v}" for k, v in a["reasons"].most_common()) or "-"
        if a["deltas"] > 0:
            n_with_deltas += 1
        if a["positive"] > 0:
            n_with_positive += 1
        if a["nonmono"]:
            n_nonmono_groups += 1
        n_suspect += len(a["suspect"])
        total_reasons.update(a["reasons"])
        for dim, pu, la, lb, pa, pb in a["per_unit"]:
            all_pu.append((dim, pu, r["asin"], la, lb))
        price = r["price_num"] or 0.0
        title = (r["title"] or "")[:36]
        print(
            f"{r['asin']:<12}{price:>10.2f}{a['n_groups']:>5}{a['n_options']:>5}"
            f"{a['pairs']:>6}{a['deltas']:>5}{a['positive']:>5}  {reason:<30}{title}"
        )

    print()
    print("== 损耗归因汇总（按 pair 计） ==")
    for k, v in total_reasons.most_common():
        print(f"  {k:<16}{v:>5}")
    print()
    print(f"有 deltas 的 Listing：{n_with_deltas}；其中方向过滤后仍为正观测：{n_with_positive}")
    print(f"价格非单调的 Listing（疑似异型号混入）：{n_nonmono_groups}")
    print(f"解析误判样本数（存储文本被归为 memory_gb）：{n_suspect}")
    print()

    print("== 方向过滤后的正观测明细 ==")
    for dim, pu, asin, la, lb in sorted(all_pu, key=lambda x: (x[0], x[1])):
        print(f"  {dim:<11}{pu:>10.2f}  {asin}  {la!r} -> {lb!r}")
    print()

    by_dim: dict[str, list[float]] = {}
    for dim, pu, _asin, _la, _lb in all_pu:
        by_dim.setdefault(dim, []).append(pu)
    print("== 正观测分布（未清洗） ==")
    for dim in sorted(by_dim):
        vals = sorted(by_dim[dim])
        print(f"  {dim:<11}n={len(vals):<3}min={vals[0]:>9.2f} max={vals[-1]:>10.2f}")


if __name__ == "__main__":
    main()
