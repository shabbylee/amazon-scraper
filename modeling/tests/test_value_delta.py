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


if __name__ == "__main__":
    unittest.main()
