"""
SimFin API v3 client with Supabase caching.

All public functions return plain Python dicts (JSON-serialisable) so they
can be stored in the fundamentals_cache JSONB column.
"""

from __future__ import annotations
import os
import time
import math
import logging
from datetime import datetime, timezone, timedelta
from typing import Any

import httpx
from dotenv import load_dotenv

from config.settings import (
    SIMFIN_BASE_URL,
    SIMFIN_RETRY_MAX,
    SIMFIN_RETRY_BACKOFF,
    CACHE_TTL_HOURS,
)

load_dotenv()

logger = logging.getLogger(__name__)

_API_KEY = os.getenv("SIMFIN_API_KEY", "")


# ─── Low-level HTTP ──────────────────────────────────────────────────────────

def _headers() -> dict:
    return {"Authorization": _API_KEY, "Accept": "application/json"}


def _get(path: str, params: dict | None = None) -> Any:
    """
    GET {SIMFIN_BASE_URL}{path} with retries and structured error handling.
    Raises RuntimeError with a user-friendly message on failure.
    """
    if not _API_KEY:
        raise RuntimeError(
            "API key inválida. Verifique o arquivo .env (variável SIMFIN_API_KEY)."
        )

    url = f"{SIMFIN_BASE_URL}{path}"
    delay = SIMFIN_RETRY_BACKOFF

    for attempt in range(1, SIMFIN_RETRY_MAX + 1):
        try:
            with httpx.Client(timeout=30) as client:
                response = client.get(url, headers=_headers(), params=params or {})

            if response.status_code == 200:
                return response.json()
            elif response.status_code == 401:
                raise RuntimeError(
                    "API key inválida. Verifique o arquivo .env (variável SIMFIN_API_KEY)."
                )
            elif response.status_code == 404:
                return None  # caller handles not-found
            elif response.status_code == 429:
                if attempt < SIMFIN_RETRY_MAX:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise RuntimeError(
                    "Limite de requisições SimFin atingido. Aguarde um momento e tente novamente."
                )
            else:
                if attempt < SIMFIN_RETRY_MAX:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise RuntimeError(
                    f"Erro SimFin {response.status_code}: {response.text[:200]}"
                )
        except httpx.RequestError as exc:
            if attempt < SIMFIN_RETRY_MAX:
                time.sleep(delay)
                delay *= 2
            else:
                raise RuntimeError(f"Erro de conexão com SimFin: {exc}") from exc

    raise RuntimeError("Falha ao conectar ao SimFin após várias tentativas.")


# ─── Company search ──────────────────────────────────────────────────────────

def search_company(query: str) -> list[dict]:
    """
    Search for companies by ticker or name.
    Returns a list of dicts: [{ticker, name, simId, ...}, ...]
    """
    result = _get("/companies/search", {"query": query})
    if result is None or not result:
        return []
    # The endpoint returns a list directly
    if isinstance(result, list):
        return result
    return result.get("data", [])


# ─── Statement fetching & parsing ────────────────────────────────────────────

def _fetch_statements(ticker: str, fyear: int | None = None) -> dict | None:
    """
    Fetch PL, BS, CF and DERIVED statements for a ticker.
    Returns the raw parsed JSON or None if ticker not found.
    """
    params: dict[str, Any] = {
        "ticker": ticker,
        "statements": "PL,BS,CF,DERIVED",
        "period": "FY",
    }
    if fyear:
        params["fyear"] = fyear

    result = _get("/companies/statements/verbose", params)
    if result is None:
        return None
    # Verbose endpoint wraps data: [{ticker, statements: {...}}]
    if isinstance(result, list) and len(result) > 0:
        item = result[0]
        logger.debug(
            "SimFin raw keys for %s: %s  |  statements type: %s",
            ticker,
            list(item.keys()) if isinstance(item, dict) else type(item).__name__,
            type(item.get("statements")).__name__ if isinstance(item, dict) else "?",
        )
        return item
    logger.warning("Unexpected SimFin response shape for %s: %s", ticker, str(result)[:200])
    return None


def _safe_float(value: Any) -> float | None:
    """Convert a value to float, returning None on failure."""
    if value is None:
        return None
    try:
        f = float(value)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _extract_field(statement: list[dict] | None, field_name: str) -> float | None:
    """
    Extract a numeric value from a SimFin statement row list.
    Each row is: {"uid": "...", "displayName": "...", "value": ...}
    """
    if not statement:
        return None
    for row in statement:
        name = (row.get("displayName") or row.get("uid") or "").lower().replace(" ", "_")
        uid = (row.get("uid") or "").lower().replace(" ", "_").replace("-", "_")
        if field_name.lower() in (name, uid):
            return _safe_float(row.get("value"))
    return None


def _find_field(rows: list[dict], *candidates: str) -> float | None:
    """Try multiple field name candidates, returning the first match."""
    for candidate in candidates:
        val = _extract_field(rows, candidate)
        if val is not None:
            return val
    return None


