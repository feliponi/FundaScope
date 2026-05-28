#!/usr/bin/env python3
"""
FundaScope — Admin market data update script.

Usage:
  python update_market_data.py --mode <mode> [--ticker <TICKER>]

Modes:
  prices        Update stock_prices for all tickers WHERE last_update IS NOT NULL
  fundamentals  Update stock_fundamentals for all tickers WHERE last_update IS NOT NULL
  all           Update prices + fundamentals WHERE last_update IS NOT NULL
  init          Full fetch (profile + fundamentals + price) WHERE last_update IS NULL,
                then set last_update = NOW() on success

Options:
  --ticker TICKER   Restrict to a single ticker (for testing)
"""

import argparse
import logging
import os
import random
import sys
import time
from datetime import datetime, timezone
from typing import Any, Optional

import yfinance as yf
from dotenv import load_dotenv
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("fundascope")

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    log.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PRICE_BATCH_SIZE = 50
INFO_DELAY_MIN = 1.5
INFO_DELAY_MAX = 3.0
MAX_RETRIES = 3
RETRY_DELAYS = [5, 10, 15]
FAILED_RETRY_PAUSE = 120
LOG_PROGRESS_EVERY = 50

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        return f if (f == f) else None  # NaN check
    except (TypeError, ValueError):
        return None


def safe_int(val: Any) -> Optional[int]:
    f = safe_float(val)
    return int(f) if f is not None else None


def get_tickers(mode: str, single_ticker: Optional[str]) -> list[str]:
    """Fetch ticker list from Supabase based on mode."""
    if single_ticker:
        return [single_ticker.upper()]

    if mode == "init":
        res = supabase.table("tickers").select("ticker").is_("last_update", "null").execute()
    else:
        res = supabase.table("tickers").select("ticker").not_.is_("last_update", "null").execute()

    return [r["ticker"] for r in (res.data or [])]


def retry_call(fn, *args, ticker: str = "", **kwargs) -> Any:
    """Call fn with retries and exponential backoff."""
    for attempt in range(MAX_RETRIES):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_DELAYS[attempt]
                log.warning("Attempt %d failed for %s: %s — retrying in %ds", attempt + 1, ticker, exc, delay)
                time.sleep(delay)
            else:
                raise
    return None


# ---------------------------------------------------------------------------
# Price updates
# ---------------------------------------------------------------------------

