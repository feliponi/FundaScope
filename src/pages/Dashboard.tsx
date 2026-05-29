import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useCurrency } from '@/lib/currency'
import {
  calcCurrentValue,
  calcCostBasis,
  fmtPct,
  type StockFundamentals,
  type AnalystData,
} from '@/lib/calculations'
import { buildSectorPeerMap, computeQuality, type QualityComputation } from '@/lib/quality'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StarRating, ProfileBadge, QualityScoreBadge } from '@/components/quality'
import { ArrowRight, Sparkles, TrendingUp, AlertCircle, Search } from 'lucide-react'

type RawFund = StockFundamentals & { ticker: string }
type ProfileMeta = { ticker: string; company_name: string | null; sector: string | null; industry: string | null; currency: string | null }
type PriceRow = { ticker: string; price: number | null }
type PortfolioPos = { ticker: string; quantity: number; avg_price: number }

type ScoredTicker = {
  ticker: string
  company_name: string | null
  currency: string | null
  price: number | null
  comp: QualityComputation
}

export default function Dashboard() {
  const { fmt, convert, currency } = useCurrency()
  const navigate = useNavigate()

  const [funds, setFunds] = useState<RawFund[]>([])
  const [profiles, setProfiles] = useState<ProfileMeta[]>([])
  const [prices, setPrices] = useState<PriceRow[]>([])
  const [analysts, setAnalysts] = useState<Array<AnalystData & { ticker: string }>>([])
  const [positions, setPositions] = useState<PortfolioPos[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()

    const [fundRes, profRes, priceRes, analystRes, posRes] = await Promise.all([
      supabase.from('stock_fundamentals').select('*'),
      supabase.from('stock_profiles').select('ticker, company_name, sector, industry, currency'),
      supabase.from('stock_prices').select('ticker, price'),
      supabase.from('analyst_data').select('ticker, target_mean, rec_strong_buy, rec_buy, rec_hold, rec_underperform, rec_sell'),
      user
        ? supabase.from('portfolios').select('ticker, quantity, avg_price').eq('user_id', user.id)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (fundRes.error) { setError(fundRes.error.message); setLoading(false); return }

    setFunds((fundRes.data ?? []) as RawFund[])
    setProfiles((profRes.data ?? []) as ProfileMeta[])
    setPrices((priceRes.data ?? []) as PriceRow[])
    setAnalysts((analystRes.data ?? []) as Array<AnalystData & { ticker: string }>)
    setPositions((posRes.data ?? []) as PortfolioPos[])
    setLoading(false)
  }

  // ----- Compute quality scores across the universe (memoized) -----
  const scored = useMemo<Map<string, ScoredTicker>>(() => {
    const profileMap = new Map(profiles.map((p) => [p.ticker, p]))
    const priceMap = new Map(prices.map((p) => [p.ticker, p.price]))
    const analystMap = new Map(analysts.map((a) => [a.ticker, a]))
    const peerMap = buildSectorPeerMap(
      funds.map((f) => ({ sector: profileMap.get(f.ticker)?.sector ?? null, ev_ebitda: f.ev_ebitda })),
    )

    const out = new Map<string, ScoredTicker>()
    for (const f of funds) {
      const prof = profileMap.get(f.ticker)
      const sector = prof?.sector ?? null
      const price = priceMap.get(f.ticker) ?? null
      const peers = sector ? (peerMap.get(sector) ?? []) : []
      const comp = computeQuality(f, price, analystMap.get(f.ticker) ?? null, sector, peers, prof?.industry ?? null, f.ticker)
      if (!comp) continue
      out.set(f.ticker, {
        ticker: f.ticker,
        company_name: prof?.company_name ?? null,
        currency: prof?.currency ?? null,
        price,
        comp,
      })
    }
    return out
  }, [funds, profiles, prices, analysts])

  const heldTickers = useMemo(() => new Set(positions.map((p) => p.ticker)), [positions])

  // ----- Hero counts -----
  const totalTickers = funds.length
  const { nExcellent, nGood } = useMemo(() => {
    let exc = 0, good = 0
    for (const s of scored.values()) {
      const sc = s.comp.quality.score
      if (sc >= 90) exc++
      else if (sc >= 70) good++
    }
    return { nExcellent: exc, nGood: good }
  }, [scored])

  // ----- Portfolio summary -----
  const portfolioSummary = useMemo(() => {
    const priceMap = new Map(prices.map((p) => [p.ticker, p.price]))
    const profileMap = new Map(profiles.map((p) => [p.ticker, p]))
    let totalValue = 0
    let totalCost = 0
    let weightedScoreNumer = 0
    let weightedScoreDenom = 0
    let weightedDqNumer = 0
    let weightedDqDenom = 0

    for (const pos of positions) {
      const cur = profileMap.get(pos.ticker)?.currency ?? 'USD'
      const price = priceMap.get(pos.ticker) ?? null
      const cv = calcCurrentValue(pos.quantity, price)
      const cb = calcCostBasis(pos.quantity, pos.avg_price)
      const cvDisplay = cv != null ? convert(cv, cur) : 0
      totalValue += cvDisplay
      totalCost += cb != null ? convert(cb, cur) : 0

      const s = scored.get(pos.ticker)
      if (s && cvDisplay > 0) {
        weightedScoreNumer += s.comp.quality.score * cvDisplay
        weightedScoreDenom += cvDisplay
        weightedDqNumer += s.comp.dataQuality.score * cvDisplay
        weightedDqDenom += cvDisplay
      }
    }

    const pl = totalValue - totalCost
    const plPct = totalCost > 0 ? pl / totalCost : null
    const avgScore = weightedScoreDenom > 0 ? weightedScoreNumer / weightedScoreDenom : null
    const avgDq = weightedDqDenom > 0 ? weightedDqNumer / weightedDqDenom : null
    return { totalValue, pl, plPct, avgScore, avgDq, hasPositions: positions.length > 0 }
  }, [positions, prices, profiles, scored, convert, currency])

  // ----- Action card lists -----
  const reinforce = useMemo(() => {
    return [...scored.values()]
      .filter((s) => heldTickers.has(s.ticker) && s.comp.quality.score >= 70)
      .sort((a, b) => b.comp.quality.score - a.comp.quality.score)
      .slice(0, 3)
  }, [scored, heldTickers])

  const review = useMemo(() => {
    return [...scored.values()]
      .filter((s) => heldTickers.has(s.ticker) && s.comp.quality.score < 50)
      .sort((a, b) => a.comp.quality.score - b.comp.quality.score)
      .slice(0, 3)
  }, [scored, heldTickers])

  const evaluate = useMemo(() => {
    return [...scored.values()]
      .filter((s) => !heldTickers.has(s.ticker) && s.comp.quality.score >= 90)
      .sort((a, b) => b.comp.quality.score - a.comp.quality.score)
      .slice(0, 3)
  }, [scored, heldTickers])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Carregando dashboard...</div>
      </div>
    )
  }
  if (error) return <div className="p-6 text-destructive">Erro ao carregar dados: {error}</div>

  return (
    <div className="space-y-6">
      {/* ── ZONE 1: HERO ── */}
      <div className="rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 text-white p-8 flex flex-wrap items-center justify-between gap-6">
        <div>
          <div className="text-3xl font-bold">Você monitora {totalTickers} ticker{totalTickers !== 1 ? 's' : ''}</div>
          <div className="mt-3 space-y-1 text-slate-300 text-sm">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
              <strong className="text-white">{nExcellent}</strong> com Quality Score ≥ 90 hoje
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-300" />
              <strong className="text-white">{nGood}</strong> com Quality Score 70–89
            </div>
          </div>
        </div>
        <Button
          size="lg"
          className="bg-white text-slate-900 hover:bg-slate-100"
          onClick={() => navigate('/screener?minScore=70')}
        >
          Ver Oportunidades
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>

      {/* ── ZONE 2: PORTFOLIO SUMMARY ── */}
      <Card>
        <CardContent className="p-5">
          {portfolioSummary.hasPositions ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Valor Atual</div>
                  <div className="text-xl font-bold">{fmt(portfolioSummary.totalValue, currency)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">P&amp;L Total</div>
                  <div className={`text-xl font-bold ${portfolioSummary.pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmt(portfolioSummary.pl, currency)}{portfolioSummary.plPct != null ? ` (${fmtPct(portfolioSummary.plPct)})` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Quality Score Médio</div>
                  <div className="text-xl font-bold">{portfolioSummary.avgScore != null ? Math.round(portfolioSummary.avgScore) : '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Qualidade Dados Médio</div>
                  <div className="text-xl font-bold">{portfolioSummary.avgDq != null ? `${Math.round(portfolioSummary.avgDq)}/100` : '—'}</div>
                </div>
              </div>
              <Link to="/portfolio" className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                Ver Portfólio Completo <ArrowRight className="h-3 w-3" />
              </Link>
            </>
          ) : (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Você ainda não tem posições no portfólio.{' '}
              <Link to="/portfolio" className="text-primary hover:underline">Adicione sua primeira posição →</Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── ZONE 3: ACTION CARDS ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ActionCard
          title="Reforçar"
          subtitle="Tickers do seu portfólio com Quality Score atual ≥ 70"
          accent="border-l-green-500"
          icon={<TrendingUp className="h-4 w-4 text-green-600" />}
          items={reinforce}
          emptyText="Nenhuma posição com Quality Score ≥ 70 no momento."
          onRowClick={(t) => navigate(`/analysis/${t}`)}
        />
        <ActionCard
          title="Revisar"
          subtitle="Posições do portfólio com Quality Score < 50"
          accent="border-l-orange-500"
          icon={<AlertCircle className="h-4 w-4 text-orange-600" />}
          items={review}
          emptyText="Nenhuma posição requer revisão no momento."
          onRowClick={(t) => navigate(`/analysis/${t}`)}
        />
        <ActionCard
          title="Avaliar"
          subtitle="Candidatos fora do portfólio com Quality Score ≥ 90"
          accent="border-l-blue-500"
          icon={<Sparkles className="h-4 w-4 text-blue-600" />}
          items={evaluate}
          emptyText="Nenhum candidato com Excelente Score no universo atual."
          onRowClick={(t) => navigate(`/analysis/${t}`)}
        />
      </div>

      {/* ── ZONE 4: DISCLAIMER ── */}
      <p className="text-xs text-muted-foreground leading-relaxed max-w-4xl">
        ⓘ O Quality Score é um filtro de descoberta baseado em múltiplas metodologias
        (Bazin, Graham, DCF, Relativo, DDM e Insights de Analistas), ponderadas pelo
        perfil da empresa e pela qualidade dos dados disponíveis. Não constitui
        recomendação de investimento. Sempre revise os componentes individuais na
        página de cada ticker antes de qualquer decisão.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Action card
// ---------------------------------------------------------------------------

function ActionCard({
  title, subtitle, accent, icon, items, emptyText, onRowClick,
}: {
  title: string
  subtitle: string
  accent: string
  icon: React.ReactNode
  items: ScoredTicker[]
  emptyText: string
  onRowClick: (ticker: string) => void
}) {
  return (
    <Card className={`border-l-4 ${accent}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">{icon}{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="pt-1">
        {items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Search className="h-4 w-4 opacity-50" />
            {emptyText}
          </div>
        ) : (
          <div className="divide-y">
            {items.map((s) => (
              <button
                key={s.ticker}
                onClick={() => onRowClick(s.ticker)}
                className="w-full flex items-center justify-between gap-2 py-2.5 text-left hover:bg-muted/40 -mx-2 px-2 rounded transition-colors"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm">{s.ticker}</div>
                  <div className="mt-0.5">
                    <ProfileBadge label={s.comp.profileResult.label} description={s.comp.profileResult.description} />
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StarRating stars={s.comp.quality.stars} size={12} />
                  <QualityScoreBadge result={s.comp.quality} showStars={false} />
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
