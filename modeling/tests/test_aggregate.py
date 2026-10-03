import math
import statistics
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from modeling.aggregate import aggregate, per_unit_observations  # noqa: E402
from modeling.value_delta import DeltaRow  # noqa: E402


def row(dim: str, change: float, price_delta: float, currency: str = "CNY") -> DeltaRow:
    return DeltaRow(
        from_asin="A",
        to_asin="B",
        delta={dim: change},
        price_delta=price_delta,
        currency=currency,
    )


class PerUnitObservationsTest(unittest.TestCase):
    def test_normalizes_price_per_unit(self) -> None:
        obs = per_unit_observations(
            [row("memory_gb", 32.0, 7365.85)]
        )
        self.assertEqual(obs, {("memory_gb", "CNY"): [7365.85 / 32.0]})

    def test_downgrade_pair_normalizes_to_positive_unit(self) -> None:
        # 降级对（配置降低且降价）也应归一化为正的每单位边际价。
        obs = per_unit_observations(
            [row("memory_gb", -32.0, -7365.85)]
        )
        self.assertEqual(obs, {("memory_gb", "CNY"): [7365.85 / 32.0]})

    def test_reversed_direction_pairs_are_dropped(self) -> None:
        # 升级却降价、降级却涨价：促销/异型号噪声，归一化后为负，应过滤。
        obs = per_unit_observations(
            [
                row("memory_gb", 32.0, -100.0),
                row("memory_gb", -32.0, 100.0),
                row("storage_gb", 1000.0, 1000.0),
            ]
        )
        self.assertEqual(obs, {("storage_gb", "CNY"): [1.0]})

    def test_groups_by_dimension_and_currency(self) -> None:
        obs = per_unit_observations(
            [
                row("memory_gb", 32.0, 6400.0, "CNY"),
                row("memory_gb", 16.0, 3200.0, "USD"),
                row("storage_gb", 1000.0, 1000.0, "CNY"),
            ]
        )
        self.assertEqual(set(obs), {("memory_gb", "CNY"), ("memory_gb", "USD"), ("storage_gb", "CNY")})
        self.assertEqual(obs[("memory_gb", "CNY")], [200.0])
        self.assertEqual(obs[("memory_gb", "USD")], [200.0])

    def test_empty_currency_is_kept_as_empty_group(self) -> None:
        obs = per_unit_observations([row("memory_gb", 8.0, 800.0, "")])
        self.assertEqual(obs, {("memory_gb", ""): [100.0]})

    def test_zero_change_is_skipped_defensively(self) -> None:
        self.assertEqual(per_unit_observations([row("memory_gb", 0.0, 100.0)]), {})


class AggregateTest(unittest.TestCase):
    def test_descriptive_stats(self) -> None:
        rows = [
            row("memory_gb", 32.0, 32.0),
            row("memory_gb", 32.0, 64.0),
            row("memory_gb", 32.0, 96.0),
            row("memory_gb", 32.0, 128.0),
        ]
        result = aggregate(rows)
        self.assertEqual(len(result), 1)
        r = result[0]
        self.assertEqual(r.dimension, "memory_gb")
        self.assertEqual(r.currency, "CNY")
        self.assertEqual(r.n, 4)
        self.assertAlmostEqual(r.mean, statistics.fmean([1, 2, 3, 4]))
        self.assertAlmostEqual(r.median, statistics.median([1, 2, 3, 4]))
        self.assertIsNotNone(r.std)
        self.assertAlmostEqual(r.std, statistics.stdev([1, 2, 3, 4]))
        self.assertAlmostEqual(r.min, 1.0)
        self.assertAlmostEqual(r.max, 4.0)
        self.assertIsNone(r.ci95_low)
        self.assertIsNone(r.ci95_high)

    def test_n_below_30_has_no_ci(self) -> None:
        rows = [row("memory_gb", 32.0, 32.0) for _ in range(29)]
        r = aggregate(rows)[0]
        self.assertEqual(r.n, 29)
        self.assertIsNone(r.ci95_low)
        self.assertIsNone(r.ci95_high)

    def test_n_at_30_reports_normal_ci(self) -> None:
        rows = [row("storage_gb", 1000.0, 1000.0) for _ in range(30)]
        r = aggregate(rows)[0]
        self.assertEqual(r.n, 30)
        self.assertIsNotNone(r.ci95_low)
        self.assertIsNotNone(r.ci95_high)
        # 常量样本 std=0，区间退化为均值点。
        self.assertAlmostEqual(r.ci95_low, 1.0)
        self.assertAlmostEqual(r.ci95_high, 1.0)

    def test_single_observation_has_no_std_or_ci(self) -> None:
        r = aggregate([row("memory_gb", 32.0, 6400.0)])[0]
        self.assertEqual(r.n, 1)
        self.assertIsNone(r.std)
        self.assertIsNone(r.ci95_low)
        self.assertAlmostEqual(r.mean, 200.0)
        self.assertAlmostEqual(r.median, 200.0)


if __name__ == "__main__":
    unittest.main()
