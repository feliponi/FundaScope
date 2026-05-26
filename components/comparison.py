"""
Side-by-side stock comparison: KPI table, radar chart, bar charts.
"""

from __future__ import annotations
import math
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from config.settings import KPI_FIELDS, RADAR_DIMENSIONS, MAX_COMPARISON_TICKERS
from services.simfin import get_fundamentals
from utils.formatters import format_value


def _normalize(values: list[float | None]) -> list[float]:
    """Min-max normalize a list of floats to [0, 1]. Nones → 0."""
    clean = [v if v is not None else 0.0 for v in values]
    lo, hi = min(clean), max(clean)
    if hi == lo:
        return [0.5] * len(clean)
    return [(v - lo) / (hi - lo) for v in clean]


def _radar_chart(df: pd.DataFrame) -> go.Figure:
    """Build a radar/spider chart from the comparison dataframe."""
    categories = list(RADAR_DIMENSIONS.keys())
    fig = go.Figure()

    for _, row in df.iterrows():
        scores = []
        for dim, kpis in RADAR_DIMENSIONS.items():
            vals = [_safe_float(row.get(k)) for k in kpis]
            valid = [v for v in vals if v is not None]
            scores.append(sum(valid) / len(valid) if valid else 0.0)

        fig.add_trace(
            go.Scatterpolar(
                r=scores + [scores[0]],
                theta=categories + [categories[0]],
                fill="toself",
                name=row.get("ticker", ""),
            )
        )

    fig.update_layout(
        polar=dict(radialaxis=dict(visible=True)),
        showlegend=True,
        title="Comparação por Dimensão",
        height=450,
    )
    return fig


def _safe_float(v) -> float | None:
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def render_comparison(graham_factor: float) -> None:
    st.header("🔬 Comparar Ativos")

    # ── Ticker input ──────────────────────────────────────────────────────────
    raw = st.text_input(
        f"Tickers para comparar (até {MAX_COMPARISON_TICKERS}, separados por vírgula)",
        placeholder="AAPL, MSFT, GOOG, SAP, ASML",
    )

    if not raw:
        st.info("Insira tickers acima para iniciar a comparação.")
        return

    tickers = [t.strip().upper() for t in raw.split(",") if t.strip()]
    tickers = tickers[:MAX_COMPARISON_TICKERS]

    if len(tickers) < 2:
        st.warning("Insira pelo menos 2 tickers para comparar.")
        return

    # ── Fetch data ────────────────────────────────────────────────────────────
    rows = []
    errors = []
    with st.spinner("Carregando dados…"):
        for ticker in tickers:
            try:
                data = get_fundamentals(ticker, graham_factor=graham_factor)
                if data:
                    rows.append(data)
            except RuntimeError as exc:
                errors.append(str(exc))

    for err in errors:
        st.warning(err)

    if not rows:
        st.error("Não foi possível carregar dados para nenhum ticker.")
        return

    df = pd.DataFrame(rows)

    # ── KPI comparison table ──────────────────────────────────────────────────
    st.subheader("📊 Tabela Comparativa de KPIs")

    table_data: dict[str, list] = {"KPI": []}
    for _, row in df.iterrows():
        table_data[row.get("ticker", "?")] = []

    for kpi_key, meta in KPI_FIELDS.items():
        table_data["KPI"].append(meta["label"])
        for _, row in df.iterrows():
            ticker = row.get("ticker", "?")
            table_data[ticker].append(format_value(row.get(kpi_key), meta["format"]))

    comparison_df = pd.DataFrame(table_data)
    st.dataframe(comparison_df, use_container_width=True, hide_index=True)

    # ── Radar chart ───────────────────────────────────────────────────────────
    st.subheader("🕸️ Radar por Dimensão")
    st.plotly_chart(_radar_chart(df), use_container_width=True)

    # ── Bar charts for key metrics ────────────────────────────────────────────
    st.subheader("📊 Métricas Individuais")
    bar_kpis = ["roe", "net_margin", "ev_ebitda", "pl", "current_ratio", "piotroski"]

    bar_cols = st.columns(2)
    for i, kpi in enumerate(bar_kpis):
        if kpi not in df.columns:
            continue
        meta = KPI_FIELDS.get(kpi)
        if not meta:
            continue
        plot_df = df[["ticker", kpi]].dropna(subset=[kpi]).copy()
        plot_df[kpi] = pd.to_numeric(plot_df[kpi], errors="coerce")
        plot_df = plot_df.dropna()
        if plot_df.empty:
            continue
        fig = px.bar(
            plot_df,
            x="ticker",
            y=kpi,
            title=meta["label"],
            labels={"ticker": "Ticker", kpi: meta["label"]},
            color="ticker",
        )
        fig.update_layout(showlegend=False, height=280, margin=dict(l=10, r=10, t=40, b=10))
        with bar_cols[i % 2]:
            st.plotly_chart(fig, use_container_width=True)
