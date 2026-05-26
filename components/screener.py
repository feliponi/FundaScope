"""
Screener component: dynamic KPI filters, preset buttons, results table.
"""

from __future__ import annotations
import pandas as pd
import streamlit as st

from config.settings import KPI_FIELDS, SCREENER_PRESETS
from services.simfin import get_fundamentals
from services.portfolio import add_holding
from utils.formatters import format_value


def _load_cached_tickers() -> list[str]:
    """Return tickers already in the fundamentals_cache table."""
    from services.supabase_client import get_authenticated_client
    client = get_authenticated_client()
    if not client:
        return []
    try:
        result = client.table("fundamentals_cache").select("ticker").execute()
        return [r["ticker"] for r in (result.data or [])]
    except Exception:
        return []


def _fetch_screener_data(tickers: list[str], graham_factor: float) -> pd.DataFrame:
    """Fetch fundamentals for a list of tickers."""
    rows = []
    progress = st.progress(0, text="Carregando dados para screener…")
    total = len(tickers)

    for i, ticker in enumerate(tickers):
        try:
            data = get_fundamentals(ticker, graham_factor=graham_factor)
            if data:
                rows.append(data)
        except RuntimeError:
            pass
        progress.progress((i + 1) / max(total, 1), text=f"Carregando {ticker}…")

    progress.empty()
    return pd.DataFrame(rows) if rows else pd.DataFrame()


def _apply_filters(df: pd.DataFrame, filters: dict[str, tuple[float, float]]) -> pd.DataFrame:
    """Apply cumulative AND filters to the dataframe."""
    mask = pd.Series([True] * len(df), index=df.index)
    for col, (lo, hi) in filters.items():
        if col in df.columns:
            col_numeric = pd.to_numeric(df[col], errors="coerce")
            mask &= col_numeric.between(lo, hi, inclusive="both")
    return df[mask]


def render_screener(portfolios: list[dict], graham_factor: float) -> None:
    st.header("🔍 Screener de Ativos")

    # ── Add tickers to screener ───────────────────────────────────────────────
    with st.expander("➕ Adicionar tickers ao screener"):
        with st.form("screener_add_tickers", clear_on_submit=True):
            raw = st.text_input(
                "Tickers (separados por vírgula)",
                placeholder="AAPL, MSFT, SAP, ASML",
            )
            submitted = st.form_submit_button("Carregar dados")

        if submitted and raw:
            tickers_to_add = [t.strip().upper() for t in raw.split(",") if t.strip()]
            _fetch_screener_data(tickers_to_add, graham_factor)
            st.success(f"Dados carregados para: {', '.join(tickers_to_add)}")
            st.rerun()

    # ── Preset filter buttons ─────────────────────────────────────────────────
    st.subheader("Presets de Filtros")
    preset_cols = st.columns(len(SCREENER_PRESETS))
    active_preset: dict | None = None

    if "screener_preset" not in st.session_state:
        st.session_state["screener_preset"] = None

    for i, (preset_name, preset_filters) in enumerate(SCREENER_PRESETS.items()):
        with preset_cols[i]:
            if st.button(preset_name, use_container_width=True):
                st.session_state["screener_preset"] = preset_name

    if st.session_state["screener_preset"]:
        active_preset = SCREENER_PRESETS.get(st.session_state["screener_preset"])
        st.info(f"Preset ativo: **{st.session_state['screener_preset']}**")
        if st.button("✖ Limpar preset"):
            st.session_state["screener_preset"] = None
            st.rerun()

    # ── Dynamic KPI filter selector ───────────────────────────────────────────
    st.subheader("Filtros Personalizados")
    selected_kpis = st.multiselect(
        "Selecione os KPIs para filtrar",
        options=list(KPI_FIELDS.keys()),
        format_func=lambda k: KPI_FIELDS[k]["label"],
        default=list(active_preset.keys()) if active_preset else [],
    )

    custom_filters: dict[str, tuple[float, float]] = {}
    if selected_kpis:
        filter_cols = st.columns(min(len(selected_kpis), 3))
        for idx, kpi in enumerate(selected_kpis):
            meta = KPI_FIELDS[kpi]
            preset_range = (active_preset or {}).get(kpi)
            default_lo = float(preset_range[0]) if preset_range else -1000.0
            default_hi = float(preset_range[1]) if preset_range else 1000.0

            with filter_cols[idx % 3]:
                lo, hi = st.slider(
                    meta["label"],
                    min_value=-1000.0,
                    max_value=10000.0,
                    value=(default_lo, default_hi),
                    step=0.5,
                    key=f"screener_filter_{kpi}",
                )
                custom_filters[kpi] = (lo, hi)

    # ── Load screener universe ────────────────────────────────────────────────
    cached_tickers = _load_cached_tickers()
    if not cached_tickers:
        st.info(
            "Nenhum dado em cache. Adicione tickers acima para iniciar o screener."
        )
        return

    df = _fetch_screener_data(cached_tickers, graham_factor)
    if df.empty:
        st.warning("Não foi possível carregar dados para os tickers em cache.")
        return

    # ── Apply filters ─────────────────────────────────────────────────────────
    if custom_filters:
        df = _apply_filters(df, custom_filters)

    st.markdown(f"**{len(df)} ativo(s) encontrado(s)**")

    if df.empty:
        st.warning("Nenhum ativo atende aos filtros selecionados.")
        return

    # ── Results table ─────────────────────────────────────────────────────────
    display_kpis = selected_kpis if selected_kpis else list(KPI_FIELDS.keys())
    base_cols = ["ticker", "name", "country"]
    all_display = base_cols + [k for k in display_kpis if k in df.columns]
    disp_df = df[[c for c in all_display if c in df.columns]].copy()

    # Format KPI values
    for kpi in display_kpis:
        if kpi in disp_df.columns:
            disp_df[kpi] = df[kpi].apply(
                lambda v, fmt=KPI_FIELDS[kpi]["format"]: format_value(v, fmt)
            )

    rename_map = {k: KPI_FIELDS[k]["label"] for k in display_kpis if k in disp_df.columns}
    rename_map.update({"ticker": "Ticker", "name": "Empresa", "country": "País"})
    disp_df.rename(columns=rename_map, inplace=True)

    st.dataframe(disp_df, use_container_width=True, hide_index=True)

    # ── Add to portfolio ──────────────────────────────────────────────────────
    if portfolios:
        st.markdown("---")
        st.subheader("Adicionar ao Portfólio")
        col_ticker, col_portfolio, col_btn = st.columns([2, 2, 1])

        with col_ticker:
            add_ticker = st.selectbox(
                "Ticker",
                options=df["ticker"].tolist() if "ticker" in df.columns else [],
            )
        with col_portfolio:
            portfolio_opts = {p["name"]: p["id"] for p in portfolios}
            chosen_portfolio_name = st.selectbox("Portfólio", options=list(portfolio_opts.keys()))
        with col_btn:
            st.write("")
            st.write("")
            if st.button("Adicionar", type="primary"):
                portfolio_id = portfolio_opts[chosen_portfolio_name]
                result = add_holding(portfolio_id, add_ticker)
                if result:
                    st.success(f"**{add_ticker}** adicionado a **{chosen_portfolio_name}**!")
