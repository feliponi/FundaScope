"""
Graham valuation calculations.
"""

from __future__ import annotations
import math


def graham_number(eps: float | None, bvps: float | None, factor: float = 22.5) -> float | None:
    """
    Graham Number = sqrt(factor × EPS_diluted × BookValuePerShare)

    Returns None when inputs are invalid (negative, zero, or missing).
    """
    if eps is None or bvps is None:
        return None
    if eps <= 0 or bvps <= 0:
        return None
    return math.sqrt(factor * eps * bvps)


def margin_of_safety(graham_val: float | None, current_price: float | None) -> float | None:
    """
    Margin of Safety = (graham_number - current_price) / graham_number × 100

    Returns percentage (e.g. 25.0 means 25%). Negative = overvalued vs. Graham.
    """
    if graham_val is None or current_price is None:
        return None
    if graham_val == 0:
        return None
    return (graham_val - current_price) / graham_val * 100


def intrinsic_value_dcf(
    fcf_per_share: float | None,
    growth_rate: float = 0.05,
    discount_rate: float = 0.10,
    terminal_growth: float = 0.03,
    years: int = 10,
) -> float | None:
    """
    Simple two-stage DCF — returns intrinsic value per share.
    Not exposed in the UI by default; available for future expansion.
    """
    if fcf_per_share is None or fcf_per_share <= 0:
        return None

    pv = 0.0
    for t in range(1, years + 1):
        cf = fcf_per_share * ((1 + growth_rate) ** t)
        pv += cf / ((1 + discount_rate) ** t)

    # Terminal value
    terminal_cf = fcf_per_share * ((1 + growth_rate) ** years) * (1 + terminal_growth)
    terminal_value = terminal_cf / (discount_rate - terminal_growth)
    pv += terminal_value / ((1 + discount_rate) ** years)

    return pv
