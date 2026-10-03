"""Value Delta：配置向量拆解 + 单 Listing 价差计算。

职责（`.scratch/value-delta/spec.md`、`.scratch/value-delta-stratified/spec.md`）：
- parse_config：把变体配置文本拆成 {memory_gb, storage_gb}（笔记本语境）。
- compute_deltas：同一维度内，找出恰好一个配置维度变化的选项对，算价差，
  并标注该组的价格单调性置信。

本模块是纯函数，不碰 SQLite；DB 读取在 connect.py。
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

from modeling.clean import clean_label

# 笔记本常见内存容量（GB）与硬盘容量（GB）；过滤 recon 发现的脏值（7GB / 2GB）。
# 存储集含 64：Chromebook 的 eMMC 常见 64GB，真实库里有 `64 GB eMMC` / `N4120|64GB eMMC`。
VALID_MEMORY_GB = {4, 8, 16, 24, 32, 48, 64, 96, 128}
VALID_STORAGE_GB = {64, 128, 256, 512, 1000, 1024, 2000, 2048, 4000, 4096}

_TB_RE = re.compile(r"(\d+(?:\.\d+)?)\s*TB", re.IGNORECASE)
_GB_RE = re.compile(r"(\d+(?:\.\d+)?)\s*GB", re.IGNORECASE)
# 紧跟容量数字之后的词（跳过 "|"、"+"、"&" 等分隔符），决定它算内存还是存储。
_SUFFIX_WORD_RE = re.compile(r"[\s|+&,/·-]*([A-Za-z][A-Za-z0-9]*)")

_MEMORY_WORDS = frozenset(
    {"ram", "ddr", "ddr3", "ddr4", "ddr5", "sdram", "lpddr", "lpddr4", "lpddr5"}
)
_STORAGE_WORDS = frozenset(
    {"ssd", "hdd", "emmc", "ufs", "storage", "pcie", "nvme", "hard", "drive", "sd", "flash"}
)


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
    # 该变体组内"价格随配置量单调不减"是否成立。非单调说明混入异型号，
    # 组内任何配对都不足以归因于该维度，聚合默认剔除。
    monotonic: bool = True
    # 两端选项价格均值，供分层使用；任一端缺价时为 None。
    price_level: float | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def _suffix_kind(text: str, end: int) -> str:
    """容量数字后紧跟的词决定归类：memory / storage / unknown。"""
    match = _SUFFIX_WORD_RE.match(text, end)
    if not match:
        return "unknown"
    word = match.group(1).lower()
    if word in _MEMORY_WORDS:
        return "memory"
    if word in _STORAGE_WORDS:
        return "storage"
    return "unknown"


def _resolve_unclassified(
    value: float, memory_gb: float | None, storage_gb: float | None
) -> tuple[float | None, float | None]:
    """给不带后缀的容量数字消歧。

    已有另一侧做参照时直接补到缺失的一侧（如 `32GB|1TB` 已有存储 1000，
    剩下的 32 归内存）；两侧都空时用合法容量集判断，两边都合法则按内存（笔记本语境）。
    """
    if memory_gb is None and storage_gb is not None:
        return value, storage_gb
    if storage_gb is None and memory_gb is not None:
        return memory_gb, value
    if memory_gb is None and storage_gb is None:
        if value in VALID_MEMORY_GB and value not in VALID_STORAGE_GB:
            return value, None
        if value in VALID_STORAGE_GB and value not in VALID_MEMORY_GB:
            return None, value
        if value in VALID_MEMORY_GB:
            return value, None
    return memory_gb, storage_gb


def parse_config(label: str) -> dict[str, float]:
    """拆解笔记本配置文本为 {memory_gb, storage_gb}；解析失败/脏值不产出该键。

    先清洗（`clean_label`）再解析。容量归类的优先级：TB 一定是存储；
    `N GB` 后跟 RAM/DDR 之类的词是内存、跟 SSD/HDD/eMMC/Storage 之类的词是存储；
    不带后缀的容量按出现顺序与合法容量集消歧。两个以上未归类容量且两侧都空时，
    按 Amazon 的 `RAM|Storage` 惯例取前两个。
    """
    text = clean_label(label)
    if not text:
        return {}

    storage_gb: float | None = None
    memory_gb: float | None = None
    unclassified: list[float] = []

    tb = _TB_RE.search(text)
    if tb:
        storage_gb = float(tb.group(1)) * 1000

    for match in _GB_RE.finditer(text):
        value = float(match.group(1))
        kind = _suffix_kind(text, match.end())
        if kind == "memory":
            if memory_gb is None:
                memory_gb = value
        elif kind == "storage":
            if storage_gb is None:
                storage_gb = value
        else:
            unclassified.append(value)

    if len(unclassified) == 1:
        memory_gb, storage_gb = _resolve_unclassified(unclassified[0], memory_gb, storage_gb)
    elif len(unclassified) >= 2 and memory_gb is None and storage_gb is None:
        memory_gb, storage_gb = unclassified[0], unclassified[1]

    config: dict[str, float] = {}
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


def _group_is_monotonic(options: list[VariantOption], dimension: str) -> bool:
    """组内价格是否随该维度配置量单调不减。

    非单调意味着该变体维度混入了异型号（如 16GB 版本比 32GB 版本更贵），
    此时组内配对的价格差不能归因于该维度。缺价或不可购的选项不参与判断。
    """
    points: list[tuple[float, float]] = []
    for option in options:
        if option.price_num is None or option.unavailable:
            continue
        config = parse_config(option.label)
        if dimension not in config:
            continue
        points.append((config[dimension], option.price_num))
    if len(points) < 2:
        return True
    points.sort()
    return all(points[i + 1][1] >= points[i][1] for i in range(len(points) - 1))


def compute_deltas(options: list[VariantOption]) -> list[DeltaRow]:
    """同一维度内两两配对，输出单配置变化的价差行。"""
    rows: list[DeltaRow] = []
    for i, a in enumerate(options):
        for b in options[i + 1 :]:
            if a.unavailable or b.unavailable:
                continue
            if a.price_num is None or b.price_num is None:
                continue
            if a.currency and b.currency and a.currency != b.currency:
                continue
            delta = config_diff(parse_config(a.label), parse_config(b.label))
            if delta is None:
                continue
            dimension = next(iter(delta))
            rows.append(
                DeltaRow(
                    from_asin=a.asin,
                    to_asin=b.asin,
                    delta=delta,
                    price_delta=round(b.price_num - a.price_num, 2),
                    currency=b.currency or a.currency or "",
                    monotonic=_group_is_monotonic(options, dimension),
                    price_level=(a.price_num + b.price_num) / 2,
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
