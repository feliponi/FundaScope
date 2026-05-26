"""
FundaScope — entry point.
Streamlit multi-page app for fundamental stock analysis (US & EU markets).
"""

from __future__ import annotations
import logging
import streamlit as st
from dotenv import load_dotenv

load_dotenv()

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ─── Page config ─────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="FundaScope",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Auth gate ────────────────────────────────────────────────────────────────
from components.auth import check_and_handle_auth, render_login_page, render_sidebar_user
from config.settings import (
    APP_VERSION,
    DEFAULT_US_10Y_YIELD,
    DEFAULT_ECB_RATE,
    DEFAULT_GRAHAM_FACTOR,
    DEFAULT_MARGIN_OF_SAFETY,
)

if not check_and_handle_auth():
    render_login_page()
    st.stop()

# ─── Sidebar ──────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("📊 FundaScope")

    render_sidebar_user()

    st.markdown("---")
    st.subheader("📐 Taxas de Referência")
    us_yield = st.number_input(
        "US 10Y Treasury Yield (%)",
        min_value=0.0,
        max_value=20.0,
        value=DEFAULT_US_10Y_YIELD,
        step=0.05,
        format="%.2f",
        key="us_yield",
    )
    ecb_rate = st.number_input(
        "Taxa BCE (%)",
        min_value=0.0,
        max_value=20.0,
        value=DEFAULT_ECB_RATE,
        step=0.05,
        format="%.2f",
        key="ecb_rate",
    )
    graham_factor = st.number_input(
        "Fator de Graham",
        min_value=1.0,
        max_value=50.0,
        value=DEFAULT_GRAHAM_FACTOR,
        step=0.5,
        key="graham_factor",
    )
    target_mos = st.number_input(
        "Margem de Segurança Alvo (%)",
        min_value=0.0,
        max_value=80.0,
        value=DEFAULT_MARGIN_OF_SAFETY,
        step=1.0,
        key="target_mos",
    )

    st.markdown("---")

    # Active portfolio selector
    from services.portfolio import list_portfolios
    portfolios = list_portfolios()

    if portfolios:
        portfolio_names = {p["name"]: p for p in portfolios}
        selected_portfolio_name = st.selectbox(
            "Portfólio Ativo",
            options=list(portfolio_names.keys()),
            key="active_portfolio_name",
        )
        st.session_state["active_portfolio"] = portfolio_names[selected_portfolio_name]
    else:
        st.session_state["active_portfolio"] = None
        st.caption("Nenhum portfólio criado ainda.")

    st.markdown("---")
    st.caption(f"v{APP_VERSION} · Powered by SimFin")

# ─── Navigation ───────────────────────────────────────────────────────────────
pages = {
    "📁 Meus Portfólios":  "portfolios",
    "📊 Visão do Portfólio": "portfolio_view",
    "🔍 Screener":          "screener",
    "🔬 Comparar Ativos":   "comparison",
    "📈 Detalhe do Ativo":  "stock_detail",
}

selected_page = st.sidebar.radio(
    "Navegação",
    options=list(pages.keys()),
    key="navigation",
)

page_key = pages[selected_page]

# ─── Page: Meus Portfólios ────────────────────────────────────────────────────
if page_key == "portfolios":
    st.header("📁 Meus Portfólios")

    # Create new portfolio
    with st.expander("➕ Criar novo portfólio"):
        with st.form("create_portfolio_form", clear_on_submit=True):
            new_name = st.text_input("Nome do portfólio *")
            new_desc = st.text_area("Descrição (opcional)", height=80)
            if st.form_submit_button("Criar Portfólio", type="primary"):
                if not new_name.strip():
                    st.warning("O nome do portfólio não pode estar vazio.")
                else:
                    from services.portfolio import create_portfolio
                    result = create_portfolio(new_name.strip(), new_desc.strip())
                    if result:
                        st.success(f"Portfólio **{new_name}** criado com sucesso!")
                        st.rerun()

    # List portfolios
    portfolios = list_portfolios()
    if not portfolios:
        st.info("Você ainda não tem portfólios. Crie um acima!")
    else:
        for p in portfolios:
            with st.container():
                pcol1, pcol2, pcol3 = st.columns([4, 1, 1])
                with pcol1:
                    st.markdown(f"### {p['name']}")
                    if p.get("description"):
                        st.caption(p["description"])
                with pcol2:
                    if st.button("📊 Ver", key=f"view_{p['id']}"):
                        st.session_state["active_portfolio"] = p
                        st.session_state["navigation"] = "📊 Visão do Portfólio"
                        st.rerun()
                with pcol3:
                    if st.button("🗑️ Excluir", key=f"del_{p['id']}"):
                        st.session_state[f"confirm_delete_{p['id']}"] = True

                if st.session_state.get(f"confirm_delete_{p['id']}"):
                    st.warning(
                        f"Tem certeza que deseja excluir **{p['name']}**? "
                        "Todos os holdings serão removidos."
                    )
                    c1, c2 = st.columns(2)
                    with c1:
                        if st.button("✅ Confirmar exclusão", key=f"confirm_yes_{p['id']}"):
                            from services.portfolio import delete_portfolio
                            delete_portfolio(p["id"])
                            st.session_state.pop(f"confirm_delete_{p['id']}", None)
                            st.success("Portfólio excluído.")
                            st.rerun()
                    with c2:
                        if st.button("❌ Cancelar", key=f"confirm_no_{p['id']}"):
                            st.session_state.pop(f"confirm_delete_{p['id']}", None)
                            st.rerun()

                st.markdown("---")

# ─── Page: Visão do Portfólio ─────────────────────────────────────────────────
elif page_key == "portfolio_view":
    from components.portfolio_view import render_portfolio_view

    active = st.session_state.get("active_portfolio")
    if not active:
        st.info("Selecione um portfólio no menu lateral.")
    else:
        render_portfolio_view(active, graham_factor=graham_factor)

# ─── Page: Screener ───────────────────────────────────────────────────────────
elif page_key == "screener":
    from components.screener import render_screener
    render_screener(portfolios=portfolios, graham_factor=graham_factor)

# ─── Page: Comparar Ativos ────────────────────────────────────────────────────
elif page_key == "comparison":
    from components.comparison import render_comparison
    render_comparison(graham_factor=graham_factor)

# ─── Page: Detalhe do Ativo ───────────────────────────────────────────────────
elif page_key == "stock_detail":
    from components.stock_card import render_stock_card

    st.header("📈 Detalhe do Ativo")
    dcol1, dcol2 = st.columns([3, 1])
    with dcol1:
        detail_ticker = st.text_input(
            "Ticker",
            placeholder="Ex: AAPL, SAP, ASML",
            key="detail_ticker_input",
        )
    with dcol2:
        detail_price = st.number_input(
            "Preço atual (opcional)",
            min_value=0.0,
            value=0.0,
            step=0.01,
            format="%.2f",
            key="detail_price_input",
        )

    if detail_ticker:
        render_stock_card(
            ticker=detail_ticker.strip(),
            us_yield=us_yield,
            ecb_rate=ecb_rate,
            graham_factor=graham_factor,
            current_price=detail_price if detail_price > 0 else None,
        )
    else:
        st.info("Digite um ticker acima para ver os dados fundamentalistas.")
