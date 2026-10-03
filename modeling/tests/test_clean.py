import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from modeling.clean import clean_label  # noqa: E402


class CleanLabelTest(unittest.TestCase):
    def test_css_rule_block_and_price_text_are_removed(self) -> None:
        # 真实库形态：<li> 内 <style> 的 CSS 规则体 + 价格区块文本被 textContent 吸入。
        raw = (
            ".centralizedApexPriceSavingsOverrides { color: var(--deal-savings-color, #CC0C39)"
            "!important; font-weight: 300!important; } "
            ".centralizedApexPriceSavingsPercentageMargin, .centralizedApexPricePriceToPayMargin"
            " { margin-right: 3px; } CNY 1,742.50 with 41 percent savingsCNY1,742.50"
            "CNY2,948.90CNY2,948.90 In Stock"
        )
        self.assertEqual(clean_label(raw), "")

    def test_css_comment_is_removed(self) -> None:
        self.assertEqual(clean_label("/* Temporary CSS overrides for savings. */ Black"), "Black")

    def test_price_suffix_is_stripped_from_config(self) -> None:
        raw = (
            "N4120|64GB eMMC .centralizedApexPriceSavingsOverrides"
            " { color: var(--deal-savings-color, #CC0C39)!important; } CNY 1,534.80 In Stock"
        )
        self.assertEqual(clean_label(raw), "N4120|64GB eMMC")

    def test_stock_and_delivery_status_text_is_removed(self) -> None:
        self.assertEqual(clean_label("16 GB See available options"), "16 GB")
        self.assertEqual(clean_label("10GB Currently unavailable."), "10GB")
        self.assertEqual(
            clean_label(
                "8 GB This item cannot be shipped to your selected delivery location. "
                "Please choose a different delivery location."
            ),
            "8 GB",
        )

    def test_compact_and_clean_configs_pass_through(self) -> None:
        self.assertEqual(clean_label("16GB|512GB"), "16GB|512GB")
        self.assertEqual(clean_label("32GB DDR5 RAM,1TB PCIe SSD"), "32GB DDR5 RAM,1TB PCIe SSD")
        self.assertEqual(clean_label("Core 7 240H | 16GB+1TB"), "Core 7 240H | 16GB+1TB")

    def test_empty_input(self) -> None:
        self.assertEqual(clean_label(""), "")
        self.assertEqual(clean_label("   "), "")


if __name__ == "__main__":
    unittest.main()
