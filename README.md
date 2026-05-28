# FundaScope

A financial analysis web app for Brazilian and international equities.
Features a stock screener (Bazin / Graham methods), personal portfolio tracking,
and per-ticker deep-dive analysis pages.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS + shadcn/ui (Radix UI) |
| Backend / DB | Supabase (Postgres + Auth + RLS) |
| Data fetching | @supabase/supabase-js v2 |
| Admin pipeline | Python 3.11+ + yfinance |

---

## Prerequisites

- Node.js 18+
- Python 3.11+
- A Supabase project (free tier works fine)

---

## Local Setup

### 1. Clone & install frontend dependencies

```bash
git clone <repo-url>
cd FundaScope
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → anon public key |


> **Security note:** `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. Never expose it to
> the browser. Keep it in `.env` (which is git-ignored).

### 3. Apply the database schema

In the Supabase Dashboard, open the **SQL Editor** and run the contents of `supabase/schema.sql`.

### 4. Create users

This app does **not** allow self-registration. Create users manually:

Supabase Dashboard → Authentication → Users → Invite user (or Add user).

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Admin Data Pipeline

### Install Python dependencies

```bash
cd scripts
pip install yfinance supabase python-dotenv
```

The script reads from `.env` in the project root (or the current directory). Make sure
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.

### Initialize new tickers (first-time fetch)

Fetches profile, fundamentals, and price for all tickers whose `last_update IS NULL`
(i.e. tickers added via the UI but not yet fetched). On success, sets `last_update = NOW()`.

```bash
python update_market_data.py --mode init
```

### Daily price update

Updates `stock_prices` for all active tickers.

```bash
python update_market_data.py --mode prices
```

### Quarterly fundamentals refresh

Updates `stock_fundamentals` for all active tickers.

```bash
python update_market_data.py --mode fundamentals
```

### Update both prices and fundamentals

```bash
python update_market_data.py --mode all
```

### Test with a single ticker

```bash
python update_market_data.py --mode all --ticker AAPL
python update_market_data.py --mode init --ticker PETR4.SA
```

---

## User Guide

### Login

Navigate to the app. Enter your email and password (provided by the admin).
Sessions persist — you won't need to log in again until the session expires.

### Screener (`/screener`)

Two analysis tabs:

- **BAZIN / 3/8** — Bazin ceiling prices (Teto 8% / Teto 6%), buy signal, upside, DY%.
- **GRAHAM** — Intrinsic value, fair value, margin of safety, and all key ratios.

All financial formulas are calculated client-side in `src/lib/calculations.ts`.

**Filtering & sorting:**
- Type in the search box to filter by ticker or company name.
- Click **Filtros** to expand numeric range filters for P/L, P/VPA, DY%, ROE, ROIC.
- Click any column header to sort.

**Adding a ticker:**
Click **Add Ticker**, enter the yfinance ticker symbol (e.g. `PETR4.SA`, `AAPL`),
and submit. The ticker will appear immediately with `-` in all calculated columns
until the admin runs `python update_market_data.py --mode init`.

### Portfolio (`/portfolio`)

Track your positions with real-time P&L, estimated annual dividends, and portfolio weights.

- **Add position** — pick a ticker from the dropdown, enter quantity and average purchase price.
- **Edit position** — click the pencil icon to update quantity or average price.
- **Remove position** — click the trash icon.

Summary cards at the top show total invested, current value, total P&L, estimated annual
dividends, and portfolio yield.

### Analysis (`/analysis/:ticker`)

Click any ticker in the Screener or Portfolio to open a detailed analysis page:

1. **Company profile** — description, sector, website.
2. **Graham analysis** — intrinsic value, fair value, upside, margin of safety
   (colour-coded: green > 30%, yellow 10–30%, red < 10%).
3. **Bazin analysis** — Teto 8%, Teto 6%, buy/sell signal badge.
4. **Key ratios** — all fundamentals grouped by category.
5. **My position** — quick edit for your portfolio holding in this ticker.

---

## Project Structure

```
/
├── src/
│   ├── components/ui/      ← shadcn/ui primitives (Button, Card, Dialog, …)
│   ├── lib/
│   │   ├── supabase.ts     ← Supabase client + DB types
│   │   ├── calculations.ts ← All financial formulas (pure functions)
│   │   └── utils.ts        ← cn() helper
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Screener.tsx
│   │   ├── Portfolio.tsx
│   │   └── Analysis.tsx
│   ├── App.tsx             ← Router, auth guard, layout
│   └── main.tsx
├── scripts/
│   └── update_market_data.py
├── supabase/
│   └── schema.sql
├── .env.example
└── README.md
```
