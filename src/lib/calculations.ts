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

// ***************************************************************************
// GRAHAM VALUATION MODULE
// ***************************************************************************

export function calcIntrinsicValue(
  eps?: number | null,
  bookValuePerShare?: number | null
): number | null {
  if (typeof eps !== 'number' || typeof bookValuePerShare !== 'number') return null;
  if (eps <= 0 || bookValuePerShare <= 0) return null;
  return Math.sqrt(22.5 * eps * bookValuePerShare);
}

export function calcFairValue(
  eps?: number | null,
  earningsGrowth5y?: number | null
): number | null {
  if (typeof eps !== 'number' || typeof earningsGrowth5y !== 'number') return null;
  if (eps <= 0) return null;
  const gBounded = Math.max(0, Math.min(earningsGrowth5y, 0.25));
  return eps * (8.5 + 2 * (gBounded * 100));
}

export function calcMarginOfSafety(
  fairValue?: number | null,
  currentPrice?: number | null
): number | null {
  if (typeof fairValue !== 'number' || typeof currentPrice !== 'number') return null;
  if (currentPrice <= 0 || fairValue <= 0) return null;
  return 1 - (currentPrice / fairValue);
}

export function calcIntrinsicUpside(
  intrinsicValue?: number | null,
  currentPrice?: number | null
): number | null {
  if (typeof intrinsicValue !== 'number' || typeof currentPrice !== 'number') return null;
  if (currentPrice <= 0 || intrinsicValue <= 0) return null;
  return (intrinsicValue / currentPrice) - 1;
}

export function calcSafetyColor(
  marginOfSafety?: number | null
): 'green' | 'yellow' | 'red' | null {
  if (typeof marginOfSafety !== 'number') return null;
  if (marginOfSafety > 0.30) return 'green';
  if (marginOfSafety >= 0.10) return 'yellow';
  return 'red';
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
  warning?: string           // set when output fails a sanity check
  years: Array<{
    year: number
    fcf: number              // projected FCF for this year
    discountedFcf: number    // PV of that FCF
    cumulativePv: number     // running sum of discounted FCFs so far
  }>
}

// ---------------------------------------------------------------------------
// DCF APPLICABILITY — sector-based exclusions
// ---------------------------------------------------------------------------

export type ValuationExclusion =
  | 'BANK'       // banks: deposits inflate FCF
  | 'INSURANCE'  // insurers: float/reserves inflate FCF
  | 'REIT'       // REITs/FIIs: use FFO/AFFO instead
  | 'HOLDING'    // holdings: look-through valuation needed
  | 'NONE'

export interface DCFApplicability {
  applicable: boolean
  exclusion: ValuationExclusion
  reason: string       // user-facing PT-BR explanation
  alternative: string  // suggested alternative method
}

const DCF_APPLICABLE: DCFApplicability = {
  applicable: true,
  exclusion: 'NONE',
  reason: '',
  alternative: '',
}

/**
 * Determine whether standard FCF-based DCF (and EBIT-based metrics) apply to a
 * ticker. Banks, insurers, REITs/FIIs and consolidated holdings report cash
 * flows (deposits, float, rental income) that are not free cash flow to equity,
 * so DCF produces meaningless results for them.
 */
export function checkDCFApplicability(
  sector: string | null,
  industry: string | null,
  ticker?: string | null,
): DCFApplicability {
  const s = sector ?? ''
  const ind = industry ?? ''
  const tk = ticker ?? ''

  if (/financial/i.test(s) && /bank|banks—|capital markets/i.test(ind)) {
    return {
      applicable: false,
      exclusion: 'BANK',
      reason: 'Bancos têm fluxo de caixa dominado por depósitos e operações de crédito. DCF tradicional não se aplica.',
      alternative: 'Avalie por P/VPA, ROE vs Custo de Capital, e qualidade da carteira de crédito.',
    }
  }

  if (/insurance/i.test(ind) || /reinsurance/i.test(ind)) {
    return {
      applicable: false,
      exclusion: 'INSURANCE',
      reason: 'Seguradoras geram fluxo de caixa via prêmios e reservas (float), que não representam caixa livre para acionistas.',
      alternative: 'Avalie por P/VPA, Combined Ratio, e qualidade dos investimentos do float.',
    }
  }

  if (/reit|real estate/i.test(ind) || /11\.SA$/i.test(tk)) {
    return {
      applicable: false,
      exclusion: 'REIT',
      reason: 'REITs e FIIs reportam FFO (Funds From Operations) em vez de FCF tradicional. Métricas baseadas em EBIT também não se aplicam.',
      alternative: 'Avalie por P/FFO, Dividend Yield, e Cap Rate.',
    }
  }

  if (/asset management|holding|diversified financial/i.test(ind)) {
    return {
      applicable: false,
      exclusion: 'HOLDING',
      reason: 'Holdings consolidadas distorcem indicadores operacionais. Recomenda-se análise look-through.',
      alternative: 'Avalie cada subsidiária separadamente quando possível.',
    }
  }

  return { ...DCF_APPLICABLE }
}

