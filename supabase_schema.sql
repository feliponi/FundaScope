-- FundaScope — Supabase Schema
-- Run this in your Supabase SQL Editor (Database > SQL Editor)

-- ─────────────────────────────────────────
-- 1. Portfolios
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolios (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 2. Holdings
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holdings (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID        NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker       TEXT        NOT NULL,
  market       TEXT,                        -- 'US', 'DE', 'NL', etc.
  notes        TEXT,
  added_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 3. Fundamentals cache (shared across users)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fundamentals_cache (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker     TEXT        NOT NULL,
  data       JSONB       NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ticker)
);

-- ─────────────────────────────────────────
-- 4. Row Level Security
-- ─────────────────────────────────────────
ALTER TABLE portfolios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fundamentals_cache  ENABLE ROW LEVEL SECURITY;

-- Portfolios: each user sees/modifies only their own rows
CREATE POLICY "Users manage own portfolios"
  ON portfolios
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Holdings: users access rows that belong to their portfolios
CREATE POLICY "Users manage own holdings"
  ON holdings
  FOR ALL
  USING (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE user_id = auth.uid()
    )
  );

-- Cache: any authenticated user can read; writes are open (shared cache)
CREATE POLICY "Authenticated users read cache"
  ON fundamentals_cache
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users write cache"
  ON fundamentals_cache
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users update cache"
  ON fundamentals_cache
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────
-- 5. Indexes
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_portfolios_user_id        ON portfolios(user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_id     ON holdings(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_holdings_ticker           ON holdings(ticker);
CREATE INDEX IF NOT EXISTS idx_fundamentals_cache_ticker ON fundamentals_cache(ticker);

-- ─────────────────────────────────────────
-- 6. Auto-update updated_at on portfolios
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON portfolios;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON portfolios
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
