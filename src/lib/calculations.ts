/**
 * All financial formulas used throughout FundaScope.
 * Every function receives plain numbers and returns number | null.
 * Returns null when any required input is null, undefined, or causes division by zero.
 */

function isValid(...values: (number | null | undefined)[]): boolean {
  return values.every((v) => v != null && isFinite(v))
}

// ---------------------------------------------------------------------------
// BAZIN — 3/8 Method
// ---------------------------------------------------------------------------

/**
 * Annual dividends per share = dividendYield × currentPrice
 */
export function calcDividendosAnuais(
  dividendYield: number | null | undefined,
  currentPrice: number | null | undefined
): number | null {
  if (!isValid(dividendYield, currentPrice)) return null
  return dividendYield! * currentPrice!
}

/**
 * Bazin ceiling at 8% yield: teto8 = dividendosAnuais / 0.08
 */
export function calcTeto8(
  dividendYield: number | null | undefined,
  currentPrice: number | null | undefined
): number | null {
  const da = calcDividendosAnuais(dividendYield, currentPrice)
  if (da == null) return null
  return da / 0.08
}

/**
 * Bazin ceiling at 6% yield: teto6 = dividendosAnuais / 0.06
 */
export function calcTeto6(
  dividendYield: number | null | undefined,
  currentPrice: number | null | undefined
): number | null {
  const da = calcDividendosAnuais(dividendYield, currentPrice)
  if (da == null) return null
  return da / 0.06
}

/**
 * Bazin buy signal: COMPRA if currentPrice <= teto8, otherwise NÃO COMPRA
 */
export function calcBazinSignal(
  dividendYield: number | null | undefined,
  currentPrice: number | null | undefined
): 'COMPRA' | 'NÃO COMPRA' | null {
  const teto8 = calcTeto8(dividendYield, currentPrice)
  if (teto8 == null || currentPrice == null) return null
  return currentPrice <= teto8 ? 'COMPRA' : 'NÃO COMPRA'
}

// ---------------------------------------------------------------------------
// GRAHAM
// ---------------------------------------------------------------------------

/**
 * Graham intrinsic value: √(22.5 × eps × bookValuePerShare)
 * Returns null if eps ≤ 0 or bookValuePerShare ≤ 0.
 */
export function calcIntrinsicValue(
  eps: number | null | undefined,
  bookValuePerShare: number | null | undefined
): number | null {
  if (!isValid(eps, bookValuePerShare)) return null
  if (eps! <= 0 || bookValuePerShare! <= 0) return null
  return Math.sqrt(22.5 * eps! * bookValuePerShare!)
}

/**
 * Graham fair value (with 5-year earnings growth):
 * fairValue = eps × (8.5 + 2 × (g × 100))
 * g is a decimal (e.g. 0.12 for 12%).
 *
 * Graham's formula assumes a sustainable long-term growth rate. To prevent
 * absurd valuations for high-growth tech stocks (e.g. g=1.03 → multiplier 214),
 * g is capped at 25% (0.25) — the upper bound of what Graham considered credible.
 * The stored earnings_growth_5y preserves the real historical value.
 */
export function calcFairValue(
  eps: number | null | undefined,
  earningsGrowth5y: number | null | undefined
): number | null {
  if (!isValid(eps, earningsGrowth5y)) return null
  if (eps! <= 0) return null
  const gCapped = Math.min(earningsGrowth5y!, 0.25)
  const gPct = gCapped * 100
  return eps! * (8.5 + 2 * gPct)
}

/**
 * Upside based on intrinsic value (Graham):
 * upside = (intrinsicValue / currentPrice) - 1
 * Returns as a decimal (multiply by 100 for %).
 */
export function calcUpside(
  intrinsicValue: number | null | undefined,
  currentPrice: number | null | undefined
): number | null {
  if (!isValid(intrinsicValue, currentPrice)) return null
  if (currentPrice! === 0) return null
  return intrinsicValue! / currentPrice! - 1
}

/**
 * Market-adjusted safety (Seg. de acordo com Juros de Mercado):
 * marketSafety = (fairValue / currentPrice) - 1
 * Returns as a decimal (multiply by 100 for %).
 */
export function calcMarketSafety(
  fairValue: number | null | undefined,
  currentPrice: number | null | undefined
): number | null {
  if (!isValid(fairValue, currentPrice)) return null
  if (currentPrice! === 0) return null
  return fairValue! / currentPrice! - 1
}

/**
 * Margin of safety: (intrinsicValue - currentPrice) / intrinsicValue × 100
 * Returns as a percentage (e.g. 35.0 for 35%).
 */