const TERMINAL_GROWTH_RATE = 0.03
const DCF_SANITY_HIGH = 10   // intrinsic > 10× price → suspect
const DCF_SANITY_LOW = 0.1   // intrinsic < 0.1× price → suspect

/**
 * DCF intrinsic value using Gordon Growth Model terminal value.
 * Returns null when the sector excludes DCF, the discount rate ≤ terminal
 * growth rate (3%), or inputs are invalid. When the output is implausible
 * relative to currentPrice, the result carries a `warning` (but is still
 * returned so the caller can show it with context).
 */
export function calculateDCF(
  inputs: DCFInputs,
  currentPrice: number,
  applicability: DCFApplicability = DCF_APPLICABLE,
): DCFResult | null {
  if (applicability.applicable === false) return null

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
  const intrinsicPerShare = totalPv / sharesOutstanding

  let warning: string | undefined
  if (isValid(currentPrice) && currentPrice > 0) {
    const sanityRatio = intrinsicPerShare / currentPrice
    if (sanityRatio > DCF_SANITY_HIGH) {
      warning = 'DCF produziu valor mais de 10× o preço atual. Provável distorção por FCF inflado, crescimento elevado, ou setor inadequado para este modelo. Verifique os inputs.'
    } else if (sanityRatio < DCF_SANITY_LOW) {
      warning = 'DCF produziu valor menos de 10% do preço atual. Empresa pode estar precificada por ativos intangíveis ou expectativas não capturadas pelo FCF histórico.'
    }
  }

  return {
    pv: totalPv,
    terminalValue,
    intrinsicPerShare,
    ...(warning ? { warning } : {}),
    years: yearRows,
  }
}

// ---------------------------------------------------------------------------
// EV/EBITDA RELATIVE VALUATION
// ---------------------------------------------------------------------------

export type EVEBITDARelativeResult = {
  tickerValue: number
  sectorMedian: number
  sectorMin: number
  sectorMax: number
  sectorCount: number
  premium: number   // decimal: (tickerValue / sectorMedian) - 1
  signal: 'CHEAP' | 'FAIR' | 'EXPENSIVE'
}

/**
 * EV/EBITDA relative valuation vs sector peers.
 * Returns null when tickerValue is invalid or fewer than 3 peer values are provided.
 */
export function calcEVEBITDARelative(
  tickerEVEBITDA: number | null | undefined,
  peerValues: number[],
): EVEBITDARelativeResult | null {
  if (!isValid(tickerEVEBITDA)) return null
  const valid = peerValues.filter((v) => isFinite(v) && v > 0)
  if (valid.length < 3) return null
  const sorted = [...valid].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const sectorMedian = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
  const premium = tickerEVEBITDA! / sectorMedian - 1
  const signal: EVEBITDARelativeResult['signal'] =
    premium < -0.20 ? 'CHEAP' : premium > 0.20 ? 'EXPENSIVE' : 'FAIR'
  return {
    tickerValue: tickerEVEBITDA!,
    sectorMedian,
    sectorMin: sorted[0],
    sectorMax: sorted[sorted.length - 1],
    sectorCount: sorted.length,
    premium,
    signal,
  }
}

// ---------------------------------------------------------------------------
// DDM — Dividend Discount Model (Gordon Growth Model)
// ---------------------------------------------------------------------------

