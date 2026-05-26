"""
Stock detail view: company header, KPI cards, Graham box, historical charts.
"""

from __future__ import annotations
import pandas as pd
import plotly.express as px
import streamlit as st

from config.settings import KPI_FIELDS
from services.simfin import get_fundamentals, get_historical
from utils.formatters import format_value
from utils.graham import graham_number, margin_of_safety


def _gauge_chart(value: float | None, title: str) -> None:
    """Render a simple progress-bar gauge for margin of safety."""
    if value is None:
        st.metric(title, "—")
        return

    clamped = max(-100.0, min(100.0, value))
    color = "#22c55e" if value > 0 else "#ef4444"
    pct = int((clamped + 100) / 2)  # map [-100,100] → [0,100]

    st.markdown(
        f"""
        <div style='margin-bottom:8px;'>
            <strong>{title}</strong>
            <span style='color:{color}; font-size:1.4em; margin-left:12px;'>{value:.1f}%</span>
        </div>
        <div style='background:#333; border-radius:4px; height:12px; width:100%;'>
            <div style='background:{color}; border-radius:4px; height:12px; width:{pct}%;'></div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _trend_chart(historical: list[dict], y_field: str, label: str) -> None:
    """Line chart for a single KPI over fiscal years."""
    rows = [
        {"Ano": h.get("fyear"), label: h.get(y_field)}
        for h in historical
        if h.get(y_field) is not None
    ]
    if not rows:
        return
    df = pd.DataFrame(rows).dropna()
    if df.empty:
        return
    fig = px.line(df, x="Ano", y=label, markers=True, title=label)
    fig.update_layout(margin=dict(l=20, r=20, t=40, b=20), height=220)
    st.plotly_chart(fig, use_container_width=True)


def render_stock_card(
    ticker: str,
    us_yield: float,
    ecb_rate: float,
    graham_factor: float,
    current_price: float | None = None,
) -> None:
    """Full detail view for a single stock."""
    with st.spinner(f"Carregando dados de **{ticker.upper()}**…"):
        try:
            data = get_fundamentals(
                ticker,
                current_price=current_price,
                graham_factor=graham_factor,
            )
        except RuntimeError as exc:
            st.error(str(exc))
            return

    if not data:
        st.warning(
            f"Ticker **{ticker.upper()}** não encontrado no SimFin. "
            "Verifique o formato (ex: AAPL para US, SAP para DE)."
        )
        return

    # ── Company header ────────────────────────────────────────────────────────
    st.subheader(f"{data.get('name', ticker.upper())} ({data.get('ticker', ticker.upper())})")
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Setor", data.get("sector") or "—")
    col2.metric("País", data.get("country") or "—")
    col3.metric("Mercado", data.get("market") or "—")
    price_val = current_price or data.get("price")
    col4.metric("Preço", f"${price_val:.2f}" if price_val else "—")

    st.markdown("---")

    # ── KPI cards (3 columns) ─────────────────────────────────────────────────
    st.subheader("Indicadores Fundamentalistas")
    kpi_keys = list(KPI_FIELDS.keys())
    rows_of_3 = [kpi_keys[i : i + 3] for i in range(0, len(kpi_keys), 3)]

    for row in rows_of_3:
        cols = st.columns(3)
        for col, kpi in zip(cols, row):
            meta = KPI_FIELDS[kpi]
            val = data.get(kpi)
            formatted = format_value(val, meta["format"])
            col.metric(label=meta["label"], value=formatted)

    st.markdown("---")

    # ── Graham valuation box ──────────────────────────────────────────────────
    st.subheader("📐 Valuation de Graham")

    eps_val  = data.get("eps")
    bvps_val = data.get("bvps")
    g_num    = data.get("graham_number") or graham_number(eps_val, bvps_val, factor=graham_factor)
    price    = current_price or data.get("price")
    mos      = data.get("margin_of_safety") or margin_of_safety(g_num, price)

    gcol1, gcol2, gcol3 = st.columns(3)
    gcol1.metric("Número de Graham", f"${g_num:.2f}" if g_num else "—")
    gcol2.metric("Preço Atual", f"${price:.2f}" if price else "—")
    gcol3.metric("EPS Diluído", f"${eps_val:.2f}" if eps_val else "—")

    country = data.get("country", "").upper()
    ref_rate = us_yield if country == "US" else ecb_rate
    st.caption(
        f"Taxa de referência usada: **{ref_rate:.2f}%** "
        f"({'US 10Y' if country == 'US' else 'BCE'})"
    )

    _gauge_chart(mos, "Margem de Segurança")

    st.markdown("---")

    # ── Historical charts ─────────────────────────────────────────────────────
    st.subheader("📈 Evolução Histórica")
    with st.spinner("Carregando histórico…"):
        try:
            historical = get_historical(ticker)
        except Exception:
            historical = []

    if historical:
        hcol1, hcol2 = st.columns(2)
        with hcol1:
            _trend_chart(historical, "revenue_per_share", "Receita por Ação")
            _trend_chart(historical, "roe",               "ROE %")
        with hcol2:
            _trend_chart(historical, "net_margin",        "Margem Líquida %")
            _trend_chart(historical, "debt_equity",       "Dívida/Patrimônio")
    else:
        st.info("Dados históricos não disponíveis para este ticker.")

    # ── Raw statements expander ───────────────────────────────────────────────
    with st.expander("📋 Dados Brutos (todos os KPIs)"):
        raw_df = pd.DataFrame([data]).T.reset_index()
        raw_df.columns = ["Campo", "Valor"]
        st.dataframe(raw_df, use_container_width=True, hide_index=True)
