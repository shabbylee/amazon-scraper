import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from modeling.value_delta import (  # noqa: E402
    VariantOption,
    compute_deltas,
    compute_listing_deltas,
    parse_config,
)


def opt(asin: str, label: str, price: float | None, currency: str | None = "CNY") -> VariantOption:
    return VariantOption(
        asin=asin,
        label=label,
        price_num=price,
        currency=currency,
        unavailable=False,
    )


class ParseConfigTest(unittest.TestCase):
    def test_combined_set_name(self) -> None:
        self.assertEqual(
            parse_config("32GB DDR5 RAM,1TB PCIe SSD"),
            {"memory_gb": 32.0, "storage_gb": 1000.0},
        )
        self.assertEqual(
            parse_config("64GB DDR5 RAM,2TB PCIe SSD"),
            {"memory_gb": 64.0, "storage_gb": 2000.0},
        )

    def test_standalone_dimensions(self) -> None:
        self.assertEqual(parse_config("16GB"), {"memory_gb": 16.0})
        self.assertEqual(parse_config("512GB SSD"), {"storage_gb": 512.0})
        self.assertEqual(parse_config("1TB SSD"), {"storage_gb": 1000.0})

    def test_dirty_values_are_dropped(self) -> None:
        self.assertEqual(parse_config("7GB"), {})
        self.assertEqual(parse_config("2GB"), {})

    def test_storage_suffix_without_ssd_keyword(self) -> None:
        # `128GB Storage` 曾被兜底正则误判为 memory_gb=128。
        self.assertEqual(parse_config("128GB Storage"), {"storage_gb": 128.0})

    def test_nonstandard_storage_capacity_is_dropped_conservatively(self) -> None:
        # 384/640 不是标准容量，宁可丢存储也不猜。两个选项都只剩内存时配置相同，
        # 配对会被判为「无变化」而跳过，不会产出假观测。
        self.assertEqual(parse_config("4GB RAM | 384GB Storage"), {"memory_gb": 4.0})

    def test_compact_ram_storage_pair_keeps_both_dimensions(self) -> None:
        # `32GB|1TB` 曾被 TB 正则先认走存储，内存被静默丢弃，使「内存+存储同变」
        # 退化成纯存储变化，产出污染的 3.35 CNY/GB。
        self.assertEqual(parse_config("32GB|1TB"), {"memory_gb": 32.0, "storage_gb": 1000.0})
        self.assertEqual(parse_config("64GB|2TB"), {"memory_gb": 64.0, "storage_gb": 2000.0})
        self.assertEqual(parse_config("16GB|512GB"), {"memory_gb": 16.0, "storage_gb": 512.0})

    def test_spaced_config_with_emmc(self) -> None:
        self.assertEqual(
            parse_config("14 inch | 4 GB | 64 GB eMMC"),
            {"memory_gb": 4.0, "storage_gb": 64.0},
        )

    def test_cpu_prefixed_config(self) -> None:
        self.assertEqual(
            parse_config("Core 7 240H | 16GB+1TB"),
            {"memory_gb": 16.0, "storage_gb": 1000.0},
        )
        self.assertEqual(parse_config("N4120|64GB eMMC"), {"storage_gb": 64.0})

    def test_storage_only_label_with_accessory_suffix(self) -> None:
        self.assertEqual(parse_config("256GB | Magic Keyboard"), {"storage_gb": 256.0})


