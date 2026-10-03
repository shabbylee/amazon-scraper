"""Value Delta 多 Listing 聚合：归一化 + 分组统计 + 分层。

职责（`.scratch/value-delta-multi/spec.md`、`.scratch/value-delta-stratified/spec.md`）：
- per_unit_observations：把 DeltaRow[] 归一化为 (dimension, currency) -> 每单位边际价样本。
- aggregate：分组统计，稳健统计量（中位数 / IQR / MAD）为主，`n >= 30` 时附正态近似 95% CI。
- stratify：按观测的价格水平分层的**能力**，每层样本量不足时整组不产出。

规模现实：当前语料的可归因配对天花板是两位数，分层在此之前没有统计意义，
因此 stratify 是门控的——宁可不产出，也不给「每层 2 个样本」的假分层。
纯函数、标准库 statistics、零新依赖。
"""

from __future__ import annotations

import math
import statistics
from dataclasses import asdict, dataclass

from modeling.value_delta import DeltaRow

# 样本量阈值：达到后才有足够依据用正态近似报 95% 置信区间。
CI_MIN_N = 30
# 分层阈值：每个价格段都要达到这个样本量，整组才产出分层。
STRATIFY_MIN_N = 30


@dataclass(frozen=True)
class AggregateRow:
    dimension: str
    currency: str
    n: int
    mean: float
    median: float
    std: float | None
    min: float
    max: float
    q1: float | None
    q3: float | None
    iqr: float | None
    mad: float | None
    ci95_low: float | None
    ci95_high: float | None
    # 因组内价格非单调（变体维度混入异型号）而被剔除的观测数。
    dropped_nonmonotonic: int = 0

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class StratumRow:
    dimension: str
    currency: str
    band: str
    cut: float
    n: int
    median: float
    q1: float
    q3: float
    mad: float

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def _usable_observations(
    rows: list[DeltaRow], require_monotonic: bool
) -> list[tuple[str, str, float, float | None]]:
    """展平成 (dimension, currency, per_unit, price_level)，附来源行判定。

    只保留商 > 0 的观测："升级却降价 / 降级却涨价"的反向对是促销或异型号噪声。
    """
    out: list[tuple[str, str, float, float | None]] = []
    for row in rows:
        if require_monotonic and not row.monotonic:
            continue
        for dim, change in row.delta.items():
            if change == 0:
                continue
            per_unit = row.price_delta / change
            if per_unit <= 0:
                continue
            out.append((dim, row.currency or "", per_unit, row.price_level))
    return out


def _unusable_counts(rows: list[DeltaRow]) -> dict[tuple[str, str], int]:
    """统计被单调性过滤挡掉的观测，按 (dimension, currency) 归集。"""
    counts: dict[tuple[str, str], int] = {}
    for row in rows:
        if row.monotonic:
            continue
        for dim, change in row.delta.items():
            if change == 0:
                continue
            if row.price_delta / change <= 0:
                continue
            key = (dim, row.currency or "")
            counts[key] = counts.get(key, 0) + 1
    return counts


def per_unit_observations(
    rows: list[DeltaRow], *, require_monotonic: bool = True
) -> dict[tuple[str, str], list[float]]:
    """把价差行归一化为 (dimension, currency) -> 每单位边际价样本。

    归一化：price_delta / change（带符号除法）。配置升级（change>0）且涨价、
    配置降级（change<0）且降价，两种正常视角的商都是正值，量纲统一为每单位边际价。
    currency 为空串的样本归到 "" 组，不丢弃、如实反映。
    """
    groups: dict[tuple[str, str], list[float]] = {}
    for dim, currency, per_unit, _level in _usable_observations(rows, require_monotonic):
        groups.setdefault((dim, currency), []).append(per_unit)
    return groups


def _quartiles(obs: list[float]) -> tuple[float | None, float | None, float | None]:
    """返回 (q1, q3, iqr)；样本少于 2 个时无意义，返回 None。"""
    if len(obs) < 2:
        return None, None, None
    q1, _q2, q3 = statistics.quantiles(obs, n=4)
    return q1, q3, q3 - q1


def _mad(obs: list[float]) -> float | None:
    """中位绝对偏差：比标准差更不受极端观测拉动。"""
    if len(obs) < 2:
        return None
    median = statistics.median(obs)
    return statistics.median([abs(x - median) for x in obs])


def aggregate(rows: list[DeltaRow], *, require_monotonic: bool = True) -> list[AggregateRow]:
    """跨 Listing 聚合统计，按 (dimension, currency) 分组排序输出。"""
    groups = per_unit_observations(rows, require_monotonic=require_monotonic)
    dropped = _unusable_counts(rows) if require_monotonic else {}
    out: list[AggregateRow] = []
    for dim, currency in sorted(groups, key=lambda k: (k[0], k[1])):
        obs = groups[(dim, currency)]
        n = len(obs)
        mean = statistics.fmean(obs)
        median = statistics.median(obs)
        std = statistics.stdev(obs) if n >= 2 else None
        q1, q3, iqr = _quartiles(obs)
        ci_low: float | None = None
        ci_high: float | None = None
        if n >= CI_MIN_N and std is not None:
            margin = 1.96 * std / math.sqrt(n)
            ci_low = mean - margin
            ci_high = mean + margin
        out.append(
            AggregateRow(
                dimension=dim,
                currency=currency,
                n=n,
                mean=mean,
                median=median,
                std=std,
                min=min(obs),
                max=max(obs),
                q1=q1,
                q3=q3,
                iqr=iqr,
                mad=_mad(obs),
                ci95_low=ci_low,
                ci95_high=ci_high,
                dropped_nonmonotonic=dropped.get((dim, currency), 0),
            )
        )
    return out


def stratify(
    rows: list[DeltaRow],
    *,
    min_n: int = STRATIFY_MIN_N,
    require_monotonic: bool = True,
) -> list[StratumRow]:
    """按观测的价格水平二分（低价段 / 高价段）产出分层统计。

    每个价格段都要达到 min_n 才产出；任一段不足则该 (dimension, currency)
    整组不产出。缺 price_level 的观测不参与分层。
    """
    bands: dict[tuple[str, str], list[tuple[float, float]]] = {}
    for dim, currency, per_unit, level in _usable_observations(rows, require_monotonic):
        if level is None:
            continue
        bands.setdefault((dim, currency), []).append((level, per_unit))

    out: list[StratumRow] = []
    for (dim, currency), obs in sorted(bands.items()):
        if len(obs) < 2 * min_n:
            continue
        cut = statistics.median([level for level, _ in obs])
        segments = (
            ("low", [pu for level, pu in obs if level <= cut]),
            ("high", [pu for level, pu in obs if level > cut]),
        )
        for band, segment in segments:
            if len(segment) < min_n:
                continue
            q1, q3, _iqr = _quartiles(segment)
            if q1 is None or q3 is None:
                continue
            mad = _mad(segment)
            if mad is None:
                continue
            out.append(
                StratumRow(
                    dimension=dim,
                    currency=currency,
                    band=band,
                    cut=cut,
                    n=len(segment),
                    median=statistics.median(segment),
                    q1=q1,
                    q3=q3,
                    mad=mad,
                )
            )
    return out