export function calcMarginOfSafety(
  intrinsicValue: number | null | undefined,
  currentPrice: number | null | undefined
): number | null {
  if (!isValid(intrinsicValue, currentPrice)) return null
  if (intrinsicValue! === 0) return null
  return ((intrinsicValue! - currentPrice!) / intrinsicValue!) * 100
}

/**
 * Graham safety indicator based on margin of safety thresholds:
 * > 30% = green, 10–30% = yellow, < 10% = red
 */
export function calcSafetyColor(
  marginOfSafety: number | null | undefined
): 'green' | 'yellow' | 'red' | null {
  if (marginOfSafety == null) return null
  if (marginOfSafety > 30) return 'green'
  if (marginOfSafety >= 10) return 'yellow'
  return 'red'
}

// ---------------------------------------------------------------------------
// PORTFOLIO HELPERS
// ---------------------------------------------------------------------------

/** current_value = quantity × currentPrice */
export function calcCurrentValue(
  quantity: number | null | undefined,
  currentPrice: number | null | undefined
): number | null {
  if (!isValid(quantity, currentPrice)) return null
  return quantity! * currentPrice!
}

/** cost_basis = quantity × avgPrice */
export function calcCostBasis(
  quantity: number | null | undefined,
  avgPrice: number | null | undefined
): number | null {
  if (!isValid(quantity, avgPrice)) return null
  return quantity! * avgPrice!
}

/** pl_abs = currentValue - costBasis */
export function calcPlAbs(
  currentValue: number | null | undefined,
  costBasis: number | null | undefined
): number | null {
  if (!isValid(currentValue, costBasis)) return null
  return currentValue! - costBasis!
}

/** pl_pct = (currentValue / costBasis) - 1, as decimal */
export function calcPlPct(
  currentValue: number | null | undefined,
  costBasis: number | null | undefined
): number | null {
  if (!isValid(currentValue, costBasis)) return null
  if (costBasis! === 0) return null
  return currentValue! / costBasis! - 1
}

/** annual_div = dividendYield × currentValue */
export function calcAnnualDiv(
  dividendYield: number | null | undefined,
  currentValue: number | null | undefined
): number | null {
  if (!isValid(dividendYield, currentValue)) return null
  return dividendYield! * currentValue!
}

/** weight = currentValue / totalPortfolioValue, as decimal */
export function calcWeight(
  currentValue: number | null | undefined,
  totalPortfolioValue: number | null | undefined
): number | null {
  if (!isValid(currentValue, totalPortfolioValue)) return null
  if (totalPortfolioValue! === 0) return null
  return currentValue! / totalPortfolioValue!
}

// ---------------------------------------------------------------------------
// FORMATTING HELPERS
// ---------------------------------------------------------------------------

export function fmtCurrency(
  value: number | null | undefined,
  currency: string | null | undefined = 'BRL'
): string {
  if (value == null) return '-'
  const cur = currency ?? 'BRL'
  const locale = cur === 'BRL' ? 'pt-BR' : 'en-US'
  return value.toLocaleString(locale, { style: 'currency', currency: cur, maximumFractionDigits: 2 })
}

export function fmtPct(value: number | null | undefined, decimals = 2): string {
  if (value == null) return '-'
  return `${(value * 100).toFixed(decimals)}%`
}

export function fmtNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null) return '-'
  return value.toFixed(decimals)
}

