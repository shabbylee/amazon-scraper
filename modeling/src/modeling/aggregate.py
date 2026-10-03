"""Value Delta 多 Listing 聚合：归一化 + 分组统计。

职责（.scratch/value-delta-multi/spec.md）：
- per_unit_observations：把 DeltaRow[] 归一化为 (dimension, currency) -> 每单位边际价样本。
- aggregate：按 (dimension, currency) 分组统计 n/mean/median/std/min/max，
  n >= 30 时附正态近似 95% CI。
纯函数、标准库 statistics、零新依赖。
"""

from __future__ import annotations

import math
import statistics
from dataclasses import asdict, dataclass

from modeling.value_delta import DeltaRow

# 样本量阈值：达到后才有足够依据用正态近似报 95% 置信区间。
CI_MIN_N = 30


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
    ci95_low: float | None
    ci95_high: float | None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def per_unit_observations(
    rows: list[DeltaRow],
) -> dict[tuple[str, str], list[float]]:
    """把价差行归一化为 (dimension, currency) -> 每单位边际价样本。

    归一化：price_delta / change（带符号除法）。配置升级（change>0）且涨价、
    配置降级（change<0）且降价，两种正常视角的商都是正值，量纲统一为每单位边际价。
    只保留商 > 0 的观测；"升级却降价 / 降级却涨价"的反向对是促销或异型号噪声，
    归一化后商为负，在此过滤。change == 0 防御性跳过（正常不会出现）。
    currency 为空串的样本归到 "" 组，不丢弃、如实反映。
    """
    groups: dict[tuple[str, str], list[float]] = {}
    for row in rows:
        for dim, change in row.delta.items():
            if change == 0:
                continue
            per_unit = row.price_delta / change
            if per_unit <= 0:
                continue
            currency = row.currency or ""
            groups.setdefault((dim, currency), []).append(per_unit)
    return groups


def aggregate(rows: list[DeltaRow]) -> list[AggregateRow]:
    """跨 Listing 聚合统计，按 (dimension, currency) 分组排序输出。"""
    groups = per_unit_observations(rows)
    out: list[AggregateRow] = []
    for dim, currency in sorted(groups, key=lambda k: (k[0], k[1])):
        obs = groups[(dim, currency)]
        n = len(obs)
        mean = statistics.fmean(obs)
        median = statistics.median(obs)
        std = statistics.stdev(obs) if n >= 2 else None
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
                ci95_low=ci_low,
                ci95_high=ci_high,
            )
        )
    return out
