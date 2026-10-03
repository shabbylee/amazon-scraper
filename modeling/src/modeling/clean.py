"""脏 label 清洗：剥掉 CSS、价格与库存状态噪声（纯函数）。

上游侦察（.scratch/value-delta-stratified/spec.md，D3）发现：浏览器侧取 `<li>` 的全量
`textContent`，把 `<li>` 内 `<style>` 标签的 CSS 规则体、价格区块文本、库存状态文本
一并吸进 label。本模块在解析配置向量前把这些噪声剥掉；采集层
（`src/parser/detail-page.ts`）同样做了源头修复，两层是纵深防御关系。
"""

from __future__ import annotations

import re

_CSS_COMMENT = re.compile(r"/\*.*?\*/", re.S)
# CSS 规则块：选择器必须以 . # @ 开头（类 / ID / at-rule），再跟声明体。
# 选择器前缀不可选，否则 `N4120|64GB eMMC { ... }` 这类普通文本会被整段吞掉。
_CSS_RULE = re.compile(r"[.#@][\w-]*[^{}]*\{[^{}]*\}")
# 裸声明残留：color: var(--x)!important;
_CSS_DECL = re.compile(r"[\w-]+\s*:\s*var\([^)]*\)\s*!?\s*important\s*;?")
_PRICE = re.compile(
    r"(?:CNY|US\$|USD|EUR|GBP|JPY|AUD|CAD|\$|€|£|JP¥|¥)\s*[\d,]+(?:\.\d+)?",
    re.IGNORECASE,
)

_NOISE_PATTERNS = (
    r"\d+\s*个选项",
    r"起始价\s*[：:]?",
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
_NOISE = tuple(re.compile(p, re.IGNORECASE) for p in _NOISE_PATTERNS)

_TRIM_CHARS = " |,;:-·"


def clean_label(raw: str) -> str:
    """剥离 CSS / 价格 / 库存状态噪声，返回空白规范化后的配置文本。

    只做清洗不做解析：清洗结果既供 `parse_config` 使用，也用于人工核对。
    """
    if not raw:
        return ""
    text = _CSS_COMMENT.sub(" ", raw)
    text = _CSS_RULE.sub(" ", text)
    text = _CSS_DECL.sub(" ", text)
    text = _PRICE.sub(" ", text)
    for pattern in _NOISE:
        text = pattern.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip(_TRIM_CHARS)
