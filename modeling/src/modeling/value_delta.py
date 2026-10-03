"""Value Delta：配置向量拆解 + 单 Listing 价差计算。

职责（.scratch/value-delta/spec.md）：
- parse_config：把变体配置文本拆成 {memory_gb, storage_gb}（笔记本语境）。
- compute_deltas：同一维度内，找出恰好一个配置维度变化的选项对，算价差。
本模块是纯函数，不碰 SQLite；DB 读取在 connect.py。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict

# 笔记本常见内存容量（GB）与硬盘容量（GB）；过滤 recon 发现的脏值（7GB / 2GB）。
VALID_MEMORY_GB = {4, 8, 16, 24, 32, 48, 64, 96, 128}
VALID_STORAGE_GB = {128, 256, 512, 1000, 1024, 2000, 2048, 4000, 4096}

_TB_RE = re.compile(r"(\d+(?:\.\d+)?)\s*TB", re.IGNORECASE)
_GB_SSD_RE = re.compile(r"(\d+(?:\.\d+)?)\s*GB(?:\s+(?:PCIe|SSD|NVMe))", re.IGNORECASE)
_GB_RAM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*GB(?:\s+(?:DDR\d?|RAM))", re.IGNORECASE)
_GB_LONE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*GB", re.IGNORECASE)


@dataclass(frozen=True)
class VariantOption:
    asin: str
    label: str
    price_num: float | None
    currency: str | None
    unavailable: bool


@dataclass(frozen=True)
class DeltaRow:
    from_asin: str
    to_asin: str
    delta: dict[str, float]
    price_delta: float
    currency: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def parse_config(label: str) -> dict[str, float]:
    """拆解笔记本配置文本为 {memory_gb, storage_gb}；解析失败/脏值不产出该键。"""
    t = label.replace(",", " ")
    config: dict[str, float] = {}

    # TB 一定是硬盘。
    tb = _TB_RE.search(t)
    storage_gb: float | None = float(tb.group(1)) * 1000 if tb else None

    # 无 TB 时，GB + SSD/PCIe/NVMe 是硬盘。
    if storage_gb is None:
        ssd = _GB_SSD_RE.search(t)
        if ssd:
            storage_gb = float(ssd.group(1))

    # GB + DDR/RAM 是内存。
    ram = _GB_RAM_RE.search(t)
    memory_gb: float | None = float(ram.group(1)) if ram else None

    # 纯数字 GB 且内存/硬盘都还没解析到，默认归内存（笔记本语境）。
    if memory_gb is None and storage_gb is None:
        lone = _GB_LONE_RE.search(t)
        if lone:
            memory_gb = float(lone.group(1))

    if memory_gb is not None and memory_gb in VALID_MEMORY_GB:
        config["memory_gb"] = memory_gb
    if storage_gb is not None and storage_gb in VALID_STORAGE_GB:
        config["storage_gb"] = storage_gb
    return config


def config_diff(a: dict[str, float], b: dict[str, float]) -> dict[str, float] | None:
    """返回 a→b 的单维度变化；多维度变化或维度缺失（可比性不足）返回 None。"""
    keys = set(a) | set(b)
    diff: dict[str, float] = {}
    for key in keys:
        av = a.get(key)
        bv = b.get(key)
        if av != bv:
            if av is None or bv is None:
                return None
            diff[key] = round(bv - av, 6)
    return diff if len(diff) == 1 else None


def compute_deltas(options: list[VariantOption]) -> list[DeltaRow]:
    """同一维度内两两配对，输出单配置变化的价差行。"""
    rows: list[DeltaRow] = []
    for i, a in enumerate(options):
        for b in options[i + 1 :]:
            if a.price_num is None or b.price_num is None:
                continue
            if a.currency and b.currency and a.currency != b.currency:
                continue
            delta = config_diff(parse_config(a.label), parse_config(b.label))
            if delta is None:
                continue
            rows.append(
                DeltaRow(
                    from_asin=a.asin,
                    to_asin=b.asin,
                    delta=delta,
                    price_delta=round(b.price_num - a.price_num, 2),
                    currency=b.currency or a.currency or "",
                )
            )
    return rows


def option_from_json(o: object) -> VariantOption | None:
    """把 TS 落库的 VariantOption JSON 对象转成 Python VariantOption。

    JSON 键是 camelCase（priceText/priceNum），与 Python snake_case 不同，
    显式映射；旧 string[] 元素或残缺对象返回 None。
    """
    if not isinstance(o, dict):
        return None
    asin = o.get("asin")
    label = o.get("label")
    if not isinstance(asin, str) or not isinstance(label, str):
        return None
    price_num_raw = o.get("priceNum")
    currency_raw = o.get("currency")
    return VariantOption(
        asin=asin,
        label=label,
        price_num=float(price_num_raw) if isinstance(price_num_raw, (int, float)) else None,
        currency=currency_raw if isinstance(currency_raw, str) and currency_raw else None,
        unavailable=bool(o.get("unavailable")),
    )


def compute_listing_deltas(variants_json: list[object] | None) -> list[DeltaRow]:
    """对单个 Listing 的 variants JSON 计算全部维度的价差。"""
    if variants_json is None:
        return []
    rows: list[DeltaRow] = []
    for dim in variants_json:
        if not isinstance(dim, dict):
            continue
        raw_options = dim.get("options")
        if not isinstance(raw_options, list):
            continue
        options = [o for o in (option_from_json(x) for x in raw_options) if o is not None]
        rows.extend(compute_deltas(options))
    return rows