class ComputeDeltasTest(unittest.TestCase):
    def test_hp_pavilion_three_variants(self) -> None:
        options = [
            opt("A1", "32GB DDR5 RAM,1TB PCIe SSD", 7372.27),
            opt("A2", "64GB DDR5 RAM,1TB PCIe SSD", 14738.12),
            opt("A3", "64GB DDR5 RAM,2TB PCIe SSD", 16078.55),
        ]
        rows = compute_deltas(options)
        self.assertEqual(len(rows), 2)

        memory_row = next(r for r in rows if "memory_gb" in r.delta)
        self.assertEqual(memory_row.from_asin, "A1")
        self.assertEqual(memory_row.to_asin, "A2")
        self.assertEqual(memory_row.delta, {"memory_gb": 32.0})
        self.assertEqual(memory_row.price_delta, 7365.85)

        storage_row = next(r for r in rows if "storage_gb" in r.delta)
        self.assertEqual(storage_row.from_asin, "A2")
        self.assertEqual(storage_row.to_asin, "A3")
        self.assertEqual(storage_row.delta, {"storage_gb": 1000.0})
        self.assertEqual(storage_row.price_delta, 1340.43)

    def test_multi_dimension_change_is_not_paired(self) -> None:
        options = [
            opt("A1", "32GB DDR5 RAM,1TB PCIe SSD", 1000.0),
            opt("A2", "64GB DDR5 RAM,2TB PCIe SSD", 2000.0),
        ]
        self.assertEqual(compute_deltas(options), [])

    def test_missing_price_or_currency_mismatch_skipped(self) -> None:
        options = [
            opt("A1", "32GB DDR5 RAM,1TB PCIe SSD", None),
            opt("A2", "64GB DDR5 RAM,1TB PCIe SSD", 2000.0, "USD"),
            opt("A3", "64GB DDR5 RAM,1TB PCIe SSD", 3000.0, "CNY"),
        ]
        self.assertEqual(compute_deltas(options), [])


class ComputeListingDeltasTest(unittest.TestCase):
    def test_json_contract(self) -> None:
        variants = [
            {
                "name": "set_name",
                "title": "大小: 32GB DDR5 RAM | 1TB PCIe SSD",
                "options": [
                    {
                        "asin": "A1",
                        "label": "32GB DDR5 RAM,1TB PCIe SSD",
                        "priceText": "CNY 7,372.27",
                        "priceNum": 7372.27,
                        "currency": "CNY",
                        "unavailable": False,
                    },
                    {
                        "asin": "A2",
                        "label": "64GB DDR5 RAM,1TB PCIe SSD",
                        "priceText": "CNY 14,738.12",
                        "priceNum": 14738.12,
                        "currency": "CNY",
                        "unavailable": False,
                    },
                ],
            }
        ]
        rows = compute_listing_deltas(variants)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].delta, {"memory_gb": 32.0})
        self.assertEqual(rows[0].price_delta, 7365.85)

    def test_legacy_string_array_is_tolerated(self) -> None:
        self.assertEqual(compute_listing_deltas(["old", "shape"]), [])
        self.assertEqual(compute_listing_deltas(None), [])
        self.assertEqual(compute_listing_deltas([{"name": "x", "options": "bad"}]), [])


class GroupMonotonicityTest(unittest.TestCase):
    def test_monotonic_group_is_trusted(self) -> None:
        options = [
            opt("A1", "8GB RAM", 3000.0),
            opt("A2", "16GB RAM", 4000.0),
            opt("A3", "32GB RAM", 6000.0),
        ]
        rows = compute_deltas(options)
        self.assertTrue(rows)
        self.assertTrue(all(r.monotonic for r in rows))

    def test_nonmonotonic_group_is_flagged(self) -> None:
        # 真实库形态（B0HJTT6HP8）：16GB 版本比 32GB 版本更贵，说明该维度混入异型号。
        options = [
            opt("A1", "8GB RAM", 3351.03),
            opt("A2", "16GB RAM", 3887.20),
            opt("A3", "32GB RAM", 3686.00),
        ]
        rows = compute_deltas(options)
        self.assertTrue(rows)
        self.assertTrue(all(not r.monotonic for r in rows))

    def test_unavailable_options_do_not_pair(self) -> None:
        options = [
            opt("A1", "16GB RAM", 1000.0),
            VariantOption("A2", "32GB RAM", 2000.0, "CNY", True),
        ]
        self.assertEqual(compute_deltas(options), [])

    def test_price_level_is_pair_mean(self) -> None:
        options = [opt("A1", "16GB RAM", 1000.0), opt("A2", "32GB RAM", 2000.0)]
        rows = compute_deltas(options)
        self.assertEqual(rows[0].price_level, 1500.0)


if __name__ == "__main__":
    unittest.main()
