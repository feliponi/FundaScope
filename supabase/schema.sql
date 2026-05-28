-- ============================================================
-- FundaScope — Supabase Schema
-- ============================================================

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS tickers (
  ticker        TEXT PRIMARY KEY,
  last_update   TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS stock_profiles (
  ticker              TEXT PRIMARY KEY,
  company_name        TEXT,
  sector              TEXT,
  industry            TEXT,
  country             TEXT,
  currency            TEXT,
  exchange            TEXT,
  website             TEXT,
  description         TEXT,
  profile_updated_at  TIMESTAMPTZ,
  CONSTRAINT fk_ticker FOREIGN KEY (ticker) REFERENCES tickers(ticker) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stock_prices (
  ticker      TEXT PRIMARY KEY,
  price       NUMERIC,
  price_date  DATE,
  updated_at  TIMESTAMPTZ,
  CONSTRAINT fk_ticker FOREIGN KEY (ticker) REFERENCES tickers(ticker) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stock_fundamentals (
  ticker                  TEXT PRIMARY KEY,
  -- Per-share
  eps                     NUMERIC,
  book_value_per_share    NUMERIC,
  dps                     NUMERIC,
  -- Valuation
  pe                      NUMERIC,
  pb                      NUMERIC,
  peg                     NUMERIC,
  ev_ebitda               NUMERIC,
  ev_ebit                 NUMERIC,
  psr                     NUMERIC,
  -- Profitability
  roe                     NUMERIC,
  roa                     NUMERIC,
  roic                    NUMERIC,
  gross_margin            NUMERIC,
  ebit_margin             NUMERIC,
  net_margin              NUMERIC,
  -- Debt
  debt_equity             NUMERIC,
  current_ratio           NUMERIC,
  net_debt_ebit           NUMERIC,
  -- Dividends
  dividend_yield          NUMERIC,
  payout_avg              NUMERIC,
  -- Growth
  earnings_growth_5y      NUMERIC,
  revenue_growth_yoy      NUMERIC,
  -- Size
  market_cap              BIGINT,
  beta                    NUMERIC,
  -- Meta
  fundamentals_updated_at TIMESTAMPTZ,
  CONSTRAINT fk_ticker FOREIGN KEY (ticker) REFERENCES tickers(ticker) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS portfolios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker      TEXT NOT NULL,
  quantity    NUMERIC NOT NULL,
  avg_price   NUMERIC NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE tickers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_prices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_fundamentals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios          ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- tickers
-- ---------------------------------------------------------------

-- Authenticated users can read all tickers
CREATE POLICY "tickers_select_authenticated"
  ON tickers
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert new tickers, but only with last_update = NULL
-- (signals a new ticker pending admin fetch)
CREATE POLICY "tickers_insert_authenticated"
  ON tickers
  FOR INSERT
  TO authenticated
  WITH CHECK (last_update IS NULL);

-- Only service role can update or delete (enforced by omitting policies for those ops)
-- Admin script uses service_role key which bypasses RLS entirely.

-- ---------------------------------------------------------------
-- stock_profiles — read-only for authenticated users
-- ---------------------------------------------------------------

CREATE POLICY "stock_profiles_select_authenticated"
  ON stock_profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------
-- stock_prices — read-only for authenticated users
-- ---------------------------------------------------------------

CREATE POLICY "stock_prices_select_authenticated"
  ON stock_prices
  FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------
-- stock_fundamentals — read-only for authenticated users
-- ---------------------------------------------------------------

CREATE POLICY "stock_fundamentals_select_authenticated"
  ON stock_fundamentals
  FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------
-- portfolios — users see & manage only their own rows
-- ---------------------------------------------------------------

CREATE POLICY "portfolios_select_own"
  ON portfolios
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "portfolios_insert_own"
  ON portfolios
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "portfolios_update_own"
  ON portfolios
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "portfolios_delete_own"
  ON portfolios
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios (user_id);
CREATE INDEX IF NOT EXISTS idx_tickers_last_update ON tickers (last_update);
