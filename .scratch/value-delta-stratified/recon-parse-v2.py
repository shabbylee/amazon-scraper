#!/usr/bin/env python3.12
"""侦察：原型 v2 解析器（清洗 + 配置向量）对比 v1 的可归因对上界。

只读 data/amazon.db，不写任何文件。用于判断「修解析」相对「修采集价格」的收益。
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "modeling" / "src"))

from modeling.value_delta import (  # noqa: E402
    VALID_MEMORY_GB,
    VALID_STORAGE_GB,
    config_diff,
    option_from_json,
    parse_config,
)

DB = REPO_ROOT / "data" / "amazon.db"

# ---- v2 清洗：剥掉 CSS / 价格 / 库存状态文本 ----
_CSS_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_CSS_RULE = re.compile(r"[.#@][\w-]*[^{}]*\{[^{}]*\}")
_CSS_DECL = re.compile(r"[\w-]+\s*:\s*var\([^)]*\)\s*!?important;?")
_PRICE = re.compile(r"(?:CNY|US\$|USD|\$|€|£|JP¥|¥)\s*[\d,]+(?:\.\d+)?", re.I)
_NOISE_PATTERNS = (
    r"with\s+\d+\s*percent\s+savings",
    r"\d+\s*percent\s+savings",
    r"see\s+available\s+options",
    r"currently\s+unavailable\.?",
    r"temporarily\s+out\s+of\s+stock",
    r"out\s+of\s+stock",
    r"only\s+\d+\s+left\s+in\s+stock[^.]*\.",
    r"this\s+item\s+cannot\s+be\s+shipped[^.]*\.",
    r"please\s+choose\s+a\s+different\s+delivery\s+location\.?",
    r"order\s+soon\.?",
    r"in\s+stock",
    r"无法配送",
    r"目前无货",
)
_NOISE = tuple(re.compile(p, re.I) for p in _NOISE_PATTERNS)

_GB = re.compile(r"(\d+(?:\.\d+)?)\s*GB", re.I)
_TB = re.compile(r"(\d+(?:\.\d+)?)\s*TB", re.I)
_NEXT_WORD = re.compile(r"[\s|+&,/·-]*([A-Za-z][A-Za-z0-9]*)")

_MEM_WORDS = {"ram", "ddr", "ddr3", "ddr4", "ddr5", "lpddr", "lpddr4", "lpddr5", "lpddr5x", "sdram"}
_STOR_WORDS = {
    "ssd", "hdd", "emmc", "ufs", "storage", "pcie", "nvme",
    "hard", "drive", "sd", "flash", "pcie4", "pcie5", "gen4",
}


def clean_label(raw: str) -> str:
    t = _CSS_COMMENT.sub(" ", raw)
    t = _CSS_RULE.sub(" ", t)
    t = _CSS_DECL.sub(" ", t)
    t = _PRICE.sub(" ", t)
    for pat in _NOISE:
        t = pat.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip(" |,;-")


def _kind_after(t: str, end: int) -> str:
    m = _NEXT_WORD.match(t, end)
    if not m:
        return "unknown"
    w = m.group(1).lower()
    if w in _MEM_WORDS:
        return "mem"
    if w in _STOR_WORDS:
        return "stor"
    return "unknown"


def parse_config_v2(raw: str) -> dict[str, float]:
    t = clean_label(raw)
    if not t:
        return {}

    stor: float | None = None
    mem: float | None = None
    unknowns: list[float] = []

    tb = _TB.search(t)
    if tb:
        stor = float(tb.group(1)) * 1000

    for m in _GB.finditer(t):
        # TB 已覆盖存储时，跳过与之重叠的 GB 数字（如 "1TB" 里的 1 不会被 GB 匹配，安全）
        val = float(m.group(1))
        kind = _kind_after(t, m.end())
        if kind == "mem":
            if mem is None:
                mem = val
        elif kind == "stor":
            if stor is None:
                stor = val
        else:
            unknowns.append(val)

    if len(unknowns) == 1:
        v = unknowns[0]
        if mem is None and stor is not None:
            mem = v
        elif stor is None and mem is not None:
            stor = v
        elif mem is None and stor is None:
            # 单凭证消歧：只在合法内存集里 -> 内存；只在合法存储集里 -> 存储；都在 -> 内存
            if v in VALID_MEMORY_GB and v not in VALID_STORAGE_GB:
                mem = v
            elif v in VALID_STORAGE_GB and v not in VALID_MEMORY_GB:
                stor = v
            elif v in VALID_MEMORY_GB:
                mem = v
    elif len(unknowns) >= 2 and mem is None and stor is None:
        # "16GB|512GB" 这类紧凑格式：按出现顺序 RAM|Storage
        mem, stor = unknowns[0], unknowns[1]

    cfg: dict[str, float] = {}
    if mem is not None and mem in VALID_MEMORY_GB:
        cfg["memory_gb"] = mem
    if stor is not None and stor in VALID_STORAGE_GB:
        cfg["storage_gb"] = stor
    return cfg


def main() -> None:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = conn.execute(
        "SELECT asin, variants FROM listings "
        "WHERE marketplace='com' AND variants IS NOT NULL AND variants != ''"
    ).fetchall()
    conn.close()

    stat = {v: Counter() for v in ("v1", "v2")}
    obs = {v: [] for v in ("v1", "v2")}
    changed = []

    for asin, vjson in rows:
        data = json.loads(vjson)
        if not isinstance(data, list):
            continue
        for g in data:
            opts = [o for o in (option_from_json(x) for x in (g.get("options") or [])) if o]
            for i, a in enumerate(opts):
                for b in opts[i + 1 :]:
                    for ver, parser in (("v1", parse_config), ("v2", parse_config_v2)):
                        d = config_diff(parser(a.label), parser(b.label))
                        if d is None:
                            continue
                        stat[ver]["attrib"] += 1
                        priced = a.price_num is not None and b.price_num is not None
                        if priced:
                            stat[ver]["priced"] += 1
                        dim, change = next(iter(d.items()))
                        if not priced:
                            continue
                        pu = (b.price_num - a.price_num) / change
                        if pu > 0:
                            stat[ver]["positive"] += 1
                            obs[ver].append((dim, pu, asin, clean_label(a.label), clean_label(b.label)))
                        else:
                            stat[ver]["negative"] += 1
                    c1 = config_diff(parse_config(a.label), parse_config(b.label))
                    c2 = config_diff(parse_config_v2(a.label), parse_config_v2(b.label))
                    if (c1 is None) != (c2 is None):
                        changed.append(
                            (asin, clean_label(a.label), clean_label(b.label), c1, c2)
                        )

    print("== v1 vs v2 可归因对 ==")
    for ver in ("v1", "v2"):
        s = stat[ver]
        print(
            f"  {ver}: 可归因={s['attrib']:<4} 两端有价={s['priced']:<4} "
            f"正观测={s['positive']:<4} 负观测={s['negative']}"
        )
    print()
    print(f"== 归因判定翻转的 pair（{len(changed)} 个）==")
    for asin, la, lb, c1, c2 in changed[:25]:
        print(f"  {asin}  {la!r} -> {lb!r}\n      v1={c1}  v2={c2}")
    print()
    print("== v2 正观测明细 ==")
    for dim, pu, asin, la, lb in sorted(obs["v2"], key=lambda x: (x[0], x[1])):
        print(f"  {dim:<11}{pu:>10.2f}  {asin}  {la!r} -> {lb!r}")
    print()
    for ver in ("v1", "v2"):
        by: dict[str, list[float]] = {}
        for dim, pu, *_ in obs[ver]:
            by.setdefault(dim, []).append(pu)
        print(f"== {ver} 正观测分布 ==")
        for dim in sorted(by):
            vals = sorted(by[dim])
            print(f"  {dim:<11}n={len(vals):<3}min={vals[0]:>9.2f} max={vals[-1]:>10.2f}")


if __name__ == "__main__":
    main()
