"""
Portfolio CRUD operations against Supabase.
All operations are scoped to the authenticated user via RLS.
"""

from __future__ import annotations
import streamlit as st
from services.supabase_client import get_authenticated_client, get_user_id
from config.settings import MAX_HOLDINGS_PER_PORTFOLIO


# ─── Portfolios ──────────────────────────────────────────────────────────────

def list_portfolios() -> list[dict]:
    """Return all portfolios for the current user."""
    client = get_authenticated_client()
    if not client:
        return []
    try:
        result = (
            client.table("portfolios")
            .select("*")
            .order("created_at", desc=False)
            .execute()
        )
        return result.data or []
    except Exception as exc:
        st.error(f"Erro ao carregar portfólios: {exc}")
        return []


def create_portfolio(name: str, description: str = "") -> dict | None:
    """Create a new portfolio for the current user. Returns the created row."""
    client = get_authenticated_client()
    if not client:
        return None
    user_id = get_user_id()
    if not user_id:
        return None
    try:
        result = (
            client.table("portfolios")
            .insert({"user_id": user_id, "name": name, "description": description})
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as exc:
        st.error(f"Erro ao criar portfólio: {exc}")
        return None


def update_portfolio(portfolio_id: str, name: str, description: str = "") -> bool:
    """Update portfolio name/description. Returns True on success."""
    client = get_authenticated_client()
    if not client:
        return False
    try:
        client.table("portfolios").update(
            {"name": name, "description": description}
        ).eq("id", portfolio_id).execute()
        return True
    except Exception as exc:
        st.error(f"Erro ao atualizar portfólio: {exc}")
        return False


def delete_portfolio(portfolio_id: str) -> bool:
    """Delete a portfolio (holdings cascade automatically). Returns True on success."""
    client = get_authenticated_client()
    if not client:
        return False
    try:
        client.table("portfolios").delete().eq("id", portfolio_id).execute()
        return True
    except Exception as exc:
        st.error(f"Erro ao deletar portfólio: {exc}")
        return False


# ─── Holdings ────────────────────────────────────────────────────────────────

def list_holdings(portfolio_id: str) -> list[dict]:
    """Return all holdings for a given portfolio."""
    client = get_authenticated_client()
    if not client:
        return []
    try:
        result = (
            client.table("holdings")
            .select("*")
            .eq("portfolio_id", portfolio_id)
            .order("added_at", desc=False)
            .execute()
        )
        return result.data or []
    except Exception as exc:
        st.error(f"Erro ao carregar holdings: {exc}")
        return []


def add_holding(portfolio_id: str, ticker: str, market: str = "", notes: str = "") -> dict | None:
    """
    Add a ticker to a portfolio.
    Returns the created row, or None if the limit is reached or on error.
    """
    # Check limit
    existing = list_holdings(portfolio_id)
    if len(existing) >= MAX_HOLDINGS_PER_PORTFOLIO:
        st.warning(
            f"Portfólio atingiu o limite de {MAX_HOLDINGS_PER_PORTFOLIO} ativos (MVP)."
        )
        return None

    # Prevent duplicates
    tickers_in_portfolio = [h["ticker"].upper() for h in existing]
    if ticker.upper() in tickers_in_portfolio:
        st.warning(f"Ticker **{ticker.upper()}** já está neste portfólio.")
        return None

    client = get_authenticated_client()
    if not client:
        return None
    try:
        result = (
            client.table("holdings")
            .insert(
                {
                    "portfolio_id": portfolio_id,
                    "ticker": ticker.upper(),
                    "market": market.upper() if market else "",
                    "notes": notes,
                }
            )
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as exc:
        st.error(f"Erro ao adicionar holding: {exc}")
        return None


def remove_holding(holding_id: str) -> bool:
    """Remove a single holding by ID. Returns True on success."""
    client = get_authenticated_client()
    if not client:
        return False
    try:
        client.table("holdings").delete().eq("id", holding_id).execute()
        return True
    except Exception as exc:
        st.error(f"Erro ao remover holding: {exc}")
        return False


def clear_cache_for_holdings(portfolio_id: str) -> int:
    """
    Delete cached fundamentals for all tickers in a portfolio.
    Returns the number of cache rows deleted.
    """
    holdings = list_holdings(portfolio_id)
    tickers = [h["ticker"] for h in holdings]
    if not tickers:
        return 0

    client = get_authenticated_client()
    if not client:
        return 0
    try:
        result = (
            client.table("fundamentals_cache")
            .delete()
            .in_("ticker", tickers)
            .execute()
        )
        return len(result.data or [])
    except Exception as exc:
        st.error(f"Erro ao limpar cache: {exc}")
        return 0
