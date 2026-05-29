/**
 * Shared client-side assembly for company profiling + quality scoring.
 * Used by the Screener, Dashboard, and Analysis pages so the scoring inputs
 * (DCF, EV/EBITDA relative, DDM) are built consistently everywhere.
 */
import {
  detectCompanyProfile,
  calcDataQuality,
  calcQualityScore,
  calcEVEBITDARelative,
  calcDDM,
  calculateDCF,
  checkDCFApplicability,
  type StockFundamentals,
  type AnalystData,
  type ProfileResult,
  type DataQualityResult,
  type QualityScoreResult,
  type DCFApplicability,
} from './calculations'

/** Default cost of equity for DDM in batch contexts (Analysis lets the user tune it). */
export const DEFAULT_KE = 0.10
/** Default DCF discount rate used for batch scoring (Screener/Dashboard). */
export const DEFAULT_DISCOUNT_RATE = 0.10
/** Default DCF projection horizon used for batch scoring. */
export const DEFAULT_DCF_YEARS = 10

export type QualityComputation = {
  quality: QualityScoreResult
  profileResult: ProfileResult
  dataQuality: DataQualityResult
  dcfApplicability: DCFApplicability
}

/**
 * Build a map of sector → list of positive EV/EBITDA values across the universe.
 * Used to compute each ticker's relative valuation against its sector peers.
 */
export function buildSectorPeerMap(
  rows: Array<{ sector: string | null; ev_ebitda: number | null }>,
): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const r of rows) {
    if (!r.sector || r.ev_ebitda == null || !(r.ev_ebitda > 0)) continue
    const list = map.get(r.sector)
    if (list) list.push(r.ev_ebitda)
    else map.set(r.sector, [r.ev_ebitda])
  }
  return map
}

/**
 * Compute the full quality picture for a single ticker.
 * Returns null when there is no usable price (scoring is meaningless without it).
 */
export function computeQuality(
  fundamentals: StockFundamentals | null,
  price: number | null,
  analyst: AnalystData | null,
  sector: string | null,
  sectorPeerValues: number[],
  industry: string | null = null,
  ticker: string | null = null,
): QualityComputation | null {
  if (fundamentals == null || price == null || price <= 0) return null

  const profileResult = detectCompanyProfile(fundamentals)
  const dcfApplicability = checkDCFApplicability(sector, industry, ticker)

  // EV/EBITDA relative — exclude the ticker's own value from the peer set so it
  // is measured against peers, not itself.
  const peers = sectorPeerValues.filter((v) => v > 0)
  const evEbitdaRelative = calcEVEBITDARelative(fundamentals.ev_ebitda, peers)

  const hasSector = !!sector
  const dataQuality = calcDataQuality(fundamentals, analyst, peers.length, hasSector)

  // DCF — only when the sector allows it and FCF/shares are present and positive.
  const fcf = fundamentals.free_cash_flow
  const shares = fundamentals.shares_outstanding
  let dcfResult = null
  if (dcfApplicability.applicable && fcf != null && fcf > 0 && shares != null && shares > 0) {
    const g = Math.max(0, Math.min(fundamentals.earnings_growth_5y ?? 0.05, 0.25))
    dcfResult = calculateDCF(
      {
        freeCashFlow: fcf,
        sharesOutstanding: shares,
        growthRate: g,
        discountRate: DEFAULT_DISCOUNT_RATE,
        years: DEFAULT_DCF_YEARS,
      },
      price,
      dcfApplicability,
    )
  }

  const ddmResult = calcDDM(fundamentals.dps, fundamentals.earnings_growth_5y, DEFAULT_KE, price)

  const quality = calcQualityScore({
    fundamentals,
    price,
    analystData: analyst,
    dcfResult,
    evEbitdaRelative,
    ddmResult,
    dataQuality,
    profile: profileResult.profile,
    dcfApplicability,
  })

  return { quality, profileResult, dataQuality, dcfApplicability }
}