export type DDMResult = {
  fairPrice: number
  dps: number
  ke: number
  g: number
  upside: number  // decimal: (fairPrice / currentPrice) - 1
  signal: 'COMPRA' | 'NEUTRO' | 'NÃO COMPRA'
}

/**
 * Gordon Growth DDM: fairPrice = DPS / (ke - g).
 * g is capped at min(earningsGrowth5y ?? 0, 0.25).
 * Returns null when DPS is null/≤0, ke ≤ g, or currentPrice ≤ 0.
 */
export function calcDDM(
  dps: number | null | undefined,
  earningsGrowth5y: number | null | undefined,
  ke: number,
  currentPrice: number | null | undefined,
): DDMResult | null {
  if (!isValid(dps, currentPrice)) return null
  if (dps! <= 0 || currentPrice! <= 0) return null
  const g = Math.min(earningsGrowth5y != null ? Math.max(earningsGrowth5y, 0) : 0, 0.25)
  if (ke <= g) return null
  const fairPrice = dps! / (ke - g)
  const upside = fairPrice / currentPrice! - 1
  const signal: DDMResult['signal'] =
    upside > 0.15 ? 'COMPRA' : upside < -0.15 ? 'NÃO COMPRA' : 'NEUTRO'
  return { fairPrice, dps: dps!, ke, g, upside, signal }
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

// ---------------------------------------------------------------------------
// SHARED DATA SHAPES (for profile / quality scoring)
// ---------------------------------------------------------------------------

/** Subset of stock_fundamentals fields consumed by profiling & quality scoring. */
export type StockFundamentals = {
  eps: number | null
  book_value_per_share: number | null
  dps: number | null
  ev_ebitda: number | null
  dividend_yield: number | null
  payout_avg: number | null
  revenue_growth_yoy: number | null
  earnings_growth_5y: number | null
  net_debt_ebit: number | null
  roe: number | null
  free_cash_flow: number | null
  shares_outstanding: number | null
}

/** Subset of analyst_data fields consumed by quality scoring. */
export type AnalystData = {
  target_mean: number | null
  rec_strong_buy: number | null
  rec_buy: number | null
  rec_hold: number | null
  rec_underperform: number | null
  rec_sell: number | null
}

// ---------------------------------------------------------------------------
// COMPANY PROFILE DETECTION
// ---------------------------------------------------------------------------

export type CompanyProfile =
  | 'DIVIDEND_PAYER'
  | 'HIGH_YIELD'
  | 'GROWTH'
  | 'MATURE'
  | 'DISTRESSED'
  | 'UNCLASSIFIED'

export interface ProfileResult {
  profile: CompanyProfile
  label: string
  description: string
  paysDividend: boolean
}

const PROFILE_META: Record<CompanyProfile, { label: string; description: string }> = {
  DIVIDEND_PAYER: { label: 'Pagadora de Dividendos', description: 'DY moderado, payout sustentável' },
  HIGH_YIELD:     { label: 'Alto Yield',             description: 'Foco em distribuição (Bazin/Aposentadoria)' },
  GROWTH:         { label: 'Crescimento',            description: 'Reinveste lucros, baixo dividendo' },
  MATURE:         { label: 'Madura',                 description: 'Estável, crescimento limitado' },
  DISTRESSED:     { label: 'Atenção',                description: 'Resultado negativo ou alto endividamento' },
  UNCLASSIFIED:   { label: 'Não Classificada',       description: 'Dados insuficientes para classificação' },
}

/**
 * Detect a company profile from fundamentals. First match wins, evaluated in order:
 * DISTRESSED → HIGH_YIELD → DIVIDEND_PAYER → GROWTH → MATURE → UNCLASSIFIED.
 */
export function detectCompanyProfile(fundamentals: {
  dividend_yield: number | null
  payout_avg: number | null
  revenue_growth_yoy: number | null
  eps: number | null
  net_debt_ebit: number | null
}): ProfileResult {
  const { dividend_yield: dy, payout_avg: payout, revenue_growth_yoy: revG, eps, net_debt_ebit: nde } = fundamentals
  const paysDividend = dy != null && dy > 0.01

  let profile: CompanyProfile
  if ((eps != null && eps <= 0) || (nde != null && nde > 5)) {
    profile = 'DISTRESSED'
  } else if (dy != null && dy >= 0.06) {
    profile = 'HIGH_YIELD'
  } else if (dy != null && dy >= 0.02 && payout != null && payout >= 0.20 && payout <= 0.80) {
    profile = 'DIVIDEND_PAYER'
  } else if (dy != null && dy < 0.02 && revG != null && revG >= 0.15) {
    profile = 'GROWTH'
  } else if (dy != null && dy < 0.02 && revG != null && revG < 0.05) {
    profile = 'MATURE'
  } else {
    profile = 'UNCLASSIFIED'
  }

  return { profile, label: PROFILE_META[profile].label, description: PROFILE_META[profile].description, paysDividend }
}

// ---------------------------------------------------------------------------
// DATA QUALITY SCORE
// ---------------------------------------------------------------------------

export interface DataQualityResult {
  score: number      // 0-100
  level: 'HIGH' | 'MEDIUM' | 'LOW'
  missingFields: string[]
}

/**
 * Data completeness score (10 fields × 10 points = 0-100).
 * missingFields lists the user-facing names of fields that scored 0.
 */
export function calcDataQuality(
  fundamentals: StockFundamentals,
  analystData: AnalystData | null,
  sectorPeerCount: number,
  hasSector: boolean,
): DataQualityResult {
  const checks: { name: string; ok: boolean }[] = [
    { name: 'LPA (EPS)',          ok: fundamentals.eps != null && fundamentals.eps > 0 },
    { name: 'VPA',                ok: fundamentals.book_value_per_share != null },
    { name: 'Crescimento 5 anos', ok: fundamentals.earnings_growth_5y != null },
    { name: 'Fluxo de Caixa Livre', ok: fundamentals.free_cash_flow != null && fundamentals.free_cash_flow > 0 },
    { name: 'EV/EBITDA',          ok: fundamentals.ev_ebitda != null && fundamentals.ev_ebitda > 0 },
    { name: 'Dividend Yield',     ok: fundamentals.dividend_yield != null },
    { name: 'ROE',                ok: fundamentals.roe != null },
    { name: 'Dados de Analistas', ok: analystData != null && analystData.target_mean != null },
    { name: 'Setor',              ok: hasSector },
    { name: 'Pares do Setor (≥5)', ok: sectorPeerCount >= 5 },
  ]
  const score = checks.reduce((s, c) => s + (c.ok ? 10 : 0), 0)
  const level: DataQualityResult['level'] = score >= 80 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW'
  const missingFields = checks.filter((c) => !c.ok).map((c) => c.name)
  return { score, level, missingFields }
}

// ---------------------------------------------------------------------------
// QUALITY SCORE (composite)
// ---------------------------------------------------------------------------

export interface ComponentScore {
  name: string
  score: number | null
  weight: number
  applicable: boolean
  signal: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'N/A'
}

export interface QualityScoreResult {
  score: number
  category: 'EXCELENTE' | 'BOM' | 'NEUTRO' | 'CAUTELA' | 'EVITAR'
  stars: 1 | 2 | 3 | 4 | 5
  color: 'green-dark' | 'green' | 'yellow' | 'orange' | 'red'
  components: ComponentScore[]
  consistencyMultiplier: number
  dataQualityMultiplier: number
  profile: CompanyProfile
  warning: string | null
}

type ComponentKey = 'bazin' | 'graham' | 'dcf' | 'relative' | 'ddm' | 'analyst'

const QUALITY_WEIGHTS: Record<CompanyProfile, Record<ComponentKey, number>> = {
  DIVIDEND_PAYER: { bazin: 0.20, graham: 0.20, dcf: 0.20, relative: 0.15, ddm: 0.15, analyst: 0.10 },
  HIGH_YIELD:     { bazin: 0.25, graham: 0.15, dcf: 0.10, relative: 0.15, ddm: 0.25, analyst: 0.10 },
  GROWTH:         { bazin: 0.00, graham: 0.00, dcf: 0.40, relative: 0.25, ddm: 0.00, analyst: 0.35 },
  MATURE:         { bazin: 0.10, graham: 0.20, dcf: 0.20, relative: 0.20, ddm: 0.20, analyst: 0.10 },
  DISTRESSED:     { bazin: 0.00, graham: 0.00, dcf: 0.00, relative: 0.30, ddm: 0.00, analyst: 0.20 },
  // equal weights across applicable components
  UNCLASSIFIED:   { bazin: 1, graham: 1, dcf: 1, relative: 1, ddm: 1, analyst: 1 },
}

const COMPONENT_LABELS: Record<ComponentKey, string> = {
  bazin: 'Bazin', graham: 'Graham', dcf: 'DCF', relative: 'Relativo', ddm: 'DDM', analyst: 'Analyst',
}

function componentSignal(applicable: boolean, score: number | null): ComponentScore['signal'] {
  if (!applicable || score == null) return 'N/A'
  if (score >= 60) return 'POSITIVE'
  if (score < 40) return 'NEGATIVE'
  return 'NEUTRAL'
}

const QUALITY_CATEGORY: Array<{
  min: number
  category: QualityScoreResult['category']
  stars: QualityScoreResult['stars']
  color: QualityScoreResult['color']
}> = [
  { min: 90, category: 'EXCELENTE', stars: 5, color: 'green-dark' },
  { min: 70, category: 'BOM',       stars: 4, color: 'green' },
  { min: 50, category: 'NEUTRO',    stars: 3, color: 'yellow' },
  { min: 30, category: 'CAUTELA',   stars: 2, color: 'orange' },
  { min: 0,  category: 'EVITAR',    stars: 1, color: 'red' },
]

function categorize(score: number) {
  return QUALITY_CATEGORY.find((c) => score >= c.min) ?? QUALITY_CATEGORY[QUALITY_CATEGORY.length - 1]
}

/**
 * Composite quality score (0-120) aggregating Bazin, Graham, DCF, EV/EBITDA relative,
 * DDM and analyst signals. Weights adjust by company profile; methods structurally
 * irrelevant for a profile are excluded. Final score is scaled by a consistency
 * multiplier (method agreement) and a data-quality multiplier.
 */
export function calcQualityScore(input: {
  fundamentals: StockFundamentals
  price: number
  analystData: AnalystData | null
  dcfResult: DCFResult | null
  evEbitdaRelative: EVEBITDARelativeResult | null
  ddmResult: DDMResult | null
  dataQuality: DataQualityResult
  profile: CompanyProfile
  /** When DCF is excluded for the sector, its component is dropped and its weight redistributed. */
  dcfApplicability?: DCFApplicability
}): QualityScoreResult {
  const { fundamentals: f, price, analystData, dcfResult, evEbitdaRelative, ddmResult, dataQuality, profile, dcfApplicability } = input
  const weights = QUALITY_WEIGHTS[profile]
  const paysDividend = f.dividend_yield != null && f.dividend_yield > 0.01

  // --- bazin ---
  const bazinApplicable = profile !== 'GROWTH' && profile !== 'MATURE'
  let bazinScore: number | null = null
  if (bazinApplicable) {
    const sig = calcBazinSignal(f.dividend_yield, price)
    bazinScore = sig === 'COMPRA' ? 100 : sig === 'NÃO COMPRA' ? 0 : null
  }

  // --- graham ---
  const grahamApplicable = profile !== 'GROWTH' && profile !== 'DISTRESSED'
  let grahamScore: number | null = null
  if (grahamApplicable) {
    const fair = calcFairValue(f.eps, f.earnings_growth_5y)
    const mos = calcMarginOfSafety(fair, price)
    grahamScore = mos != null ? Math.max(0, Math.min(mos * 200, 100)) : null
  }

  // --- dcf ---
  const sectorAllowsDcf = dcfApplicability ? dcfApplicability.applicable : true
  const dcfApplicable = profile !== 'DISTRESSED' && sectorAllowsDcf
  let dcfScore: number | null = null
  if (dcfApplicable && dcfResult != null) {
    const upside = calcIntrinsicUpside(dcfResult.intrinsicPerShare, price)
    dcfScore = upside != null ? Math.max(0, Math.min(upside * 100, 100)) : null
  }

  // --- relative (EV/EBITDA vs sector) ---
  const relativeApplicable = true
  let relativeScore: number | null = null
  if (evEbitdaRelative != null) {
    relativeScore = evEbitdaRelative.signal === 'CHEAP' ? 100 : evEbitdaRelative.signal === 'FAIR' ? 50 : 0
  }

  // --- ddm ---
  const ddmApplicable = profile !== 'GROWTH' && profile !== 'DISTRESSED' && paysDividend
  let ddmScore: number | null = null
  if (ddmApplicable && ddmResult != null) {
    ddmScore = ddmResult.signal === 'COMPRA' ? 100 : ddmResult.signal === 'NEUTRO' ? 50 : 0
  }

  // --- analyst ---
  const analystApplicable = true
  let analystScore: number | null = null
  if (analystData != null) {
    const sb = analystData.rec_strong_buy ?? 0
    const b = analystData.rec_buy ?? 0
    const h = analystData.rec_hold ?? 0
    const u = analystData.rec_underperform ?? 0
    const s = analystData.rec_sell ?? 0
    const total = sb + b + h + u + s
    if (total > 0) {
      analystScore = (sb * 100 + b * 75 + h * 50 + u * 25 + s * 0) / total
    }
  }

  const raw: Array<{ key: ComponentKey; score: number | null; applicable: boolean }> = [
    { key: 'bazin',    score: bazinScore,    applicable: bazinApplicable },
    { key: 'graham',   score: grahamScore,   applicable: grahamApplicable },
    { key: 'dcf',      score: dcfScore,      applicable: dcfApplicable },
    { key: 'relative', score: relativeScore, applicable: relativeApplicable },
    { key: 'ddm',      score: ddmScore,      applicable: ddmApplicable },
    { key: 'analyst',  score: analystScore,  applicable: analystApplicable },
  ]

  const components: ComponentScore[] = raw.map((c) => ({
    name: COMPONENT_LABELS[c.key],
    score: c.applicable ? c.score : null,
    weight: weights[c.key],
    applicable: c.applicable,
    signal: componentSignal(c.applicable, c.applicable ? c.score : null),
  }))

  const applicableComponents = components.filter((c) => c.applicable && c.score != null)
  const totalWeight = applicableComponents.reduce((s, c) => s + c.weight, 0)
  const dataQualityMultiplier = dataQuality.score / 100

  // Insufficient components → score 0
  if (applicableComponents.length < 2 || totalWeight === 0) {
    const cat = categorize(0)
    return {
      score: 0,
      category: cat.category,
      stars: cat.stars,
      color: cat.color,
      components,
      consistencyMultiplier: 1,
      dataQualityMultiplier,
      profile,
      warning: 'Componentes insuficientes para uma avaliação confiável.',
    }
  }

  const baseScore = applicableComponents.reduce(
    (s, c) => s + (c.score as number) * (c.weight / totalWeight),
    0,
  )

  // Consistency multiplier
  const positiveComponents = applicableComponents.filter((c) => (c.score as number) > 60)
  const agreementRatio = positiveComponents.length / applicableComponents.length
  const consistencyMultiplier = agreementRatio > 0.66 ? 1.2 : agreementRatio > 0.33 ? 1.0 : 0.8

  const finalScore = Math.min(120, baseScore * consistencyMultiplier * dataQualityMultiplier)
  const cat = categorize(finalScore)

  // Warning logic (first applicable message wins)
  let warning: string | null = null
  if (profile === 'DISTRESSED') {
    warning = 'Empresa com indicadores de risco. Score baseado em poucos métodos.'
  } else if (applicableComponents.length < 3) {
    warning = `Apenas ${applicableComponents.length} métodos aplicáveis para este perfil.`
  } else if (dataQuality.level === 'LOW') {
    warning = 'Qualidade dos dados insuficiente. Score com baixa confiabilidade.'
  } else if (consistencyMultiplier === 0.8) {
    warning = 'Métodos divergem nesta avaliação. Revise componentes individualmente.'
  }

  return {
    score: finalScore,
    category: cat.category,
    stars: cat.stars,
    color: cat.color,
    components,
    consistencyMultiplier,
    dataQualityMultiplier,
    profile,
    warning,
  }
}
