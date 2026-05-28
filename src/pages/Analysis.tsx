import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  calcTeto8,
  calcTeto6,
  calcBazinSignal,
  calcIntrinsicValue,
  calcFairValue,
  calcUpside,
  calcMarketSafety,
  calcMarginOfSafety,
  calcSafetyColor,
  calcCurrentValue,
  calcCostBasis,
  calcPlAbs,
  calcPlPct,
  fmtPct,
  fmtNumber,
  fmtLargeNumber,
} from '@/lib/calculations'
import { useCurrency } from '@/lib/currency'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ArrowLeft, ExternalLink, Pencil, TrendingUp, TrendingDown, Bell, BellOff, Trash2, GitCompareArrows, X, Check } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Profile = {
  company_name: string | null
  sector: string | null
  industry: string | null
  country: string | null
  currency: string | null
  exchange: string | null
  website: string | null
  description: string | null
  profile_updated_at: string | null
}

type Fundamentals = {
  eps: number | null
  book_value_per_share: number | null
  dps: number | null
  pe: number | null
  pb: number | null
  peg: number | null
  ev_ebitda: number | null
  ev_ebit: number | null
  psr: number | null
  roe: number | null
  roa: number | null
  roic: number | null
  gross_margin: number | null
  ebit_margin: number | null
  net_margin: number | null
  debt_equity: number | null
  current_ratio: number | null
  net_debt_ebit: number | null
  dividend_yield: number | null
  payout_avg: number | null
  earnings_growth_5y: number | null
  revenue_growth_yoy: number | null
  market_cap: number | null
  beta: number | null
  fundamentals_updated_at: string | null
}

type PortfolioPos = { id: string; quantity: number; avg_price: number }

type PriceAlert = {
  id: string
  ticker: string
  target_price: number
  direction: 'above' | 'below'
  is_active: boolean
  created_at: string
}