def _parse_fundamentals(raw: dict, current_price: float | None, graham_factor: float = 22.5) -> dict:
    """
    Parse raw SimFin verbose statements into a flat KPI dict.

    SimFin v3 may return ``statements`` as either:
      - a dict  : {"BS": [period, ...], "PL": [...], ...}
      - a list  : [{"type": "BS", "data": [...], ...}, ...]
    Both formats are handled below.
    """
    statements_raw = raw.get("statements", {})
    logger.debug(
        "statements type=%s preview=%s",
        type(statements_raw).__name__,
        str(statements_raw)[:300],
    )

    # ── Normalise to dict[str, list[period]] ─────────────────────────────────
    if isinstance(statements_raw, list):
        # List format: [{type, (data|periods|rows), ...}, ...]
        statements: dict = {}
        for entry in statements_raw:
            if not isinstance(entry, dict):
                continue
            # Identify statement type key
            stmt_type = (
                entry.get("type")
                or entry.get("statement")
                or entry.get("stmtType")
                or ""
            ).upper()
            if not stmt_type:
                continue
            # Periods may live under several key names
            periods = (
                entry.get("periods")
                or entry.get("data")
                or entry.get("rows")
                or []
            )
            # If the data is already a flat row list (not a list of periods),
            # wrap it in a single period shell so _latest_rows works uniformly.
            if periods and isinstance(periods[0], dict) and "value" in periods[0]:
                periods = [{"data": periods}]
            statements[stmt_type] = periods
        logger.debug("Normalised statements keys: %s", list(statements.keys()))
    else:
        statements = statements_raw  # already a dict

    # Each statement value is a list of periods; take the most recent FY
    def _latest_rows(key: str) -> list[dict]:
        periods = statements.get(key, [])
        if isinstance(periods, list) and periods:
            period = periods[-1]  # most recent fiscal year
            if isinstance(period, dict):
                return period.get("data", [])
        return []

    bs   = _latest_rows("BS")
    derv = _latest_rows("DERIVED")

    # ── DERIVED fields (direct from SimFin) ──────────────────────────────────
    eps          = _find_field(derv, "eps_diluted", "earnings_per_share_diluted")
    bvps         = _find_field(derv, "book_value_per_share", "book_value_share")
    fcf_ps       = _find_field(derv, "free_cash_flow_per_share", "fcf_per_share")
    div_ps       = _find_field(derv, "dividends_per_share", "dividend_per_share")
    rev_ps       = _find_field(derv, "revenue_per_share")
    roe          = _find_field(derv, "return_on_equity", "roe")
    roa          = _find_field(derv, "return_on_assets", "roa")
    roic         = _find_field(derv, "return_on_invested_capital", "roic")
    gross_margin = _find_field(derv, "gross_profit_margin", "gross_margin")
    ebit_margin  = _find_field(derv, "ebit_margin", "operating_margin")
    net_margin   = _find_field(derv, "net_profit_margin", "net_margin")
    ev_ebitda    = _find_field(derv, "ev_ebitda", "enterprise_value_over_ebitda")
    dy           = _find_field(derv, "dividend_yield", "dy")
    net_debt_ebitda = _find_field(derv, "net_debt_ebitda", "net_debt_over_ebitda")
    current_ratio   = _find_field(derv, "current_ratio")
    piotroski    = _find_field(derv, "piotroski_f_score", "piotroski")
    fcf_to_ni    = _find_field(derv, "fcf_to_net_income", "fcf_net_income_ratio")
    payout_ratio = _find_field(derv, "dividend_payout_ratio", "payout_ratio")
    beta         = _find_field(derv, "beta")

    # ── Balance sheet fallbacks ───────────────────────────────────────────────
    total_debt   = _find_field(bs, "total_debt", "long_term_debt_short_term_debt")
    total_equity = _find_field(bs, "total_equity", "shareholders_equity", "common_equity")
    debt_equity  = (
        (total_debt / total_equity)
        if (total_debt is not None and total_equity and total_equity != 0)
        else None
    )

    # ── Calculated KPIs ───────────────────────────────────────────────────────
    from utils.graham import graham_number as calc_graham, margin_of_safety as calc_mos

    g_num = calc_graham(eps, bvps, factor=graham_factor)
    mos   = calc_mos(g_num, current_price)

    pl_ratio  = (current_price / eps)   if (current_price and eps and eps > 0)       else None
    pvpa      = (current_price / bvps)  if (current_price and bvps and bvps > 0)     else None
    pfcf      = (current_price / fcf_ps) if (current_price and fcf_ps and fcf_ps > 0) else None

    # ── Company metadata ─────────────────────────────────────────────────────
    company_info = {
        "ticker":  raw.get("ticker", ""),
        "name":    raw.get("name", ""),
        "sector":  raw.get("sector", ""),
        "country": raw.get("country", ""),
        "market":  raw.get("market", ""),
        "price":   current_price,
    }

    return {
        **company_info,
        # Valuation
        "pl":               pl_ratio,
        "pvpa":             pvpa,
        "pfcf":             pfcf,
        "ev_ebitda":        ev_ebitda,
        "dy":               dy,
        "graham_number":    g_num,
        "margin_of_safety": mos,
        # Rentabilidade
        "roe":              roe,
        "roa":              roa,
        "roic":             roic,
        "gross_margin":     gross_margin,
        "ebit_margin":      ebit_margin,
        "net_margin":       net_margin,
        # Saúde Financeira
        "debt_equity":      debt_equity,
        "net_debt_ebitda":  net_debt_ebitda,
        "current_ratio":    current_ratio,
        "piotroski":        piotroski,
        # Por Ação
        "eps":              eps,
        "bvps":             bvps,
        "fcf_per_share":    fcf_ps,
        "div_per_share":    div_ps,
        "revenue_per_share":rev_ps,
        # Qualidade
        "fcf_to_ni":        fcf_to_ni,
        "payout_ratio":     payout_ratio,
        "beta":             beta,
    }


