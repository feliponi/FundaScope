import { useEffect, useState, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  calcTeto8,
  calcTeto6,
  calcBazinSignal,
  calcIntrinsicValue,
  calcFairValue,
  calcMarginOfSafety,
  calcIntrinsicUpside,
  fmtNumber,
  fmtPct,
  type StockFundamentals,
  type AnalystData,
} from '@/lib/calculations'
import { buildSectorPeerMap, computeQuality, type QualityComputation } from '@/lib/quality'
import { useCurrency } from '@/lib/currency'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { QualityScoreBadge, ProfileBadge, DataQualityIcon, ComponentIcons } from '@/components/quality'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ChevronUp, ChevronDown, ChevronsUpDown, Plus, Filter, ChevronLeft, ChevronRight, StickyNote, Info, X } from 'lucide-react'

type ScreenerRow = {
  ticker: string
  company_name: string | null
  sector: string | null
  currency: string | null
  price: number | null
  dividend_yield: number | null
  eps: number | null
  book_value_per_share: number | null
  earnings_growth_5y: number | null
  pe: number | null
  pb: number | null
  payout_avg: number | null
  roe: number | null
  roic: number | null
  current_ratio: number | null
  ev_ebit: number | null
  debt_equity: number | null
  has_fundamentals: boolean
  // Fields needed for quality scoring
  fundamentals: StockFundamentals | null
}

type SortKey = string
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 50