type ColData = {
  ticker: string
  company_name: string | null
  currency: string | null
  price: number | null
  eps: number | null
  book_value_per_share: number | null
  dps: number | null
  pe: number | null
  pb: number | null
  peg: number | null
  ev_ebit: number | null
  psr: number | null
  roe: number | null
  roa: number | null
  roic: number | null
  gross_margin: number | null
  ebit_margin: number | null
  net_margin: number | null
  debt_equity: number | null
  current_ratio: number | null
  net_debt_ebit: number | null
  dividend_yield: number | null
  payout_avg: number | null
  earnings_growth_5y: number | null
  revenue_growth_yoy: number | null
  market_cap: number | null
  // calculated
  intrinsic: number | null
  fair: number | null
  marginOfSafety: number | null
  marketSafety: number | null
  teto8: number | null
  teto6: number | null
  signal: 'COMPRA' | 'NÃO COMPRA' | null
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${color ?? ''}`}>{value}</span>
    </div>
  )
}

function SafetyIndicator({ value, label }: { value: number | null; label: string }) {
  const color = calcSafetyColor(value)
  const colorClass = color === 'green'
    ? 'bg-green-50 border-green-200 text-green-800'
    : color === 'yellow'
      ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
      : color === 'red'
        ? 'bg-red-50 border-red-200 text-red-800'
        : 'bg-muted border text-muted-foreground'
  return (
    <div className={`rounded-lg border p-4 ${colorClass}`}>
      <div className="text-xs font-medium uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold">{value != null ? `${value.toFixed(1)}%` : '-'}</div>
    </div>
  )
}

function buildColData(
  ticker: string,
  profile: { company_name: string | null; currency: string | null } | null,
  fund: Fundamentals | null,
  price: number | null,
): ColData {
  return {
    ticker,
    company_name: profile?.company_name ?? null,
    currency: profile?.currency ?? null,
    price,
    eps: fund?.eps ?? null,
    book_value_per_share: fund?.book_value_per_share ?? null,
    dps: fund?.dps ?? null,
    pe: fund?.pe ?? null,
    pb: fund?.pb ?? null,
    peg: fund?.peg ?? null,
    ev_ebit: fund?.ev_ebit ?? null,
    psr: fund?.psr ?? null,
    roe: fund?.roe ?? null,
    roa: fund?.roa ?? null,
    roic: fund?.roic ?? null,
    gross_margin: fund?.gross_margin ?? null,
    ebit_margin: fund?.ebit_margin ?? null,
    net_margin: fund?.net_margin ?? null,
    debt_equity: fund?.debt_equity ?? null,
    current_ratio: fund?.current_ratio ?? null,
    net_debt_ebit: fund?.net_debt_ebit ?? null,
    dividend_yield: fund?.dividend_yield ?? null,
    payout_avg: fund?.payout_avg ?? null,
    earnings_growth_5y: fund?.earnings_growth_5y ?? null,
    revenue_growth_yoy: fund?.revenue_growth_yoy ?? null,
    market_cap: fund?.market_cap ?? null,
    intrinsic: calcIntrinsicValue(fund?.eps, fund?.book_value_per_share),
    fair: calcFairValue(fund?.eps, fund?.earnings_growth_5y),
    marginOfSafety: calcMarginOfSafety(
      calcIntrinsicValue(fund?.eps, fund?.book_value_per_share),
      price,
    ),
    marketSafety: calcMarketSafety(calcFairValue(fund?.eps, fund?.earnings_growth_5y), price),
    teto8: calcTeto8(fund?.dividend_yield, price),
    teto6: calcTeto6(fund?.dividend_yield, price),
    signal: calcBazinSignal(fund?.dividend_yield, price),
  }
}

// ---------------------------------------------------------------------------
// Comparison metric definitions
// ---------------------------------------------------------------------------

type MetricDef = {
  section?: string
  label: string
  get: (d: ColData) => number | null
  renderCell: (
    d: ColData,
    fmtFn: (v: number | null | undefined, c: string | null | undefined) => string,
  ) => React.ReactNode
  higherBetter?: boolean
  isSignal?: boolean
}

const COMPARISON_METRICS: MetricDef[] = [
  // Price & Valuation
  { section: 'Preço & Valuation', label: 'Preço Atual', get: (d) => d.price, renderCell: (d, f) => f(d.price, d.currency) },
  { label: 'Market Cap', get: (d) => d.market_cap, renderCell: (d) => fmtLargeNumber(d.market_cap) },
  { label: 'P/L', get: (d) => d.pe, renderCell: (d) => fmtNumber(d.pe), higherBetter: false },
  { label: 'P/VPA', get: (d) => d.pb, renderCell: (d) => fmtNumber(d.pb), higherBetter: false },
  { label: 'PSR', get: (d) => d.psr, renderCell: (d) => fmtNumber(d.psr), higherBetter: false },
  { label: 'EV/EBIT', get: (d) => d.ev_ebit, renderCell: (d) => fmtNumber(d.ev_ebit), higherBetter: false },
  { label: 'PEG', get: (d) => d.peg, renderCell: (d) => fmtNumber(d.peg), higherBetter: false },
  // Graham
  { section: 'Análise Graham', label: 'V. Intrínseco', get: (d) => d.intrinsic, renderCell: (d, f) => f(d.intrinsic, d.currency), higherBetter: true },
  { label: 'V. Justo', get: (d) => d.fair, renderCell: (d, f) => f(d.fair, d.currency), higherBetter: true },
  { label: 'Margem Seg. %', get: (d) => d.marginOfSafety, renderCell: (d) => d.marginOfSafety != null ? `${d.marginOfSafety.toFixed(1)}%` : '—', higherBetter: true },
  { label: 'Seg. Juros Merc. %', get: (d) => d.marketSafety, renderCell: (d) => d.marketSafety != null ? fmtPct(d.marketSafety) : '—', higherBetter: true },
  { label: 'Teto 8% (Bazin)', get: (d) => d.teto8, renderCell: (d, f) => f(d.teto8, d.currency) },
  { label: 'Teto 6% (Bazin)', get: (d) => d.teto6, renderCell: (d, f) => f(d.teto6, d.currency) },
  {
    label: 'Sinal 3/8',
    get: () => null,
    isSignal: true,
    renderCell: (d) =>
      d.signal ? (
        <Badge variant={d.signal === 'COMPRA' ? 'success' : 'danger'} className="text-xs">
          {d.signal}
        </Badge>
      ) : '—',
  },
  // Profitability
  { section: 'Rentabilidade', label: 'ROE', get: (d) => d.roe, renderCell: (d) => d.roe != null ? fmtPct(d.roe) : '—', higherBetter: true },
  { label: 'ROA', get: (d) => d.roa, renderCell: (d) => d.roa != null ? fmtPct(d.roa) : '—', higherBetter: true },
  { label: 'ROIC', get: (d) => d.roic, renderCell: (d) => d.roic != null ? fmtPct(d.roic) : '—', higherBetter: true },
  { label: 'Margem Bruta', get: (d) => d.gross_margin, renderCell: (d) => d.gross_margin != null ? fmtPct(d.gross_margin) : '—', higherBetter: true },
  { label: 'Margem EBIT', get: (d) => d.ebit_margin, renderCell: (d) => d.ebit_margin != null ? fmtPct(d.ebit_margin) : '—', higherBetter: true },
  { label: 'Margem Líquida', get: (d) => d.net_margin, renderCell: (d) => d.net_margin != null ? fmtPct(d.net_margin) : '—', higherBetter: true },
  // Debt & Liquidity
  { section: 'Dívida & Liquidez', label: 'Div./Patri.', get: (d) => d.debt_equity, renderCell: (d) => fmtNumber(d.debt_equity), higherBetter: false },
  { label: 'Liquidez Corrente', get: (d) => d.current_ratio, renderCell: (d) => fmtNumber(d.current_ratio), higherBetter: true },
  { label: 'Dív.Líq/EBIT', get: (d) => d.net_debt_ebit, renderCell: (d) => fmtNumber(d.net_debt_ebit), higherBetter: false },
  // Dividends
  { section: 'Dividendos', label: 'DY %', get: (d) => d.dividend_yield, renderCell: (d) => d.dividend_yield != null ? fmtPct(d.dividend_yield) : '—', higherBetter: true },
  { label: 'DPS', get: (d) => d.dps, renderCell: (d, f) => f(d.dps, d.currency), higherBetter: true },
  { label: 'Payout Médio', get: (d) => d.payout_avg, renderCell: (d) => d.payout_avg != null ? `${(d.payout_avg * 100).toFixed(1)}%` : '—' },
  // Growth
  { section: 'Crescimento', label: 'Lucros 5 Anos', get: (d) => d.earnings_growth_5y, renderCell: (d) => d.earnings_growth_5y != null ? fmtPct(d.earnings_growth_5y) : '—', higherBetter: true },
  { label: 'Receita YoY', get: (d) => d.revenue_growth_yoy, renderCell: (d) => d.revenue_growth_yoy != null ? fmtPct(d.revenue_growth_yoy) : '—', higherBetter: true },
]

// ---------------------------------------------------------------------------
// Comparison table
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Flat table rows for proper section header rendering
// ---------------------------------------------------------------------------

type TableRow =
  | { kind: 'section'; label: string }
  | { kind: 'metric'; metric: MetricDef }

function buildTableRows(): TableRow[] {
  const rows: TableRow[] = []
  for (const metric of COMPARISON_METRICS) {
    if (metric.section) rows.push({ kind: 'section', label: metric.section })
    rows.push({ kind: 'metric', metric })
  }
  return rows
}

const TABLE_ROWS = buildTableRows()

function ComparisonTableV2({ columns, onRemove }: {
  columns: ColData[]
  onRemove: (ticker: string) => void
}) {
  const { fmt } = useCurrency()

  function getBestIdx(metric: MetricDef): number | null {
    if (metric.higherBetter === undefined || metric.isSignal) return null
    const vals = columns.map((d) => metric.get(d))
    const validVals = vals.filter((v): v is number => v != null)
    if (validVals.length < 2) return null
    const best = metric.higherBetter ? Math.max(...validVals) : Math.min(...validVals)
    const firstBestIdx = vals.findIndex((v) => v === best)
    return firstBestIdx
  }

  return (
    <div className="rounded-lg border overflow-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase w-40 sticky left-0 bg-muted/40">Métrica</th>
            {columns.map((col, i) => (
              <th key={col.ticker} className="px-3 py-2 text-left min-w-[120px]">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-bold text-foreground">{col.ticker}</span>
                  {col.company_name && (
                    <span className="text-xs text-muted-foreground truncate max-w-[72px]" title={col.company_name ?? undefined}>
                      {col.company_name.slice(0, 10)}{col.company_name.length > 10 ? '…' : ''}
                    </span>
                  )}
                  {i === 0 && <span className="text-xs text-muted-foreground ml-1">(atual)</span>}
                  {i > 0 && (
                    <button className="ml-auto hover:text-destructive" onClick={() => onRemove(col.ticker)}>
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {TABLE_ROWS.map((row, ri) => {
            if (row.kind === 'section') {
              return (
                <tr key={`s-${ri}`}>
                  <td
                    colSpan={columns.length + 1}
                    className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/30"
                  >
                    {row.label}
                  </td>
                </tr>
              )
            }
            const { metric } = row
            const bestIdx = getBestIdx(metric)
            return (
              <tr key={`m-${ri}`} className="hover:bg-muted/20">
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap sticky left-0 bg-background">
                  {metric.label}
                </td>
                {columns.map((col, ci) => (
                  <td
                    key={col.ticker}
                    className={`px-3 py-2 text-xs font-mono ${bestIdx === ci ? 'text-green-600 font-semibold' : ''}`}
                  >
                    {metric.renderCell(col, fmt)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compare modal
// ---------------------------------------------------------------------------

function CompareModal({
  open,
  onClose,
  currentTicker,
  selected,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  currentTicker: string
  selected: string[]
  onConfirm: (tickers: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<string[]>(selected)
  const [allTickers, setAllTickers] = useState<{ ticker: string; company_name: string | null }[]>([])
  const [loadingTickers, setLoadingTickers] = useState(false)

  useEffect(() => {
    if (!open) return
    setPending(selected)
    setSearch('')
    setLoadingTickers(true)
    supabase
      .from('stock_fundamentals')
      .select('ticker')
      .then(({ data: fundData }) => {
        const fundTickers = new Set((fundData ?? []).map((r) => r.ticker))
        supabase
          .from('stock_profiles')
          .select('ticker, company_name')
          .then(({ data: profileData }) => {
            const list = (profileData ?? [])
              .filter((r) => fundTickers.has(r.ticker) && r.ticker !== currentTicker)
              .sort((a, b) => a.ticker.localeCompare(b.ticker))
            setAllTickers(list)
            setLoadingTickers(false)
          })
      })
  }, [open, currentTicker])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return allTickers
    return allTickers.filter(
      (t) =>
        t.ticker.toLowerCase().includes(q) ||
        (t.company_name ?? '').toLowerCase().includes(q),
    )
  }, [allTickers, search])

  function toggle(ticker: string) {
    setPending((prev) => {
      if (prev.includes(ticker)) return prev.filter((t) => t !== ticker)
      if (prev.length >= 3) return prev
      return [...prev, ticker]
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Comparar com…</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Buscar ticker ou empresa…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {pending.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
                >
                  {t}
                  <button onClick={() => toggle(t)}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Selecione até 3 tickers (selecionados: {pending.length}/3)
          </p>
          <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
            {loadingTickers ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">Carregando…</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhum resultado.</div>
            ) : (
              filtered.slice(0, 100).map((t) => {
                const isSelected = pending.includes(t.ticker)
                const isDisabled = !isSelected && pending.length >= 3
                return (
                  <button
                    key={t.ticker}
                    disabled={isDisabled}
                    onClick={() => toggle(t.ticker)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm transition-colors
                      ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted/40 cursor-pointer'}
                      ${isSelected ? 'bg-primary/5' : ''}`}
                  >
                    <span>
                      <span className="font-medium">{t.ticker}</span>
                      {t.company_name && (
                        <span className="text-muted-foreground ml-2 text-xs">{t.company_name}</span>
                      )}
                    </span>
                    {isSelected && <Check className="h-4 w-4 text-primary" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => { onConfirm(pending); onClose() }}>
            <GitCompareArrows className="h-4 w-4 mr-1" />
            Comparar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Analysis() {
  const { ticker } = useParams<{ ticker: string }>()
  const { fmt } = useCurrency()
  const [searchParams, setSearchParams] = useSearchParams()

  // Core data
  const [profile, setProfile] = useState<Profile | null>(null)
  const [fundamentals, setFundamentals] = useState<Fundamentals | null>(null)
  const [price, setPrice] = useState<number | null>(null)
  const [position, setPosition] = useState<PortfolioPos | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit position
  const [editOpen, setEditOpen] = useState(false)
  const [editQty, setEditQty] = useState('')
  const [editAvg, setEditAvg] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Alerts
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [alertDirection, setAlertDirection] = useState<'above' | 'below'>('above')
  const [alertTarget, setAlertTarget] = useState('')
  const [alertSubmitting, setAlertSubmitting] = useState(false)
  const [alertError, setAlertError] = useState<string | null>(null)

  // Notes
  const [noteContent, setNoteContent] = useState('')
  const [noteSavedAt, setNoteSavedAt] = useState<string | null>(null)
  const [noteSaving, setNoteSaving] = useState(false)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Comparison
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareData, setCompareData] = useState<ColData[]>([])

  const compareTickers = useMemo(() => {
    const param = searchParams.get('compare')
    return param ? param.split(',').filter(Boolean).slice(0, 3) : []
  }, [searchParams])

  useEffect(() => {
    if (ticker) { fetchAll(); fetchAlerts(); fetchNote() }
  }, [ticker])

  useEffect(() => {
    if (compareTickers.length > 0) fetchCompareData(compareTickers)
    else setCompareData([])
  }, [compareTickers.join(',')])

  // ----- Core data -----
  async function fetchAll() {
    setLoading(true)
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()

    const [profileRes, fundRes, priceRes, posRes] = await Promise.all([
      supabase.from('stock_profiles').select('*').eq('ticker', ticker).maybeSingle(),
      supabase.from('stock_fundamentals').select('*').eq('ticker', ticker).maybeSingle(),
      supabase.from('stock_prices').select('price').eq('ticker', ticker).maybeSingle(),
      user
        ? supabase.from('portfolios').select('id, quantity, avg_price').eq('ticker', ticker!).eq('user_id', user.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    if (profileRes.error) { setError(profileRes.error.message); setLoading(false); return }

    setProfile(profileRes.data as Profile | null)
    setFundamentals(fundRes.data as Fundamentals | null)
    setPrice(priceRes.data?.price ?? null)
    setPosition(posRes.data as PortfolioPos | null)
    setLoading(false)
  }

  // ----- Alerts -----
  async function fetchAlerts() {
    const { data } = await supabase
      .from('price_alerts')
      .select('*')
      .eq('ticker', ticker!)
      .order('created_at', { ascending: false })
      .limit(10)
    setAlerts((data ?? []) as PriceAlert[])
  }

  async function handleAddAlert(e: React.FormEvent) {
    e.preventDefault()
    setAlertError(null)
    const target = parseFloat(alertTarget)
    if (!target || target <= 0) { setAlertError('Digite um preço alvo válido.'); return }
    setAlertSubmitting(true)
    const { error: err } = await supabase.from('price_alerts').upsert(
      { ticker: ticker!, target_price: target, direction: alertDirection, is_active: true },
      { onConflict: 'user_id,ticker,direction' },
    )
    if (err) {
      setAlertError(err.message)
    } else {
      setAlertTarget('')
      fetchAlerts()
    }
    setAlertSubmitting(false)
  }

  async function handleDeleteAlert(id: string) {
    await supabase.from('price_alerts').delete().eq('id', id)
    fetchAlerts()
  }

  // ----- Notes -----
  async function fetchNote() {
    const { data } = await supabase
      .from('ticker_notes')
      .select('content, updated_at')
      .eq('ticker', ticker!)
      .maybeSingle()
    if (data) {
      setNoteContent(data.content)
      setNoteSavedAt(data.updated_at)
    } else {
      setNoteContent('')
      setNoteSavedAt(null)
    }
  }

  const saveNote = useCallback(async (content: string) => {
    setNoteSaving(true)
    if (!content.trim()) {
      await supabase.from('ticker_notes').delete().eq('ticker', ticker!)
      setNoteSavedAt(null)
    } else {
      const { data } = await supabase
        .from('ticker_notes')
        .upsert(
          { ticker: ticker!, content, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,ticker' },
        )
        .select('updated_at')
        .maybeSingle()
      if (data) setNoteSavedAt(data.updated_at)
    }
    setNoteSaving(false)
  }, [ticker])

  function handleNoteChange(value: string) {
    setNoteContent(value)
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(() => saveNote(value), 1500)
  }

  function handleNoteBlur() {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    saveNote(noteContent)
  }

  // ----- Comparison -----
  async function fetchCompareData(tickers: string[]) {
    if (tickers.length === 0) { setCompareData([]); return }

    const [fundRes, profileRes, priceRes] = await Promise.all([
      supabase.from('stock_fundamentals').select('*').in('ticker', tickers),
      supabase.from('stock_profiles').select('ticker, company_name, currency').in('ticker', tickers),
      supabase.from('stock_prices').select('ticker, price').in('ticker', tickers),
    ])

    const fundMap = new Map((fundRes.data ?? []).map((r) => [r.ticker, r]))
    const profileMap = new Map((profileRes.data ?? []).map((r) => [r.ticker, r]))
    const priceMap = new Map((priceRes.data ?? []).map((r) => [r.ticker, r.price]))

    setCompareData(
      tickers.map((t) =>
        buildColData(t, profileMap.get(t) ?? null, fundMap.get(t) as Fundamentals ?? null, priceMap.get(t) ?? null),
      ),
    )
  }

  function handleCompareConfirm(tickers: string[]) {
    if (tickers.length === 0) {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ compare: tickers.join(',') }, { replace: true })
    }
  }

  function handleRemoveCompare(t: string) {
    const remaining = compareTickers.filter((c) => c !== t)
    handleCompareConfirm(remaining)
  }

  // ----- Edit position -----
  async function handleEditPosition(e: React.FormEvent) {
    e.preventDefault()
    setEditError(null)
    setEditLoading(true)
    const qty = parseFloat(editQty)
    const avg = parseFloat(editAvg)
    if (!qty || qty <= 0) { setEditError('Quantidade inválida.'); setEditLoading(false); return }
    if (!avg || avg <= 0) { setEditError('Preço médio inválido.'); setEditLoading(false); return }

    const { error: err } = await supabase
      .from('portfolios')
      .update({ quantity: qty, avg_price: avg, updated_at: new Date().toISOString() })
      .eq('id', position!.id)
    if (err) {
      setEditError(err.message)
    } else {
      setEditOpen(false)
      fetchAll()
    }
    setEditLoading(false)
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-muted-foreground">Carregando análise...</div></div>
  if (error) return <div className="p-6 text-destructive">Erro: {error}</div>

  const f = fundamentals
  const intrinsic = calcIntrinsicValue(f?.eps, f?.book_value_per_share)
  const fair = calcFairValue(f?.eps, f?.earnings_growth_5y)
  const upside = calcUpside(intrinsic, price)
  const marketSafety = calcMarketSafety(fair, price)
  const margin = calcMarginOfSafety(intrinsic, price)
  const teto8 = calcTeto8(f?.dividend_yield, price)
  const teto6 = calcTeto6(f?.dividend_yield, price)
  const signal = calcBazinSignal(f?.dividend_yield, price)

  const posCurrentValue = calcCurrentValue(position?.quantity, price)
  const posCostBasis = calcCostBasis(position?.quantity, position?.avg_price)
  const posPlAbs = calcPlAbs(posCurrentValue, posCostBasis)
  const posPlPct = calcPlPct(posCurrentValue, posCostBasis)

  // Build comparison columns (current ticker is always col 0)
  const currentCol = buildColData(ticker!, profile, f, price)
  const allColumns: ColData[] = [currentCol, ...compareData]

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/screener"><ArrowLeft className="h-4 w-4 mr-1" />Screener</Link>
        </Button>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{ticker}</h1>
          {profile?.company_name && <p className="text-muted-foreground text-lg">{profile.company_name}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            {profile?.sector && <Badge variant="secondary">{profile.sector}</Badge>}
            {profile?.industry && <Badge variant="outline">{profile.industry}</Badge>}
            {profile?.exchange && <Badge variant="outline">{profile.exchange}</Badge>}
            {profile?.country && <Badge variant="outline">{profile.country}</Badge>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div>
            {price != null && <div className="text-3xl font-bold">{fmt(price, profile?.currency ?? 'USD')}</div>}
            {f?.dividend_yield != null && <div className="text-muted-foreground text-right">DY: {(f.dividend_yield * 100).toFixed(2)}%</div>}
          </div>
          <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)}>
            <GitCompareArrows className="h-4 w-4 mr-1" />
            {compareTickers.length > 0 ? `Comparando (${compareTickers.length})` : 'Comparar com…'}
          </Button>
        </div>
      </div>

      {/* Company Description */}
      {profile?.description && (
        <Card>
          <CardHeader><CardTitle className="text-base">Sobre a Empresa</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">{profile.description}</p>
            {profile.website && (
              <a href={profile.website} target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                <ExternalLink className="h-3 w-3" />
                {profile.website}
              </a>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Graham Analysis */}
        <Card>
          <CardHeader><CardTitle className="text-base">Análise Graham</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <SafetyIndicator value={margin} label="Margem de Segurança" />
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">V. Intrínseco</div>
                <div className="text-2xl font-bold">{intrinsic != null ? fmt(intrinsic, profile?.currency) : '-'}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">V. Justo</div>
                <div className="text-2xl font-bold">{fair != null ? fmt(fair, profile?.currency) : '-'}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Upside</div>
                <div className={`text-2xl font-bold ${upside != null && upside > 0 ? 'text-green-600' : upside != null ? 'text-red-600' : ''}`}>
                  {upside != null ? fmtPct(upside) : '-'}
                </div>
              </div>
            </div>
            <div>
              <MetricRow label="Seg. Juros de Mercado" value={marketSafety != null ? fmtPct(marketSafety) : '-'} color={marketSafety != null && marketSafety > 0 ? 'text-green-600' : 'text-red-600'} />
              <MetricRow label="LPA (EPS)" value={fmtNumber(f?.eps)} />
              <MetricRow label="VPA" value={fmtNumber(f?.book_value_per_share)} />
              <MetricRow label="Lucros 5 Anos (g)" value={f?.earnings_growth_5y != null ? `${(f.earnings_growth_5y * 100).toFixed(1)}%` : '-'} />
              <MetricRow label="Payout Médio" value={f?.payout_avg != null ? `${(f.payout_avg * 100).toFixed(1)}%` : '-'} />
            </div>
          </CardContent>
        </Card>

        {/* Bazin Analysis */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Análise Bazin</CardTitle>
              {signal && (
                <Badge variant={signal === 'COMPRA' ? 'success' : 'danger'} className="text-sm px-3 py-1">
                  {signal}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Teto 8%</div>
                <div className="text-2xl font-bold">{teto8 != null ? fmt(teto8, profile?.currency) : '-'}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Teto 6%</div>
                <div className="text-2xl font-bold">{teto6 != null ? fmt(teto6, profile?.currency) : '-'}</div>
              </div>
            </div>
            <MetricRow label="Preço Atual" value={price != null ? fmt(price, profile?.currency) : '-'} />
            <MetricRow label="Dividend Yield" value={f?.dividend_yield != null ? `${(f.dividend_yield * 100).toFixed(2)}%` : '-'} />
            <MetricRow label="DPS" value={fmt(f?.dps, profile?.currency)} />
            <MetricRow
              label="Status"
              value={signal ?? '-'}
              color={signal === 'COMPRA' ? 'text-green-600' : signal === 'NÃO COMPRA' ? 'text-red-600' : ''}
            />
          </CardContent>
        </Card>
      </div>

      {/* Key Ratios */}
      <Card>
        <CardHeader><CardTitle className="text-base">Indicadores Fundamentalistas</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-8">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Valuation</h4>
              <MetricRow label="P/L" value={fmtNumber(f?.pe)} />
              <MetricRow label="P/VPA" value={fmtNumber(f?.pb)} />
              <MetricRow label="P/S (PSR)" value={fmtNumber(f?.psr)} />
              <MetricRow label="PEG" value={fmtNumber(f?.peg)} />
              <MetricRow label="EV/EBITDA" value={fmtNumber(f?.ev_ebitda)} />
              <MetricRow label="EV/EBIT" value={fmtNumber(f?.ev_ebit)} />
              <MetricRow label="Market Cap" value={fmtLargeNumber(f?.market_cap)} />
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Rentabilidade</h4>
              <MetricRow label="ROE" value={f?.roe != null ? `${(f.roe * 100).toFixed(1)}%` : '-'} />
              <MetricRow label="ROA" value={f?.roa != null ? `${(f.roa * 100).toFixed(1)}%` : '-'} />
              <MetricRow label="ROIC" value={f?.roic != null ? `${(f.roic * 100).toFixed(1)}%` : '-'} />
              <MetricRow label="Margem Bruta" value={f?.gross_margin != null ? `${(f.gross_margin * 100).toFixed(1)}%` : '-'} />
              <MetricRow label="Margem EBIT" value={f?.ebit_margin != null ? `${(f.ebit_margin * 100).toFixed(1)}%` : '-'} />
              <MetricRow label="Margem Líquida" value={f?.net_margin != null ? `${(f.net_margin * 100).toFixed(1)}%` : '-'} />
              <MetricRow label="Beta" value={fmtNumber(f?.beta)} />
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Dívida &amp; Dividendos</h4>
              <MetricRow label="Div.Líq/Patri." value={fmtNumber(f?.debt_equity)} />
              <MetricRow label="Div.Líq/EBIT" value={fmtNumber(f?.net_debt_ebit)} />
              <MetricRow label="Liquidez Corrente" value={fmtNumber(f?.current_ratio)} />
              <MetricRow label="DY%" value={f?.dividend_yield != null ? `${(f.dividend_yield * 100).toFixed(2)}%` : '-'} />
              <MetricRow label="Payout" value={f?.payout_avg != null ? `${(f.payout_avg * 100).toFixed(1)}%` : '-'} />
              <MetricRow label="Crescimento Receita YoY" value={f?.revenue_growth_yoy != null ? `${(f.revenue_growth_yoy * 100).toFixed(1)}%` : '-'} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Price Alerts */}
      <Card>
        <CardHeader><CardTitle className="text-base">Alertas de Preço</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleAddAlert} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Direção</Label>
              <div className="flex rounded-md border overflow-hidden">
                {(['above', 'below'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setAlertDirection(d)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      alertDirection === d ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {d === 'above' ? '↑ Acima' : '↓ Abaixo'}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="alert-price" className="text-xs">Preço alvo</Label>
              <Input
                id="alert-price"
                type="number"
                min="0.01"
                step="any"
                placeholder="0.00"
                value={alertTarget}
                onChange={(e) => setAlertTarget(e.target.value)}
                className="w-32 h-9"
              />
            </div>
            <Button type="submit" size="sm" disabled={alertSubmitting}>
              <Bell className="h-4 w-4 mr-1" />
              {alertSubmitting ? 'Salvando…' : 'Definir Alerta'}
            </Button>
            {alertError && <p className="text-xs text-destructive">{alertError}</p>}
          </form>

          {alerts.length > 0 && (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Direção</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Preço Alvo</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Criado em</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {alerts.map((a) => (
                    <tr key={a.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2 text-xs">
                        {a.direction === 'above' ? '↑ Acima' : '↓ Abaixo'}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono">{fmt(a.target_price, profile?.currency)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(a.created_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-3 py-2">
                        {a.is_active ? (
                          <Badge variant="success" className="text-xs">Ativo</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Atingido</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {a.is_active && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteAlert(a.id)}>
                            <BellOff className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {alerts.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhum alerta definido para este ticker.</p>
          )}
        </CardContent>
      </Card>

      {/* Portfolio Position */}
      {position && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Minha Posição em {ticker}</CardTitle>
              <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditError(null) }}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setEditQty(String(position.quantity)); setEditAvg(String(position.avg_price)) }}
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Editar
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Editar Posição — {ticker}</DialogTitle></DialogHeader>
                  <form onSubmit={handleEditPosition} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="edit-qty-a">Quantidade</Label>
                        <Input id="edit-qty-a" type="number" min="0" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-avg-a">Preço Médio</Label>
                        <Input id="edit-avg-a" type="number" min="0" step="any" value={editAvg} onChange={(e) => setEditAvg(e.target.value)} />
                      </div>
                    </div>
                    {editError && <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{editError}</div>}
                    <DialogFooter>
                      <Button type="submit" disabled={editLoading}>{editLoading ? 'Salvando...' : 'Salvar'}</Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Quantidade', value: String(position.quantity) },
                { label: 'Preço Médio', value: fmt(position.avg_price, profile?.currency) },
                { label: 'Valor Atual', value: posCurrentValue != null ? fmt(posCurrentValue, profile?.currency) : '-' },
                { label: 'Custo Total', value: posCostBasis != null ? fmt(posCostBasis, profile?.currency) : '-' },
              ].map((c) => (
                <div key={c.label} className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground mb-1">{c.label}</div>
                  <div className="font-semibold">{c.value}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-6">
              <div className={`flex items-center gap-1 text-lg font-bold ${(posPlAbs ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {(posPlAbs ?? 0) >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                P&L: {posPlAbs != null ? fmt(posPlAbs, profile?.currency) : '-'} ({posPlPct != null ? fmtPct(posPlPct) : '-'})
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Minhas Notas</CardTitle>
            {noteSaving && <span className="text-xs text-muted-foreground">Salvando…</span>}
            {!noteSaving && noteSavedAt && (
              <span className="text-xs text-muted-foreground">
                Salvo em {new Date(noteSavedAt).toLocaleString('pt-BR')}
              </span>
            )}
            {!noteSaving && !noteSavedAt && (
              <span className="text-xs text-muted-foreground">Nunca salvo</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            className="w-full min-h-[96px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
            placeholder="Registre sua tese de investimento, pontos de atenção, datas de revisão…"
            value={noteContent}
            onChange={(e) => handleNoteChange(e.target.value)}
            onBlur={handleNoteBlur}
          />
          <Button size="sm" variant="outline" onClick={() => saveNote(noteContent)} disabled={noteSaving}>
            Salvar Nota
          </Button>
        </CardContent>
      </Card>

      {/* Comparison Table */}
      {compareTickers.length > 0 && compareData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comparação</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ComparisonTableV2 columns={allColumns} onRemove={handleRemoveCompare} />
          </CardContent>
        </Card>
      )}

      {/* Compare Modal */}
      <CompareModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        currentTicker={ticker!}
        selected={compareTickers}
        onConfirm={handleCompareConfirm}
      />
    </div>
  )
}
