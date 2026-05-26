"""
Portfolio view: list of holdings with KPI table, add/remove tickers, CSV export.
"""

from __future__ import annotations
import io
import pandas as pd
import streamlit as st

from config.settings import KPI_FIELDS, COLOR_RULES
from services.portfolio import (
    list_holdings,
    add_holding,
    remove_holding,
    clear_cache_for_holdings,
)
from services.simfin import get_fundamentals
from utils.formatters import format_value, color_cell


def _fetch_portfolio_data(
    portfolio_id: str,
    graham_factor: float,
    force_refresh: bool = False,
) -> pd.DataFrame:
    """Fetch fundamentals for all holdings and return as a DataFrame."""
    holdings = list_holdings(portfolio_id)
    rows = []
    errors = []

    progress = st.progress(0, text="Carregando dados fundamentalistas…")
    total = len(holdings)

    for i, holding in enumerate(holdings):
        ticker = holding["ticker"]
        try:
            data = get_fundamentals(
                ticker,
                graham_factor=graham_factor,
                force_refresh=force_refresh,
            )
            if data:
                data["_holding_id"] = holding["id"]
                data["_added_at"] = holding.get("added_at", "")
                rows.append(data)
        except RuntimeError as exc:
            errors.append(f"{ticker}: {exc}")
        progress.progress((i + 1) / max(total, 1), text=f"Carregando {ticker}…")

    progress.empty()

    for err in errors:
        st.warning(err)

    if not rows:
        return pd.DataFrame()

    return pd.DataFrame(rows)


def _style_dataframe(df: pd.DataFrame) -> pd.DataFrame.style:
    """Apply color styling to KPI columns."""
    def _apply_color(col):
        rule = COLOR_RULES.get(col.name)
        if not rule:
            return [""] * len(col)
        return [color_cell(v, rule) for v in col]

    styled = df.style
    for col_name in COLOR_RULES:
        if col_name in df.columns:
            styled = styled.apply(_apply_color, subset=[col_name])
    return styled


def render_portfolio_view(portfolio: dict, graham_factor: float) -> None:
    """Render the full portfolio detail view."""
    portfolio_id = portfolio["id"]
    portfolio_name = portfolio["name"]

    st.header(f"📊 {portfolio_name}")
    if portfolio.get("description"):
        st.caption(portfolio["description"])

    # ── Actions bar ──────────────────────────────────────────────────────────
    col_add, col_refresh, col_export = st.columns([3, 1, 1])

    with col_add:
        with st.form(key=f"add_holding_{portfolio_id}", clear_on_submit=True):
            ticker_input = st.text_input(
                "Adicionar ativo",
                placeholder="Ex: AAPL, SAP, ASML",
                label_visibility="collapsed",
            )
            col_f1, col_f2 = st.columns([3, 1])
            with col_f1:
                submitted = st.form_submit_button("➕ Adicionar", type="primary")
            with col_f2:
                market_input = st.text_input("Mercado", placeholder="US", value="US")

            if submitted and ticker_input:
                result = add_holding(portfolio_id, ticker_input.strip(), market=market_input)
                if result:
                    st.success(f"**{ticker_input.upper()}** adicionado ao portfólio!")
                    st.rerun()

    force_refresh = False
    with col_refresh:
        if st.button("🔄 Atualizar", help="Limpa o cache e rebusca os dados"):
            cleared = clear_cache_for_holdings(portfolio_id)
            force_refresh = True
            st.info(f"Cache limpo para {cleared} ativo(s).")

    # ── Load data ────────────────────────────────────────────────────────────
    df = _fetch_portfolio_data(portfolio_id, graham_factor, force_refresh=force_refresh)

    if df.empty:
        st.info("Este portfólio ainda não possui ativos. Adicione um ticker acima.")
        return

    # ── KPI table ────────────────────────────────────────────────────────────
    display_cols = {
        "ticker": "Ticker",
        "name": "Empresa",
        "country": "País",
    }
    display_cols.update({k: v["label"] for k, v in KPI_FIELDS.items()})

    available_cols = {k: v for k, v in display_cols.items() if k in df.columns}
    display_df = df[list(available_cols.keys())].copy()
    display_df.rename(columns=available_cols, inplace=True)

    # Format numeric columns
    for kpi_key, kpi_meta in KPI_FIELDS.items():
        label = kpi_meta["label"]
        if label in display_df.columns:
            display_df[label] = df[kpi_key].apply(
                lambda v, fmt=kpi_meta["format"]: format_value(v, fmt)
            )

    styled = _style_dataframe(display_df)
    st.dataframe(styled, use_container_width=True, hide_index=True)

    # ── Export CSV ───────────────────────────────────────────────────────────
    with col_export:
        csv_buf = io.StringIO()
        display_df.to_csv(csv_buf, index=False)
        st.download_button(
            "⬇️ CSV",
            data=csv_buf.getvalue(),
            file_name=f"{portfolio_name}.csv",
            mime="text/csv",
        )

    # ── Remove holdings ──────────────────────────────────────────────────────
    st.markdown("---")
    st.subheader("Remover ativos")
    holdings = list_holdings(portfolio_id)
    cols = st.columns(min(len(holdings), 5))
    for i, holding in enumerate(holdings):
        with cols[i % 5]:
            if st.button(
                f"🗑️ {holding['ticker']}",
                key=f"remove_{holding['id']}",
                help=f"Remover {holding['ticker']} do portfólio",
            ):
                if remove_holding(holding["id"]):
                    st.success(f"{holding['ticker']} removido.")
                    st.rerun()
