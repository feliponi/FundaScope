import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
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
  fmtCurrency,
  fmtPct,
  fmtNumber,
  fmtLargeNumber,
} from '@/lib/calculations'
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
import { ArrowLeft, ExternalLink, Pencil, TrendingUp, TrendingDown } from 'lucide-react'

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

type PortfolioPos = {
  id: string
  quantity: number
  avg_price: number
}

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

export default function Analysis() {
  const { ticker } = useParams<{ ticker: string }>()
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

  useEffect(() => {
    if (ticker) fetchAll()
  }, [ticker])

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
        <div className="text-right">
          {price != null && <div className="text-3xl font-bold">{fmtCurrency(price, profile?.currency ?? 'BRL')}</div>}
          {f?.dividend_yield != null && <div className="text-muted-foreground">DY: {(f.dividend_yield * 100).toFixed(2)}%</div>}
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
                <div className="text-2xl font-bold">{intrinsic != null ? fmtCurrency(intrinsic) : '-'}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">V. Justo</div>
                <div className="text-2xl font-bold">{fair != null ? fmtCurrency(fair) : '-'}</div>
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
                <div className="text-2xl font-bold">{teto8 != null ? fmtCurrency(teto8) : '-'}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Teto 6%</div>
                <div className="text-2xl font-bold">{teto6 != null ? fmtCurrency(teto6) : '-'}</div>
              </div>
            </div>
            <MetricRow label="Preço Atual" value={price != null ? fmtCurrency(price) : '-'} />
            <MetricRow label="Dividend Yield" value={f?.dividend_yield != null ? `${(f.dividend_yield * 100).toFixed(2)}%` : '-'} />
            <MetricRow label="DPS" value={fmtCurrency(f?.dps)} />
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
                { label: 'Preço Médio', value: fmtCurrency(position.avg_price) },
                { label: 'Valor Atual', value: posCurrentValue != null ? fmtCurrency(posCurrentValue) : '-' },
                { label: 'Custo Total', value: posCostBasis != null ? fmtCurrency(posCostBasis) : '-' },
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
                P&L: {posPlAbs != null ? fmtCurrency(posPlAbs) : '-'} ({posPlPct != null ? fmtPct(posPlPct) : '-'})
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