# ─── Historical data ─────────────────────────────────────────────────────────

def get_historical(ticker: str, years: int = 5) -> list[dict]:
    """
    Fetch multiple fiscal years of data for trend charts.
    Returns a list of flat KPI dicts, one per FY.
    """
    current_year = datetime.now().year
    results = []
    for y in range(current_year - years, current_year + 1):
        try:
            raw = _fetch_statements(ticker, fyear=y)
            if raw:
                parsed = _parse_fundamentals(raw, current_price=None)
                parsed["fyear"] = y
                results.append(parsed)
        except Exception:
            continue
    return results


# ─── Main public function (with Supabase cache) ──────────────────────────────

def get_fundamentals(
    ticker: str,
    current_price: float | None = None,
    graham_factor: float = 22.5,
    force_refresh: bool = False,
) -> dict | None:
    """
    Retrieve fundamental KPIs for a ticker.

    1. Check Supabase cache (fundamentals_cache table).
    2. If cache miss or stale (> 24 h) OR force_refresh: call SimFin.
    3. Parse response, compute calculated KPIs.
    4. Persist to cache.
    5. Return flat KPI dict, or None if ticker not found.
    """
    ticker = ticker.upper().strip()

    # ── 1. Try cache ──────────────────────────────────────────────────────────
    if not force_refresh:
        cached = _read_cache(ticker)
        if cached:
            # Recalculate price-dependent fields with current price
            if current_price:
                from utils.graham import graham_number as calc_graham, margin_of_safety as calc_mos
                eps  = cached.get("eps")
                bvps = cached.get("bvps")
                fcf_ps = cached.get("fcf_per_share")
                g_num = calc_graham(eps, bvps, factor=graham_factor)
                cached["graham_number"]    = g_num
                cached["margin_of_safety"] = calc_mos(g_num, current_price)
                cached["pl"]   = (current_price / eps)    if (eps and eps > 0)     else None
                cached["pvpa"] = (current_price / bvps)   if (bvps and bvps > 0)   else None
                cached["pfcf"] = (current_price / fcf_ps) if (fcf_ps and fcf_ps > 0) else None
                cached["price"] = current_price
            return cached

    # ── 2. Fetch from SimFin ──────────────────────────────────────────────────
    raw = _fetch_statements(ticker)
    if raw is None:
        raise RuntimeError(
            f"Ticker **{ticker}** não encontrado no SimFin. "
            "Verifique o formato (ex: AAPL para US, SAP para DE)."
        )

    data = _parse_fundamentals(raw, current_price=current_price, graham_factor=graham_factor)

    # ── 3. Persist to cache ───────────────────────────────────────────────────
    _write_cache(ticker, data)

    return data


# ─── Cache helpers ────────────────────────────────────────────────────────────

def _read_cache(ticker: str) -> dict | None:
    """Read from fundamentals_cache if data is fresh enough."""
    try:
        from services.supabase_client import get_authenticated_client
        client = get_authenticated_client()
        if client is None:
            return None

        result = (
            client.table("fundamentals_cache")
            .select("data, fetched_at")
            .eq("ticker", ticker)
            .execute()
        )
        rows = result.data if result else []
        if not rows:
            return None

        row = rows[0]
        fetched_at_str = row.get("fetched_at", "")
        fetched_at = datetime.fromisoformat(fetched_at_str.replace("Z", "+00:00"))
        age = datetime.now(timezone.utc) - fetched_at

        if age < timedelta(hours=CACHE_TTL_HOURS):
            return row["data"]
        return None  # stale
    except Exception as exc:
        logger.warning("Cache read failed: %s", exc)
        return None


def _write_cache(ticker: str, data: dict) -> None:
    """Upsert fundamentals data into the cache table."""
    try:
        from services.supabase_client import get_authenticated_client
        client = get_authenticated_client()
        if client is None:
            return

        client.table("fundamentals_cache").upsert(
            {
                "ticker": ticker,
                "data": data,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="ticker",
        ).execute()
    except Exception as exc:
        logger.warning("Cache write failed: %s", exc)
