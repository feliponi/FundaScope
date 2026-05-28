#!/usr/bin/env python3
"""
FundaScope — Admin market data update script.

Usage:
  python update_market_data.py --mode <mode> [--ticker <TICKER>]

Modes:
  seed          Insert one or more tickers into the DB.
                Must be run before init for new tickers.
                Example (comma-separated): python update_market_data.py --mode seed --ticker AAPL,MSFT,PETR4.SA
                Example (CSV file):        python update_market_data.py --mode seed --csv tickers.csv

  init          Full fetch (profile + fundamentals + price) WHERE last_update IS NULL,
                then set last_update = NOW() on success.
                If --ticker is given and not yet in the DB it is auto-inserted first.

  prices        Update stock_prices for all tickers WHERE last_update IS NOT NULL
  fundamentals  Update stock_fundamentals for all tickers WHERE last_update IS NOT NULL
  all           Update prices + fundamentals WHERE last_update IS NOT NULL

Options:
  --ticker TICKER[,TICKER,...]
      seed mode  → comma-separated list of tickers to insert
      other modes → restrict processing to a single ticker (for testing)

Typical workflow for a fresh setup:
  1. python update_market_data.py --mode seed --csv tickers.csv
  2. python update_market_data.py --mode init
  3. (daily)     python update_market_data.py --mode prices
  4. (quarterly) python update_market_data.py --mode fundamentals
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


def today_utc() -> str:
    return datetime.now(timezone.utc).date().isoformat()


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
        tkr = single_ticker.strip().upper()
        # For init, auto-insert the ticker if it doesn't exist yet
        if mode == "init":
            try:
                supabase.table("tickers").insert(
                    {"ticker": tkr, "last_update": None}
                ).execute()
                log.info("Auto-inserted ticker %s into tickers table", tkr)
            except Exception:
                pass  # already exists — that's fine
        return [tkr]

    if mode == "init":
        res = supabase.table("tickers").select("ticker").is_("last_update", "null").execute()
    else:
        res = supabase.table("tickers").select("ticker").not_.is_("last_update", "null").execute()

    log.debug("get_tickers raw response: %s", res.data)
    return [r["ticker"] for r in (res.data or [])]


def seed_tickers(ticker_arg: Optional[str], csv_path: Optional[str]) -> None:
    """Insert tickers with last_update=NULL so init can pick them up."""
    tickers_to_seed: list[str] = []

    if csv_path:
        import csv as csv_mod
        try:
            with open(csv_path, newline="", encoding="utf-8") as fh:
                reader = csv_mod.DictReader(fh)
                if "ticker" not in (reader.fieldnames or []):
                    log.error("CSV file must have a 'ticker' column header.")
                    sys.exit(1)
                tickers_to_seed.extend(
                    row["ticker"].strip().upper()
                    for row in reader
                    if row.get("ticker", "").strip()
                )
        except FileNotFoundError:
            log.error("CSV file not found: %s", csv_path)
            sys.exit(1)

    if ticker_arg:
        tickers_to_seed.extend(
            t.strip().upper() for t in ticker_arg.split(",") if t.strip()
        )

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for t in tickers_to_seed:
        if t not in seen:
            seen.add(t)
            unique.append(t)
    tickers_to_seed = unique

    if not tickers_to_seed:
        log.error("No tickers to seed. Use --ticker AAPL,MSFT or --csv tickers.csv")
        sys.exit(1)

    log.info("Seeding %d ticker(s)…", len(tickers_to_seed))

    inserted: list[str] = []
    skipped: list[str] = []

    for tkr in tickers_to_seed:
        try:
            supabase.table("tickers").insert({"ticker": tkr, "last_update": None}).execute()
            inserted.append(tkr)
            log.info("Inserted: %s", tkr)
        except Exception as exc:
            msg = str(exc).lower()
            if "duplicate" in msg or "23505" in msg or "unique" in msg:
                log.info("Already exists (skipped): %s", tkr)
                skipped.append(tkr)
            else:
                log.error("Failed to insert %s: %s", tkr, exc)
                skipped.append(tkr)

    log.info("=== Seed done | inserted=%d skipped=%d ===", len(inserted), len(skipped))
    if inserted:
        log.info("Next step: python update_market_data.py --mode init")


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
# Price alert checking  (Feature 1)
# ---------------------------------------------------------------------------

def check_and_trigger_alerts(ticker_prices: dict[str, float]) -> None:
    """Check price_alerts for each ticker and trigger any that crossed their threshold."""
    if not ticker_prices:
        return

    tickers_list = list(ticker_prices.keys())

    try:
        res = (
            supabase.table("price_alerts")
            .select("id, user_id, ticker, target_price, direction")
            .eq("is_active", True)
            .in_("ticker", tickers_list)
            .execute()
        )
        alerts = res.data or []
        if not alerts:
            return

        triggered_inserts: list[dict] = []
        alert_ids_to_deactivate: list[str] = []

        for alert in alerts:
            ticker = alert["ticker"]
            new_price = ticker_prices.get(ticker)
            if new_price is None:
                continue

            target = float(alert["target_price"])
            direction = alert["direction"]

            triggered = (
                (direction == "above" and new_price >= target) or
                (direction == "below" and new_price <= target)
            )
            if not triggered:
                continue

            triggered_inserts.append({
                "user_id": alert["user_id"],
                "ticker": ticker,
                "target_price": target,
                "triggered_price": new_price,
                "direction": direction,
                "triggered_at": now_utc(),
            })
            alert_ids_to_deactivate.append(alert["id"])
            log.info(
                "ALERT TRIGGERED: %s | user=%s | target=%s | actual=%.4f | direction=%s",
                ticker, alert["user_id"], target, new_price, direction,
            )

        if triggered_inserts:
            supabase.table("alerts_triggered").insert(triggered_inserts).execute()

        for alert_id in alert_ids_to_deactivate:
            supabase.table("price_alerts").update({"is_active": False}).eq("id", alert_id).execute()

    except Exception as exc:
        log.error("Alert checking failed: %s", exc)


# ---------------------------------------------------------------------------
# Portfolio snapshots  (Feature 3)
# ---------------------------------------------------------------------------

def take_portfolio_snapshots() -> None:
    """Snapshot every user's total portfolio value and cost for today."""
    today = today_utc()

    try:
        port_res = supabase.table("portfolios").select("user_id, ticker, quantity, avg_price").execute()
        portfolios = port_res.data or []

        if not portfolios:
            log.info("SNAPSHOT: no portfolios found, skipping")
            return

        tickers_needed = list({p["ticker"] for p in portfolios})
        price_res = (
            supabase.table("stock_prices")
            .select("ticker, price")
            .in_("ticker", tickers_needed)
            .execute()
        )
        price_map: dict[str, float] = {
            r["ticker"]: float(r["price"])
            for r in (price_res.data or [])
            if r["price"] is not None
        }

        user_totals: dict[str, dict[str, float]] = {}
        for p in portfolios:
            uid = p["user_id"]
            ticker = p["ticker"]
            qty = float(p["quantity"])
            avg = float(p["avg_price"])

            if ticker not in price_map:
                log.warning("SNAPSHOT: no price for %s (user=%s), skipping position", ticker, uid)
                continue

            cur_price = price_map[ticker]
            if uid not in user_totals:
                user_totals[uid] = {"total_value": 0.0, "total_cost": 0.0}
            user_totals[uid]["total_value"] += qty * cur_price
            user_totals[uid]["total_cost"] += qty * avg

        for uid, totals in user_totals.items():
            supabase.table("portfolio_snapshots").upsert(
                {
                    "user_id": uid,
                    "total_value": totals["total_value"],
                    "total_cost": totals["total_cost"],
                    "snapshot_date": today,
                },
                on_conflict="user_id,snapshot_date",
            ).execute()

        log.info("SNAPSHOT: %d portfolio snapshots saved for %s", len(user_totals), today)

    except Exception as exc:
        log.error("Portfolio snapshot failed: %s", exc)