def update_prices(tickers: list[str]) -> list[str]:
    """Download closing prices in batches of PRICE_BATCH_SIZE. Returns failed tickers."""
    failed: list[str] = []

    for i in range(0, len(tickers), PRICE_BATCH_SIZE):
        batch = tickers[i : i + PRICE_BATCH_SIZE]
        log.info("Fetching prices batch %d/%d: %s…", i // PRICE_BATCH_SIZE + 1,
                 (len(tickers) + PRICE_BATCH_SIZE - 1) // PRICE_BATCH_SIZE, batch[:3])

        try:
            raw = retry_call(
                yf.download,
                batch,
                period="2d",
                auto_adjust=True,
                progress=False,
                group_by="ticker",
                ticker=",".join(batch),
            )
        except Exception as exc:
            log.error("Price batch %s failed: %s", batch, exc)
            failed.extend(batch)
            continue

        rows: list[dict] = []
        for tkr in batch:
            try:
                if len(batch) == 1:
                    close_series = raw["Close"]
                else:
                    close_series = raw[tkr]["Close"]

                close_series = close_series.dropna()
                if close_series.empty:
                    log.warning("No close price for %s", tkr)
                    failed.append(tkr)
                    continue

                price = float(close_series.iloc[-1])
                price_date = close_series.index[-1].date().isoformat()
                rows.append({
                    "ticker": tkr,
                    "price": price,
                    "price_date": price_date,
                    "updated_at": now_utc(),
                })
            except Exception as exc:
                log.warning("Could not extract price for %s: %s", tkr, exc)
                failed.append(tkr)

        if rows:
            try:
                supabase.table("stock_prices").upsert(rows, on_conflict="ticker").execute()
                log.info("Upserted prices for %d tickers", len(rows))
            except Exception as exc:
                log.error("Supabase write failed for prices batch: %s", exc)
                failed.extend([r["ticker"] for r in rows])

        if i + PRICE_BATCH_SIZE < len(tickers):
            time.sleep(random.uniform(0.5, 1.5))

    return failed


# ---------------------------------------------------------------------------
# Fundamentals & profile updates
# ---------------------------------------------------------------------------

def calc_earnings_growth_5y(ticker_obj: yf.Ticker) -> Optional[float]:
    """Compute 5-year earnings CAGR from annual net income."""
    try:
        financials = ticker_obj.financials  # columns = dates, rows = line items
        if financials is None or financials.empty:
            return None

        ni_row = None
        for label in ["Net Income", "Net Income Common Stockholders", "Net Income From Continuing Operations"]:
            if label in financials.index:
                ni_row = financials.loc[label].dropna()
                break

        if ni_row is None or len(ni_row) < 2:
            return None

        ni_sorted = ni_row.sort_index(ascending=True)
        n_periods = min(len(ni_sorted) - 1, 4)  # up to 4 years = 5 data points
        if n_periods < 1:
            return None

        start = float(ni_sorted.iloc[-(n_periods + 1)])
        end = float(ni_sorted.iloc[-1])

        if start <= 0 or end <= 0:
            return None

        cagr = (end / start) ** (1 / n_periods) - 1
        return cagr
    except Exception as exc:
        log.warning("Could not compute 5y earnings growth: %s", exc)
        return None


def fetch_info_with_retry(tkr: str) -> Optional[dict]:
    """Fetch yf.Ticker.info with retry/backoff."""
    t = yf.Ticker(tkr)
    for attempt in range(MAX_RETRIES):
        try:
            info = t.info
            if not info or info.get("regularMarketPrice") is None and info.get("currentPrice") is None:
                log.warning("Empty or incomplete info for %s", tkr)
            return info, t
        except Exception as exc:
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_DELAYS[attempt]
                log.warning("info attempt %d failed for %s: %s — retrying in %ds", attempt + 1, tkr, exc, delay)
                time.sleep(delay)
            else:
                log.error("All info attempts failed for %s: %s", tkr, exc)
                return None, None
    return None, None


def update_fundamentals_and_profiles(tickers: list[str], include_profile: bool = False) -> list[str]:
    """
    Fetch fundamentals (and optionally profile) via yf.Ticker.info one at a time.
    Returns failed tickers.
    """
    failed: list[str] = []

    for idx, tkr in enumerate(tickers, 1):
        if idx % LOG_PROGRESS_EVERY == 0:
            log.info("Progress: %d/%d tickers processed", idx, len(tickers))

        info, ticker_obj = fetch_info_with_retry(tkr)

        if info is None:
            failed.append(tkr)
            time.sleep(random.uniform(INFO_DELAY_MIN, INFO_DELAY_MAX))
            continue

        # ---- calculated fields ----
        dps_raw = safe_float(info.get("dividendYield"))
        price_raw = safe_float(info.get("regularMarketPrice") or info.get("currentPrice"))
        dps = (dps_raw * price_raw) if (dps_raw is not None and price_raw is not None) else None

        enterprise_value = safe_float(info.get("enterpriseValue"))
        ebit = safe_float(info.get("ebit"))
        ev_ebit: Optional[float] = None
        if enterprise_value is not None and ebit and ebit != 0:
            ev_ebit = enterprise_value / ebit

        total_debt = safe_float(info.get("totalDebt")) or 0.0
        total_cash = safe_float(info.get("totalCash")) or 0.0
        net_debt = total_debt - total_cash

        net_debt_ebit: Optional[float] = None
        if ebit and ebit != 0:
            net_debt_ebit = net_debt / ebit

        total_equity = safe_float(info.get("totalStockholderEquity"))
        roic: Optional[float] = None
        if ebit is not None and total_equity is not None:
            denom = total_equity + net_debt
            if denom != 0:
                roic = ebit / denom

        growth_5y = calc_earnings_growth_5y(ticker_obj) if ticker_obj else None

        # ---- fundamentals row ----
        fund_row: dict[str, Any] = {
            "ticker": tkr,
            # per-share
            "eps": safe_float(info.get("trailingEps")),
            "book_value_per_share": safe_float(info.get("bookValue")),
            "dps": dps,
            # valuation
            "pe": safe_float(info.get("trailingPE")),
            "pb": safe_float(info.get("priceToBook")),
            "peg": safe_float(info.get("pegRatio")),
            "ev_ebitda": safe_float(info.get("enterpriseToEbitda")),
            "ev_ebit": ev_ebit,
            "psr": safe_float(info.get("priceToSalesTrailing12Months")),
            # profitability
            "roe": safe_float(info.get("returnOnEquity")),
            "roa": safe_float(info.get("returnOnAssets")),
            "roic": roic,
            "gross_margin": safe_float(info.get("grossMargins")),
            "ebit_margin": safe_float(info.get("ebitdaMargins")),  # closest available
            "net_margin": safe_float(info.get("profitMargins")),
            # debt
            "debt_equity": safe_float(info.get("debtToEquity")),
            "current_ratio": safe_float(info.get("currentRatio")),
            "net_debt_ebit": net_debt_ebit,
            # dividends
            "dividend_yield": safe_float(info.get("dividendYield")),
            "payout_avg": safe_float(info.get("payoutRatio")),
            # growth
            "earnings_growth_5y": growth_5y,
            "revenue_growth_yoy": safe_float(info.get("revenueGrowth")),
            # size
            "market_cap": safe_int(info.get("marketCap")),
            "beta": safe_float(info.get("beta")),
            # meta
            "fundamentals_updated_at": now_utc(),
        }

        # ---- profile row (init mode only) ----
        profile_row: Optional[dict[str, Any]] = None
        if include_profile:
            profile_row = {
                "ticker": tkr,
                "company_name": info.get("longName") or info.get("shortName"),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
                "country": info.get("country"),
                "currency": info.get("currency"),
                "exchange": info.get("exchange"),
                "website": info.get("website"),
                "description": info.get("longBusinessSummary"),
                "profile_updated_at": now_utc(),
            }

        # ---- write to Supabase ----
        try:
            supabase.table("stock_fundamentals").upsert(fund_row, on_conflict="ticker").execute()
            if profile_row:
                supabase.table("stock_profiles").upsert(profile_row, on_conflict="ticker").execute()
        except Exception as exc:
            log.error("Supabase write failed for %s: %s", tkr, exc)
            failed.append(tkr)
            time.sleep(random.uniform(INFO_DELAY_MIN, INFO_DELAY_MAX))
            continue

        time.sleep(random.uniform(INFO_DELAY_MIN, INFO_DELAY_MAX))

    return failed


def mark_tickers_updated(tickers: list[str]) -> None:
    """Set last_update = NOW() for successfully processed tickers."""
    ts = now_utc()
    for tkr in tickers:
        try:
            supabase.table("tickers").update({"last_update": ts}).eq("ticker", tkr).execute()
        except Exception as exc:
            log.error("Could not update last_update for %s: %s", tkr, exc)


def retry_failed(failed: list[str], fn, **kwargs) -> list[str]:
    """After a pause, retry all failed tickers once."""
    if not failed:
        return []
    log.info("Waiting %ds before retrying %d failed tickers…", FAILED_RETRY_PAUSE, len(failed))
    time.sleep(FAILED_RETRY_PAUSE)
    log.info("Retrying: %s", failed)
    return fn(failed, **kwargs)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="FundaScope market data updater")
    parser.add_argument(
        "--mode",
        required=True,
        choices=["prices", "fundamentals", "all", "init"],
        help="Update mode",
    )
    parser.add_argument("--ticker", default=None, help="Restrict to a single ticker")
    args = parser.parse_args()

    mode: str = args.mode
    single_ticker: Optional[str] = args.ticker

    log.info("=== FundaScope update started | mode=%s ticker=%s ===", mode, single_ticker or "all")
    start_ts = time.time()

    tickers = get_tickers(mode, single_ticker)
    if not tickers:
        log.info("No tickers to process for mode=%s. Exiting.", mode)
        return

    log.info("Tickers to process: %d", len(tickers))

    all_failed: list[str] = []

    if mode == "prices":
        failed = update_prices(tickers)
        all_failed = retry_failed(failed, update_prices) if failed else []

    elif mode == "fundamentals":
        failed = update_fundamentals_and_profiles(tickers, include_profile=False)
        all_failed = retry_failed(failed, update_fundamentals_and_profiles, include_profile=False) if failed else []

    elif mode == "all":
        failed_p = update_prices(tickers)
        failed_f = update_fundamentals_and_profiles(tickers, include_profile=False)
        combined_failed = list(set(failed_p) | set(failed_f))
        all_failed = retry_failed(combined_failed, lambda t: list(set(update_prices(t)) | set(update_fundamentals_and_profiles(t, include_profile=False)))) if combined_failed else []

    elif mode == "init":
        failed_f = update_fundamentals_and_profiles(tickers, include_profile=True)
        failed_p = update_prices(tickers)

        # Mark successfully processed tickers
        succeeded = [t for t in tickers if t not in set(failed_f) | set(failed_p)]
        if succeeded:
            mark_tickers_updated(succeeded)
            log.info("Marked %d tickers as initialized", len(succeeded))

        combined_failed = list(set(failed_f) | set(failed_p))
        if combined_failed:
            log.info("Retrying %d failed init tickers…", len(combined_failed))
            time.sleep(FAILED_RETRY_PAUSE)
            rf = update_fundamentals_and_profiles(combined_failed, include_profile=True)
            rp = update_prices(combined_failed)
            retry_succeeded = [t for t in combined_failed if t not in set(rf) | set(rp)]
            if retry_succeeded:
                mark_tickers_updated(retry_succeeded)
                log.info("Marked %d retry tickers as initialized", len(retry_succeeded))
            all_failed = list(set(rf) | set(rp))
        else:
            all_failed = []

    elapsed = time.time() - start_ts
    log.info(
        "=== Done in %.1fs | processed=%d failed=%d ===",
        elapsed,
        len(tickers),
        len(all_failed),
    )
    if all_failed:
        log.warning("Still-failed tickers after retry: %s", all_failed)


if __name__ == "__main__":
    main()