function SortIcon({ col, sortKey, sortDir }: { col: string; sortKey: string; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-1 opacity-40" />
  return sortDir === 'asc'
    ? <ChevronUp className="inline h-3 w-3 ml-1" />
    : <ChevronDown className="inline h-3 w-3 ml-1" />
}

function Th({
  col,
  label,
  sortKey,
  sortDir,
  onSort,
  className = '',
  tooltip,
}: {
  col: string
  label: string
  sortKey: string
  sortDir: SortDir
  onSort: (col: string) => void
  className?: string
  tooltip?: string
}) {
  return (
    <th
      className={`px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:text-foreground ${className}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center">
        {label}
        <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
        {tooltip && (
          <span
            className="group relative inline-flex items-center ml-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
            <span className="pointer-events-none absolute z-50 top-full mt-1 left-0 w-[280px] rounded border bg-popover px-3 py-2 text-xs font-normal normal-case tracking-normal text-popover-foreground shadow-lg whitespace-normal leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              {tooltip}
            </span>
          </span>
        )}
      </span>
    </th>
  )
}

export default function Screener() {
  const [rows, setRows] = useState<ScreenerRow[]>([])
  const [analystMap, setAnalystMap] = useState<Map<string, AnalystData>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchParams, setSearchParams] = useSearchParams()
  const minScoreParam = searchParams.get('minScore')
  const minScore = minScoreParam != null ? parseFloat(minScoreParam) : null

  // Filters
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({
    peMin: '', peMax: '',
    pbMin: '', pbMax: '',
    dyMin: '', dyMax: '',
    roeMin: '', roeMax: '',
    roicMin: '', roicMax: '',
  })

  // Sorting — default to Quality Score descending (matches default QUALITY tab)
  const [sortKey, setSortKey] = useState('qualityScore')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Pagination
  const [page, setPage] = useState(0)

  const { fmt } = useCurrency()
  const [notedTickers, setNotedTickers] = useState<Set<string>>(new Set())

  // Add ticker modal
  const [modalOpen, setModalOpen] = useState(false)
  const [newTicker, setNewTicker] = useState('')
  const [addStatus, setAddStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [addLoading, setAddLoading] = useState(false)

  useEffect(() => { fetchData(); fetchNotes() }, [])

  async function fetchNotes() {
    const { data } = await supabase.from('ticker_notes').select('ticker')
    if (data) setNotedTickers(new Set(data.map((r) => r.ticker)))
  }

  async function fetchData() {
    setLoading(true)
    setError(null)

    const { data: tickerData, error: tErr } = await supabase
      .from('tickers')
      .select('ticker, last_update')

    if (tErr) { setError(tErr.message); setLoading(false); return }

    const tickers = tickerData ?? []

    const { data: priceData } = await supabase.from('stock_prices').select('ticker, price')
    const { data: fundData } = await supabase.from('stock_fundamentals').select('*')
    const { data: profileData } = await supabase.from('stock_profiles').select('ticker, company_name, sector, currency')
    const { data: analystRows } = await supabase
      .from('analyst_data')
      .select('ticker, target_mean, rec_strong_buy, rec_buy, rec_hold, rec_underperform, rec_sell')

    const priceMap = new Map((priceData ?? []).map((r) => [r.ticker, r.price]))
    const fundMap = new Map((fundData ?? []).map((r) => [r.ticker, r]))
    const profileMap = new Map((profileData ?? []).map((r) => [r.ticker, r]))

    setAnalystMap(new Map((analystRows ?? []).map((a) => [a.ticker, a as AnalystData])))

    const result: ScreenerRow[] = tickers.map((t) => {
      const f = fundMap.get(t.ticker)
      const p = profileMap.get(t.ticker)
      return {
        ticker: t.ticker,
        company_name: p?.company_name ?? null,
        sector: p?.sector ?? null,
        currency: p?.currency ?? null,
        price: priceMap.get(t.ticker) ?? null,
        dividend_yield: f?.dividend_yield ?? null,
        eps: f?.eps ?? null,
        book_value_per_share: f?.book_value_per_share ?? null,
        earnings_growth_5y: f?.earnings_growth_5y ?? null,
        pe: f?.pe ?? null,
        pb: f?.pb ?? null,
        payout_avg: f?.payout_avg ?? null,
        roe: f?.roe ?? null,
        roic: f?.roic ?? null,
        current_ratio: f?.current_ratio ?? null,
        ev_ebit: f?.ev_ebit ?? null,
        debt_equity: f?.debt_equity ?? null,
        has_fundamentals: !!f,
        fundamentals: f
          ? {
              eps: f.eps ?? null,
              book_value_per_share: f.book_value_per_share ?? null,
              dps: f.dps ?? null,
              ev_ebitda: f.ev_ebitda ?? null,
              dividend_yield: f.dividend_yield ?? null,
              payout_avg: f.payout_avg ?? null,
              revenue_growth_yoy: f.revenue_growth_yoy ?? null,
              earnings_growth_5y: f.earnings_growth_5y ?? null,
              net_debt_ebit: f.net_debt_ebit ?? null,
              roe: f.roe ?? null,
              free_cash_flow: f.free_cash_flow ?? null,
              shares_outstanding: f.shares_outstanding ?? null,
            }
          : null,
      }
    })

    setRows(result)
    setLoading(false)
  }

  function handleSort(col: string) {
    if (sortKey === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(col)
      setSortDir('asc')
    }
    setPage(0)
  }

  function numFilter(value: number | null, minStr: string, maxStr: string): boolean {
    if (value == null) return false
    if (minStr !== '' && value < parseFloat(minStr)) return false
    if (maxStr !== '' && value > parseFloat(maxStr)) return false
    return true
  }

  const enriched = useMemo(() => {
    // Sector EV/EBITDA peer set for relative valuation
    const peerMap = buildSectorPeerMap(rows.map((r) => ({ sector: r.sector, ev_ebitda: r.fundamentals?.ev_ebitda ?? null })))

    return rows.map((r) => {
      const peers = r.sector ? (peerMap.get(r.sector) ?? []) : []
      const comp: QualityComputation | null = computeQuality(
        r.fundamentals,
        r.price,
        analystMap.get(r.ticker) ?? null,
        r.sector,
        peers,
      )
      return {
        ...r,
        teto8: calcTeto8(r.dividend_yield, r.price),
        teto6: calcTeto6(r.dividend_yield, r.price),
        signal: calcBazinSignal(r.dividend_yield, r.price),
        intrinsic: calcIntrinsicValue(r.eps, r.book_value_per_share),
        fair: calcFairValue(r.eps, r.earnings_growth_5y),
        upside: calcIntrinsicUpside(calcIntrinsicValue(r.eps, r.book_value_per_share), r.price),
        margin: calcMarginOfSafety(calcFairValue(r.eps, r.earnings_growth_5y), r.price),
        dyPct: r.dividend_yield != null ? r.dividend_yield * 100 : null,
        // Quality scoring
        comp,
        qualityScore: comp ? comp.quality.score : null,
        profileLabel: comp ? comp.profileResult.label : null,
        dataQualityScore: comp ? comp.dataQuality.score : null,
      }
    })
  }, [rows, analystMap])

  const filtered = useMemo(() => {
    return enriched.filter((r) => {
      const q = search.toLowerCase()
      if (q && !r.ticker.toLowerCase().includes(q) && !(r.company_name ?? '').toLowerCase().includes(q)) return false

      if (minScore != null && (r.qualityScore == null || r.qualityScore < minScore)) return false

      if ((filters.peMin || filters.peMax) && !numFilter(r.pe, filters.peMin, filters.peMax)) return false
      if ((filters.pbMin || filters.pbMax) && !numFilter(r.pb, filters.pbMin, filters.pbMax)) return false
      if ((filters.dyMin || filters.dyMax) && !numFilter(r.dyPct, filters.dyMin, filters.dyMax)) return false
      if ((filters.roeMin || filters.roeMax) && !numFilter(r.roe, filters.roeMin, filters.roeMax)) return false
      if ((filters.roicMin || filters.roicMax) && !numFilter(r.roic, filters.roicMin, filters.roicMax)) return false

      return true
    })
  }, [enriched, search, filters, minScore])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey]
      const bv = (b as Record<string, unknown>)[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string' && typeof bv === 'string')
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const pageCount = Math.ceil(sorted.length / PAGE_SIZE)
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  async function handleAddTicker(e: React.FormEvent) {
    e.preventDefault()
    setAddLoading(true)
    setAddStatus(null)
    const ticker = newTicker.trim().toUpperCase()
    if (!ticker) { setAddStatus({ type: 'error', msg: 'Digite um ticker válido.' }); setAddLoading(false); return }

    const { error: insertError } = await supabase
      .from('tickers')
      .insert({ ticker, last_update: null })

    if (insertError) {
      if (insertError.code === '23505') {
        setAddStatus({ type: 'error', msg: 'Este ticker já existe.' })
      } else {
        setAddStatus({ type: 'error', msg: insertError.message })
      }
    } else {
      setAddStatus({ type: 'success', msg: 'Ticker adicionado. Os dados estarão disponíveis após a próxima atualização do admin.' })
      setNewTicker('')
      fetchData()
    }
    setAddLoading(false)
  }

  const sp = { sortKey, sortDir, onSort: handleSort }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Carregando screener...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-destructive">Erro ao carregar dados: {error}</div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Screener</h1>
        <div className="flex gap-2 flex-wrap items-center">
          <Input
            placeholder="Buscar ticker ou empresa..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            className="w-56"
          />
          <Button variant="outline" size="sm" onClick={() => setShowFilters((v) => !v)}>
            <Filter className="h-4 w-4 mr-1" />
            Filtros
          </Button>
          <Dialog open={modalOpen} onOpenChange={(o) => { setModalOpen(o); if (!o) { setAddStatus(null); setNewTicker('') } }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add Ticker
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Ticker</DialogTitle>
                <DialogDescription>
                  Insira o código do ticker (ex.: PETR4, AAPL). Os dados financeiros serão
                  preenchidos na próxima execução do script de atualização.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddTicker} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-ticker">Ticker</Label>
                  <Input
                    id="new-ticker"
                    placeholder="Ex.: PETR4"
                    value={newTicker}
                    onChange={(e) => setNewTicker(e.target.value)}
                    autoFocus
                  />
                </div>
                {addStatus && (
                  <div className={`rounded-md px-4 py-3 text-sm ${addStatus.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-destructive/10 text-destructive'}`}>
                    {addStatus.msg}
                  </div>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={addLoading}>
                    {addLoading ? 'Adicionando...' : 'Adicionar'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {showFilters && (
        <div className="rounded-lg border bg-card p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {(
            [
              { label: 'P/L', minKey: 'peMin', maxKey: 'peMax' },
              { label: 'P/VPA', minKey: 'pbMin', maxKey: 'pbMax' },
              { label: 'DY%', minKey: 'dyMin', maxKey: 'dyMax' },
              { label: 'ROE', minKey: 'roeMin', maxKey: 'roeMax' },
              { label: 'ROIC', minKey: 'roicMin', maxKey: 'roicMax' },
            ] as const
          ).map(({ label, minKey, maxKey }) => (
            <div key={label} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <div className="flex gap-1">
                <Input
                  className="h-8 text-xs"
                  placeholder="Min"
                  value={filters[minKey]}
                  onChange={(e) => { setFilters((f) => ({ ...f, [minKey]: e.target.value })); setPage(0) }}
                />
                <Input
                  className="h-8 text-xs"
                  placeholder="Max"
                  value={filters[maxKey]}
                  onChange={(e) => { setFilters((f) => ({ ...f, [maxKey]: e.target.value })); setPage(0) }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {minScore != null && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            Quality Score ≥ {minScore}
            <button onClick={() => setSearchParams({}, { replace: true })} className="ml-1 hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        </div>
      )}

      <Tabs defaultValue="quality">
        <TabsList>
          <TabsTrigger value="quality">QUALITY</TabsTrigger>
          <TabsTrigger value="bazin">BAZIN / 3/8</TabsTrigger>
          <TabsTrigger value="graham">GRAHAM</TabsTrigger>
        </TabsList>

        <TabsContent value="quality">
          <div className="rounded-lg border overflow-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <Th col="ticker" label="Ticker" {...sp} />
                  <Th col="company_name" label="Empresa" {...sp} />
                  <Th col="qualityScore" label="Quality Score" {...sp} tooltip="Score composto (0-120) que agrega Bazin, Graham, DCF, Relativo, DDM e Insights de Analistas, ponderados pelo perfil da empresa e pela qualidade dos dados. É um filtro de descoberta, não recomendação de investimento." />
                  <Th col="profileLabel" label="Perfil" {...sp} />
                  <Th col="dataQualityScore" label="Qualidade Dados" {...sp} />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">Componentes</th>
                  <Th col="sector" label="Setor" {...sp} />
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((r) => (
                  <tr key={r.ticker} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        <Link to={`/analysis/${r.ticker}`} className="text-primary hover:underline">{r.ticker}</Link>
                        {notedTickers.has(r.ticker) && (
                          <Link to={`/analysis/${r.ticker}`} title="Tem nota">
                            <StickyNote className="h-3 w-3 text-amber-500" />
                          </Link>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">{r.company_name ?? '-'}</td>
                    <td className="px-3 py-2">{r.comp ? <QualityScoreBadge result={r.comp.quality} /> : '-'}</td>
                    <td className="px-3 py-2">{r.comp ? <ProfileBadge label={r.comp.profileResult.label} description={r.comp.profileResult.description} /> : '-'}</td>
                    <td className="px-3 py-2">{r.comp ? <DataQualityIcon result={r.comp.dataQuality} /> : '-'}</td>
                    <td className="px-3 py-2">{r.comp ? <ComponentIcons components={r.comp.quality.components} /> : '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate">{r.sector ?? '-'}</td>
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Nenhum resultado encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="bazin">
          <div className="rounded-lg border overflow-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <Th col="ticker" label="Ticker" {...sp} />
                  <Th col="company_name" label="Empresa" {...sp} />
                  <Th col="price" label="Preço" {...sp} />
                  <Th col="teto8" label="Teto 8%" {...sp} />
                  <Th col="teto6" label="Teto 6%" {...sp} />
                  <Th col="signal" label="Sinal 3/8" {...sp} tooltip="Os métodos Bazin e Graham foram desenvolvidos para empresas que pagam dividendos consistentes. Os resultados podem ser enganosos para empresas de tecnologia, crescimento ou intensivas em P&D com baixo ou nenhum dividendo." />
                  <Th col="upside" label="Upside" {...sp} />
                  <Th col="dyPct" label="DY%" {...sp} />
                  <Th col="sector" label="Setor" {...sp} />
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((r) => (
                  <tr key={r.ticker} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        <Link to={`/analysis/${r.ticker}`} className="text-primary hover:underline">
                          {r.ticker}
                        </Link>
                        {notedTickers.has(r.ticker) && (
                          <Link to={`/analysis/${r.ticker}`} title="Tem nota">
                            <StickyNote className="h-3 w-3 text-amber-500" />
                          </Link>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">{r.company_name ?? '-'}</td>
                    <td className="px-3 py-2">{r.price != null ? fmt(r.price, r.currency) : '-'}</td>
                    <td className="px-3 py-2">{r.has_fundamentals ? (r.teto8 != null ? fmt(r.teto8, r.currency) : '-') : '-'}</td>
                    <td className="px-3 py-2">{r.has_fundamentals ? (r.teto6 != null ? fmt(r.teto6, r.currency) : '-') : '-'}</td>
                    <td className="px-3 py-2">
                      {r.has_fundamentals && r.signal ? (
                        <Badge variant={r.signal === 'COMPRA' ? 'success' : 'danger'}>
                          {r.signal}
                        </Badge>
                      ) : '-'}
                    </td>
                    <td className={`px-3 py-2 ${r.upside != null && r.upside > 0 ? 'text-green-600' : r.upside != null ? 'text-red-600' : ''}`}>
                      {r.has_fundamentals ? (r.upside != null ? fmtPct(r.upside) : '-') : '-'}
                    </td>
                    <td className="px-3 py-2">{r.dyPct != null ? `${r.dyPct.toFixed(2)}%` : '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate">{r.sector ?? '-'}</td>
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Nenhum resultado encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="graham">
          <div className="rounded-lg border overflow-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <Th col="ticker" label="Ticker" {...sp} />
                  <Th col="price" label="Preço" {...sp} />
                  <Th col="intrinsic" label="V. Intrínseco" {...sp} />
                  <Th col="fair" label="V. Justo" {...sp} />
                  <Th col="payout_avg" label="Payout Médio" {...sp} />
                  <Th col="margin" label="Margem Seg." {...sp} tooltip="Os métodos Bazin e Graham foram desenvolvidos para empresas que pagam dividendos consistentes. Os resultados podem ser enganosos para empresas de tecnologia, crescimento ou intensivas em P&D com baixo ou nenhum dividendo." />
                  <Th col="pb" label="P/VPA" {...sp} />
                  <Th col="dyPct" label="DY%" {...sp} />
                  <Th col="pe" label="P/L" {...sp} />
                  <Th col="book_value_per_share" label="VPA" {...sp} />
                  <Th col="ev_ebit" label="EV/EBIT" {...sp} />
                  <Th col="debt_equity" label="DIV.LÍQ/PATRI" {...sp} />
                  <Th col="earnings_growth_5y" label="Lucros 5 Anos" {...sp} />
                  <Th col="roe" label="ROE" {...sp} />
                  <Th col="current_ratio" label="LIQ. CORRENTE" {...sp} />
                  <Th col="roic" label="ROIC" {...sp} />
                  <Th col="eps" label="LPA" {...sp} />
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((r) => {
                  const noData = !r.has_fundamentals
                  const dash = '-'
                  const marginColor = r.margin != null
                    ? r.margin > 0.30 ? 'text-green-600' : r.margin >= 0.10 ? 'text-yellow-600' : 'text-red-600'
                    : ''
                  return (
                    <tr key={r.ticker} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1">
                          <Link to={`/analysis/${r.ticker}`} className="text-primary hover:underline">
                            {r.ticker}
                          </Link>
                          {notedTickers.has(r.ticker) && (
                            <Link to={`/analysis/${r.ticker}`} title="Tem nota">
                              <StickyNote className="h-3 w-3 text-amber-500" />
                            </Link>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2">{r.price != null ? fmt(r.price, r.currency) : dash}</td>
                      <td className="px-3 py-2">{noData ? dash : (r.intrinsic != null ? fmt(r.intrinsic, r.currency) : dash)}</td>
                      <td className="px-3 py-2">{noData ? dash : (r.fair != null ? fmt(r.fair, r.currency) : dash)}</td>
                      <td className="px-3 py-2">{noData ? dash : (r.payout_avg != null ? `${(r.payout_avg * 100).toFixed(1)}%` : dash)}</td>
                      <td className={`px-3 py-2 font-medium ${marginColor}`}>
                        {noData ? dash : (r.margin != null ? fmtPct(r.margin) : dash)}
                      </td>
                      <td className="px-3 py-2">{noData ? dash : fmtNumber(r.pb)}</td>
                      <td className="px-3 py-2">{r.dyPct != null ? `${r.dyPct.toFixed(2)}%` : dash}</td>
                      <td className="px-3 py-2">{noData ? dash : fmtNumber(r.pe)}</td>
                      <td className="px-3 py-2">{noData ? dash : fmtNumber(r.book_value_per_share)}</td>
                      <td className="px-3 py-2">{noData ? dash : fmtNumber(r.ev_ebit)}</td>
                      <td className="px-3 py-2">{noData ? dash : fmtNumber(r.debt_equity)}</td>
                      <td className="px-3 py-2">{noData ? dash : (r.earnings_growth_5y != null ? `${(r.earnings_growth_5y * 100).toFixed(1)}%` : dash)}</td>
                      <td className="px-3 py-2">{noData ? dash : (r.roe != null ? `${(r.roe * 100).toFixed(1)}%` : dash)}</td>
                      <td className="px-3 py-2">{noData ? dash : fmtNumber(r.current_ratio)}</td>
                      <td className="px-3 py-2">{noData ? dash : (r.roic != null ? `${(r.roic * 100).toFixed(1)}%` : dash)}</td>
                      <td className="px-3 py-2">{noData ? dash : fmtNumber(r.eps)}</td>
                    </tr>
                  )
                })}
                {pageRows.length === 0 && (
                  <tr><td colSpan={17} className="px-3 py-8 text-center text-muted-foreground">Nenhum resultado encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{filtered.length} ativo(s) encontrado(s)</span>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>Página {page + 1} de {pageCount}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