# ---------------------------------------------------------------------------
# Price updates
# ---------------------------------------------------------------------------

def _extract_close(raw, ticker: str, is_single: bool):
    """Return the Close price Series for *ticker* from a yf.download result.

    yfinance's DataFrame structure varies by version and by whether one or
    multiple tickers were requested:

    - Single ticker (any version):  raw["Close"]             → Series
    - Multi-ticker, no group_by:    raw["Close"][ticker]     → Series
    - Multi-ticker, group_by=ticker: raw[ticker]["Close"]    → Series
    - New yfinance MultiIndex:      raw[("Close", ticker)]   → Series

    We try each in order and return the first that works.
    """
    import pandas as pd

    attempts = []
    if is_single:
        attempts.append(lambda: raw["Close"])
    attempts += [
        lambda: raw["Close"][ticker],          # multi, no group_by (most common)
        lambda: raw[ticker]["Close"],           # multi, group_by="ticker"
        lambda: raw[("Close", ticker)],         # MultiIndex tuple key
    ]

    for attempt in attempts:
        try:
            result = attempt()
            if isinstance(result, pd.Series):
                return result
        except (KeyError, TypeError):
            continue

    return None


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
                period="5d",   # 5d gives more fallback days for holidays/weekends
                auto_adjust=True,
                progress=False,
            )
        except Exception as exc:
            log.error("Price batch %s failed: %s", batch, exc)
            failed.extend(batch)
            continue

        rows: list[dict] = []
        for tkr in batch:
            try:
                close_series = _extract_close(raw, tkr, len(batch) == 1)
                if close_series is None:
                    log.warning("No close price for %s (unrecognised DataFrame structure)", tkr)
                    failed.append(tkr)
                    continue

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

                # Check price alerts for every ticker whose price was just updated
                ticker_price_map = {r["ticker"]: r["price"] for r in rows}
                check_and_trigger_alerts(ticker_price_map)

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
    """Compute 5-year earnings CAGR from annual net income.

    Requires at least 3 annual data points (2 intervals) to avoid inflated
    CAGR from a single-year jump (e.g. post-COVID earnings recovery).
    """
    try:
        financials = ticker_obj.financials  # columns = dates, rows = line items
        if financials is None or financials.empty:
            return None

        ni_row = None
        for label in ["Net Income", "Net Income Common Stockholders", "Net Income From Continuing Operations"]:
            if label in financials.index:
                ni_row = financials.loc[label].dropna()
                break

        if ni_row is None or len(ni_row) < 3:          # need ≥ 3 points → ≥ 2 intervals
            return None

        ni_sorted = ni_row.sort_index(ascending=True)
        n_periods = min(len(ni_sorted) - 1, 4)         # up to 4 years = 5 data points
        if n_periods < 2:                               # enforce minimum of 2 intervals
            return None

        start = float(ni_sorted.iloc[-(n_periods + 1)])
        end = float(ni_sorted.iloc[-1])

        if start <= 0 or end <= 0:
            return None

        cagr = (end / start) ** (1 / n_periods) - 1

        # Log unusually high values for visibility, but store them — the frontend
        # Graham formula caps g at 25% internally to prevent absurd fair-value outputs.
        # High-growth tech stocks (TTD, CRM, etc.) can have real CAGRs above 100%.
        if cagr > 1.0:
            log.info("High earnings CAGR (%.1f%%) for %s — storing as-is",
                     cagr * 100, getattr(ticker_obj, "ticker", "?"))

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
        # yfinance returns dividendYield as a percentage value (e.g. 0.62 for 0.62%),
        # NOT as a decimal fraction (which would be 0.0062). Divide by 100 to normalise
        # before storing so all downstream code treats it as a decimal (0.0062 = 0.62%).
        dy_raw = safe_float(info.get("dividendYield"))
        dy_decimal: Optional[float] = None
        if dy_raw is not None:
            dy_decimal = dy_raw / 100.0
            if dy_decimal > 1.0:  # sanity: > 100 % DY is impossible, discard
                log.warning("Absurd dividend yield (%.1f%%) for %s — discarding", dy_raw, tkr)
                dy_decimal = None

        price_raw = safe_float(info.get("regularMarketPrice") or info.get("currentPrice"))
        # DPS = annual dividend per share = (yield as decimal) × price
        dps = (dy_decimal * price_raw) if (dy_decimal is not None and price_raw is not None) else None

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
            # dividends — stored as decimal fraction (0.0062 = 0.62%); see dy_decimal above
            "dividend_yield": dy_decimal,
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
        choices=["seed", "init", "prices", "fundamentals", "all"],
        help="Update mode",
    )
    parser.add_argument(
        "--ticker",
        default=None,
        help=(
            "seed mode: comma-separated list of tickers to insert (e.g. AAPL,MSFT,PETR4.SA). "
            "Other modes: single ticker to restrict processing to (for testing)."
        ),
    )
    parser.add_argument(
        "--csv",
        default=None,
        metavar="FILE",
        help="seed mode only: path to a CSV file with a 'ticker' column to bulk-insert.",
    )
    args = parser.parse_args()

    mode: str = args.mode
    single_ticker: Optional[str] = args.ticker
    csv_file: Optional[str] = args.csv

    if mode == "seed":
        seed_tickers(single_ticker, csv_file)
        return

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
        take_portfolio_snapshots()

    elif mode == "fundamentals":
        failed = update_fundamentals_and_profiles(tickers, include_profile=False)
        all_failed = retry_failed(failed, update_fundamentals_and_profiles, include_profile=False) if failed else []

    elif mode == "all":
        failed_p = update_prices(tickers)
        failed_f = update_fundamentals_and_profiles(tickers, include_profile=False)
        combined_failed = list(set(failed_p) | set(failed_f))
        all_failed = retry_failed(combined_failed, lambda t: list(set(update_prices(t)) | set(update_fundamentals_and_profiles(t, include_profile=False)))) if combined_failed else []
        take_portfolio_snapshots()

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

        take_portfolio_snapshots()

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