export function fmtLargeNumber(value: number | null | undefined): string {
  if (value == null) return '-'
  if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(2)}T`
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  return value.toFixed(0)
}

// ---------------------------------------------------------------------------
// SIMULATOR (E SE?)
// ---------------------------------------------------------------------------

export type SimulatorInput = {
  ticker: string
  company_name: string | null
  currency: string | null
  /** Current price in the user's display currency (used for allocation maths). */
  current_price: number
  /** Current price in the ticker's native currency (used when writing avg_price to portfolios). */
  current_price_native: number
  dividend_yield: number    // decimal, e.g. 0.06 for 6%
  /** Annual DPS in display currency. */
  dps_display: number
  margin_of_safety: number  // percentage, e.g. 35.0
}

export type SimulatorAllocation = SimulatorInput & {
  weight_pct: number
  allocated: number       // display currency
  shares: number          // integer (floor)
  actual_cost: number     // display currency
  leftover: number        // display currency
  est_annual_div: number  // display currency
}

/**
 * DY-weighted allocation across eligible tickers.
 * All monetary values (amount, prices) must be in the same display currency.
 * Returns rows sorted by weight_pct descending.
 */
export function calculateAllocation(
  amount: number,
  eligible: SimulatorInput[]
): SimulatorAllocation[] {
  if (!isValid(amount) || amount <= 0 || eligible.length === 0) return []
  const totalDy = eligible.reduce((s, t) => s + t.dividend_yield, 0)
  if (totalDy === 0) return []
  return eligible
    .map((t) => {
      const weight_pct = t.dividend_yield / totalDy
      const allocated = amount * weight_pct
      const shares = Math.floor(allocated / t.current_price)
      const actual_cost = shares * t.current_price
      const leftover = allocated - actual_cost
      const est_annual_div = shares * t.dps_display
      return { ...t, weight_pct, allocated, shares, actual_cost, leftover, est_annual_div }
    })
    .sort((a, b) => b.weight_pct - a.weight_pct)
}

// ---------------------------------------------------------------------------
// DIVIDEND TRACKER
// ---------------------------------------------------------------------------

export type DividendRow = {
  ticker: string
  company_name: string | null
  quantity: number
  dps: number | null         // native currency per share
  dividend_yield: number | null
  currency: string | null
  annual_div: number | null  // native currency
  monthly_div: number | null // native currency
}

// ---------------------------------------------------------------------------
// DCF — Discounted Cash Flow (Gordon Growth Model terminal value)
// ---------------------------------------------------------------------------

export type DCFInputs = {
  freeCashFlow: number       // latest annual FCF in native currency
  sharesOutstanding: number
  growthRate: number         // decimal, e.g. 0.10 for 10%
  discountRate: number       // decimal, e.g. 0.10 for 10%
  years: number              // integer projection horizon
}

export type DCFResult = {
  pv: number                 // total present value (FCF years + terminal)
  terminalValue: number      // PV of terminal value
  intrinsicPerShare: number  // pv / sharesOutstanding, native currency
  years: Array<{
    year: number
    fcf: number              // projected FCF for this year
    discountedFcf: number    // PV of that FCF
    cumulativePv: number     // running sum of discounted FCFs so far
  }>
}

const TERMINAL_GROWTH_RATE = 0.03

/**
 * DCF intrinsic value using Gordon Growth Model terminal value.
 * Returns null when discount rate ≤ terminal growth rate (3%) or inputs are invalid.
 */
export function calculateDCF(inputs: DCFInputs): DCFResult | null {
  const { freeCashFlow, sharesOutstanding, growthRate, discountRate, years } = inputs
  if (!isValid(freeCashFlow, sharesOutstanding, growthRate, discountRate, years)) return null
  if (sharesOutstanding <= 0 || discountRate <= TERMINAL_GROWTH_RATE) return null

  const yearRows: DCFResult['years'] = []
  let cumulativePv = 0

  for (let y = 1; y <= years; y++) {
    const fcf = freeCashFlow * Math.pow(1 + growthRate, y)
    const discountedFcf = fcf / Math.pow(1 + discountRate, y)
    cumulativePv += discountedFcf
    yearRows.push({ year: y, fcf, discountedFcf, cumulativePv })
  }

  const terminalFcf = freeCashFlow * Math.pow(1 + growthRate, years + 1)
  const terminalValue = terminalFcf / ((discountRate - TERMINAL_GROWTH_RATE) * Math.pow(1 + discountRate, years))
  const totalPv = cumulativePv + terminalValue

  return {
    pv: totalPv,
    terminalValue,
    intrinsicPerShare: totalPv / sharesOutstanding,
    years: yearRows,
  }
}

/**
 * Compute per-ticker annual/monthly dividend estimates from portfolio positions.
 * All monetary values are in each ticker's native currency; callers convert for display.
 * Uses dps from DB when available; falls back to dividend_yield × current_price.
 */
export function calculateMonthlyDividends(
  positions: Array<{
    ticker: string
    company_name: string | null
    quantity: number
    dps: number | null
    dividend_yield: number | null
    current_price: number | null
    currency: string | null
  }>
): DividendRow[] {
  return positions.map((p) => {
    const effectiveDps =
      p.dps ??
      (p.dividend_yield != null && p.current_price != null
        ? p.dividend_yield * p.current_price
        : null)
    const annual_div = effectiveDps != null ? p.quantity * effectiveDps : null
    const monthly_div = annual_div != null ? annual_div / 12 : null
    return {
      ticker: p.ticker,
      company_name: p.company_name,
      quantity: p.quantity,
      dps: effectiveDps,
      dividend_yield: p.dividend_yield,
      currency: p.currency,
      annual_div,
      monthly_div,
    }
  })
}
