"""
Number formatting helpers for KPI display.
"""

from __future__ import annotations
from typing import Any


def format_value(value: Any, fmt: str) -> str:
    """
    Format a numeric value according to the KPI format string.

    fmt codes:
        "2f"  → 2-decimal float  (e.g. 12.34)
        "2p"  → percent with 2 decimals (e.g. 5.67%)
        "0f"  → integer (e.g. 7)
        "$2f" → dollar with 2 decimals (e.g. $12.34)
    """
    if value is None or (isinstance(value, float) and value != value):  # NaN check
        return "—"

    try:
        num = float(value)
    except (TypeError, ValueError):
        return "—"

    if fmt == "2f":
        return f"{num:,.2f}"
    elif fmt == "2p":
        return f"{num:.2f}%"
    elif fmt == "0f":
        return f"{int(round(num)):,}"
    elif fmt == "$2f":
        return f"${num:,.2f}"
    else:
        return str(value)


def format_market_cap(value: Any) -> str:
    """Human-readable market cap: $1.23B, $456M, etc."""
    if value is None:
        return "—"
    try:
        num = float(value)
    except (TypeError, ValueError):
        return "—"

    if abs(num) >= 1e12:
        return f"${num/1e12:.2f}T"
    elif abs(num) >= 1e9:
        return f"${num/1e9:.2f}B"
    elif abs(num) >= 1e6:
        return f"${num/1e6:.2f}M"
    elif abs(num) >= 1e3:
        return f"${num/1e3:.2f}K"
    else:
        return f"${num:.2f}"


def color_cell(value: Any, rule: dict) -> str:
    """
    Return a CSS color string given a value and a rule dict:
        {"green": (min_threshold, max_threshold), "red": (min_threshold, max_threshold)}
    Thresholds can be None (no bound).
    """
    if value is None:
        return ""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return ""

    def _matches(num: float, bounds: tuple) -> bool:
        lo, hi = bounds
        if lo is not None and num < lo:
            return False
        if hi is not None and num > hi:
            return False
        return True

    if "green" in rule and _matches(num, rule["green"]):
        return "color: #22c55e; font-weight: bold"
    if "red" in rule and _matches(num, rule["red"]):
        return "color: #ef4444; font-weight: bold"
    return ""
