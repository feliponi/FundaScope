"""
Application-wide constants, KPI definitions and column mappings.
"""

APP_NAME = "FundaScope"
APP_VERSION = "0.1.0"

# ─── Portfolio limits ───────────────────────────────────────────────────────
MAX_HOLDINGS_PER_PORTFOLIO = 20
MAX_COMPARISON_TICKERS = 5

# ─── Cache TTL ──────────────────────────────────────────────────────────────
CACHE_TTL_HOURS = 24           # SimFin data cached in Supabase for 24 h
SESSION_CACHE_TTL_SECONDS = 300  # st.cache_data TTL within a session (5 min)

# ─── Default reference rates ────────────────────────────────────────────────
DEFAULT_US_10Y_YIELD = 4.25     # %
DEFAULT_ECB_RATE = 3.65         # %
DEFAULT_GRAHAM_FACTOR = 22.5
DEFAULT_MARGIN_OF_SAFETY = 33.0  # %

# ─── SimFin ─────────────────────────────────────────────────────────────────
SIMFIN_BASE_URL = "https://backend.simfin.com/api/v3"
SIMFIN_RETRY_MAX = 3
SIMFIN_RETRY_BACKOFF = 2  # seconds — doubles each retry

# ─── KPI definitions ────────────────────────────────────────────────────────
# format: "2f" = 2 decimal float, "2p" = 2 decimal percent, "0f" = integer
KPI_FIELDS: dict[str, dict] = {
    # Valuation
    "pl":               {"label": "P/L (P/E Ratio)",        "source": "calculated", "format": "2f",  "group": "Valuation"},
    "pvpa":             {"label": "P/VPA (P/B Ratio)",       "source": "calculated", "format": "2f",  "group": "Valuation"},
    "pfcf":             {"label": "P/FCF",                   "source": "calculated", "format": "2f",  "group": "Valuation"},
    "ev_ebitda":        {"label": "EV/EBITDA",               "source": "derived",    "format": "2f",  "group": "Valuation"},
    "dy":               {"label": "Dividend Yield %",        "source": "derived",    "format": "2p",  "group": "Valuation"},
    "graham_number":    {"label": "Número de Graham",        "source": "calculated", "format": "2f",  "group": "Valuation"},
    "margin_of_safety": {"label": "Margem de Segurança %",   "source": "calculated", "format": "2p",  "group": "Valuation"},

    # Rentabilidade
    "roe":              {"label": "ROE %",                   "source": "derived",    "format": "2p",  "group": "Rentabilidade"},
    "roa":              {"label": "ROA %",                   "source": "derived",    "format": "2p",  "group": "Rentabilidade"},
    "roic":             {"label": "ROIC %",                  "source": "derived",    "format": "2p",  "group": "Rentabilidade"},
    "gross_margin":     {"label": "Margem Bruta %",          "source": "derived",    "format": "2p",  "group": "Rentabilidade"},
    "ebit_margin":      {"label": "Margem EBIT %",           "source": "derived",    "format": "2p",  "group": "Rentabilidade"},
    "net_margin":       {"label": "Margem Líquida %",        "source": "derived",    "format": "2p",  "group": "Rentabilidade"},

    # Saúde Financeira
    "debt_equity":      {"label": "Dívida/Patrimônio",       "source": "calculated", "format": "2f",  "group": "Saúde Financeira"},
    "net_debt_ebitda":  {"label": "Dívida Líq./EBITDA",      "source": "derived",    "format": "2f",  "group": "Saúde Financeira"},
    "current_ratio":    {"label": "Liquidez Corrente",       "source": "derived",    "format": "2f",  "group": "Saúde Financeira"},
    "piotroski":        {"label": "Piotroski F-Score",       "source": "derived",    "format": "0f",  "group": "Saúde Financeira"},

    # Por Ação
    "eps":              {"label": "LPA (EPS Diluído)",       "source": "derived",    "format": "2f",  "group": "Por Ação"},
    "bvps":             {"label": "VPA (Book Value/Share)",  "source": "derived",    "format": "2f",  "group": "Por Ação"},
    "fcf_per_share":    {"label": "FCF por Ação",            "source": "derived",    "format": "2f",  "group": "Por Ação"},
    "div_per_share":    {"label": "Dividendo por Ação",      "source": "derived",    "format": "2f",  "group": "Por Ação"},
    "revenue_per_share":{"label": "Receita por Ação",        "source": "derived",    "format": "2f",  "group": "Por Ação"},

    # Qualidade / Crescimento
    "fcf_to_ni":        {"label": "FCF/Lucro Líquido",       "source": "derived",    "format": "2f",  "group": "Qualidade"},
    "payout_ratio":     {"label": "Payout Ratio %",          "source": "derived",    "format": "2p",  "group": "Qualidade"},
    "beta":             {"label": "Beta",                    "source": "derived",    "format": "2f",  "group": "Qualidade"},
}

# ─── Screener presets ────────────────────────────────────────────────────────
SCREENER_PRESETS = {
    "Value Stocks": {
        "pl":               (0, 15),
        "pvpa":             (0, 2),
        "margin_of_safety": (20, 100),
    },
    "Quality Compounder": {
        "roe":              (15, 100),
        "roic":             (12, 100),
        "debt_equity":      (0, 1),
    },
    "High Dividend": {
        "dy":               (4, 30),
        "payout_ratio":     (0, 70),
        "current_ratio":    (1, 20),
    },
}

# ─── Color thresholds (used in portfolio table styling) ─────────────────────
COLOR_RULES = {
    "roe":              {"green": (15, None), "red": (None, 5)},
    "pl":               {"green": (None, 15), "red": (30, None)},
    "piotroski":        {"green": (7, None),  "red": (None, 3)},
    "margin_of_safety": {"green": (0, None),  "red": (None, -20)},
}

# ─── Radar chart dimensions ──────────────────────────────────────────────────
RADAR_DIMENSIONS = {
    "Valuation":         ["pl", "pvpa", "ev_ebitda"],
    "Rentabilidade":     ["roe", "roic", "net_margin"],
    "Saúde Financeira":  ["current_ratio", "piotroski"],
    "Crescimento":       ["revenue_per_share", "fcf_per_share"],
    "Qualidade":         ["fcf_to_ni", "payout_ratio"],
}
