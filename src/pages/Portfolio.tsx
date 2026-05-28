import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  calcCurrentValue,
  calcCostBasis,
  calcPlAbs,
  calcPlPct,
  calcAnnualDiv,
  calcWeight,
  calculateMonthlyDividends,
  type DividendRow,
  fmtPct,
  fmtNumber,
} from '@/lib/calculations'
import { useCurrency } from '@/lib/currency'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Pencil, Trash2, TrendingUp, TrendingDown } from 'lucide-react'

const CHART_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444',
  '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#f97316',
]
const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MAX_CHART_STACKS = 7

type PortfolioRow = {
  id: string
  ticker: string
  quantity: number
  avg_price: number
  company_name?: string | null
  currency?: string | null
  current_price?: number | null
  dividend_yield?: number | null
  dps?: number | null
}

type TickerOption = { ticker: string; company_name: string | null }

// ---------------------------------------------------------------------------
// Dividend Tracker sub-component
// ---------------------------------------------------------------------------

type EnrichedRow = PortfolioRow & {
  current_value: number | null
  cost_basis: number | null
  pl_abs: number | null
  pl_pct: number | null
  annual_div: number | null
  weight: number | null
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className={`text-lg font-bold ${color ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  )
}

function DividendTrackerTab({ rows }: { rows: EnrichedRow[] }) {
  const { fmt, convert, currency } = useCurrency()

  const divRows: DividendRow[] = useMemo(
    () =>
      calculateMonthlyDividends(
        rows.map((r) => ({
          ticker: r.ticker,
          company_name: r.company_name ?? null,
          quantity: r.quantity,
          dps: r.dps ?? null,
          dividend_yield: r.dividend_yield ?? null,
          current_price: r.current_price ?? null,
          currency: r.currency ?? null,
        }))
      ),
    [rows]
  )

  const sortedRows = useMemo(
    () => [...divRows].sort(
      (a, b) =>
        convert(b.annual_div ?? 0, b.currency ?? 'USD') - convert(a.annual_div ?? 0, a.currency ?? 'USD')
    ),
    [divRows, convert, currency]
  )

  const totalAnnualDiv = useMemo(
    () => sortedRows.reduce((s, r) => s + convert(r.annual_div ?? 0, r.currency ?? 'USD'), 0),
    [sortedRows, convert, currency]
  )
  const totalMonthlyAvg = totalAnnualDiv / 12

  const totalCurrentValue = useMemo(
    () => rows.reduce((s, r) => s + convert(r.current_value ?? 0, r.currency ?? 'USD'), 0),
    [rows, convert, currency]
  )
  const portfolioYield = totalCurrentValue > 0 ? totalAnnualDiv / totalCurrentValue : null

  // Build stacked bar chart data — top N tickers + "Outros"
  const topRows = sortedRows.slice(0, MAX_CHART_STACKS)
  const otherRows = sortedRows.slice(MAX_CHART_STACKS)
  const chartKeys = [
    ...topRows.map((r) => r.ticker),
    ...(otherRows.length > 0 ? ['Outros'] : []),
  ]
  const othersMonthly = otherRows.reduce(
    (s, r) => s + convert(r.monthly_div ?? 0, r.currency ?? 'USD'), 0
  )

  const chartData = MONTH_LABELS.map((month) => {
    const entry: Record<string, number | string> = { month }
    topRows.forEach((r) => {
      entry[r.ticker] = convert(r.monthly_div ?? 0, r.currency ?? 'USD')
    })
    if (otherRows.length > 0) entry['Outros'] = othersMonthly
    return entry
  })

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="px-6 py-12 text-center text-sm text-muted-foreground">
          Adicione posições ao portfólio para ver o rastreamento de dividendos.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <SummaryCard label="Div. Anuais Est." value={fmt(totalAnnualDiv, currency)} />
        <SummaryCard label="Média Mensal Est." value={fmt(totalMonthlyAvg, currency)} />
        <SummaryCard label="Yield do Portfólio" value={fmtPct(portfolioYield)} />
        <SummaryCard label="Melhor Mês" value={fmt(totalMonthlyAvg, currency)} />
        <SummaryCard label="Pior Mês" value={fmt(totalMonthlyAvg, currency)} />
      </div>

      {/* Monthly bar chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Dividendos Mensais Estimados</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-4">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tickFormatter={(v: any) => fmt(v as number, currency)}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={80}
              />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any, name: any) => [fmt(value as number, currency), name as string]}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {chartKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="divs"
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  name={key}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Breakdown table */}
      <div className="rounded-lg border overflow-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              {['Ticker', 'Empresa', 'Qtd', 'DPS', 'DY%', 'Div. Anual', 'Div. Mensal', '% do Total'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {sortedRows.map((r) => {
              const noDivData = r.dps == null && r.dividend_yield == null
              return (
                <tr
                  key={r.ticker}
                  className="hover:bg-muted/30 transition-colors"
                  title={noDivData ? 'Sem dados de dividendos disponíveis para este ticker' : undefined}
                >
                  <td className="px-3 py-2 font-medium">
                    <Link to={`/analysis/${r.ticker}`} className="text-primary hover:underline">
                      {r.ticker}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate">
                    {r.company_name ?? '-'}
                  </td>
                  <td className="px-3 py-2">{r.quantity}</td>
                  <td className="px-3 py-2">
                    {r.dps != null ? fmt(r.dps, r.currency) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {r.dividend_yield != null
                      ? `${(r.dividend_yield * 100).toFixed(2)}%`
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 font-medium text-green-700">
                    {r.annual_div != null
                      ? fmt(convert(r.annual_div, r.currency ?? 'USD'), currency)
                      : <span className="text-muted-foreground font-normal">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {r.monthly_div != null
                      ? fmt(convert(r.monthly_div, r.currency ?? 'USD'), currency)
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {totalAnnualDiv > 0 && r.annual_div != null
                      ? `${(convert(r.annual_div, r.currency ?? 'USD') / totalAnnualDiv * 100).toFixed(1)}%`
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              )
            })}

            {/* Footer totals */}
            <tr className="bg-muted/60 font-semibold border-t-2 border-border">
              <td className="px-3 py-2" colSpan={5}>Total</td>
              <td className="px-3 py-2 text-green-700">{fmt(totalAnnualDiv, currency)}</td>
              <td className="px-3 py-2">{fmt(totalMonthlyAvg, currency)}</td>
              <td className="px-3 py-2">100%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Os valores de dividendos são estimativas baseadas no yield atual e distribuídos
        igualmente ao longo dos meses. As datas e valores reais de pagamento podem diferir.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Portfolio component
// ---------------------------------------------------------------------------

export default function Portfolio() {
  const { fmt, convert, currency } = useCurrency()

  const [rows, setRows] = useState<PortfolioRow[]>([])
  const [tickers, setTickers] = useState<TickerOption[]>([])
  const [snapshots, setSnapshots] = useState<{ snapshot_date: string; total_value: number; total_cost: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add modal
  const [addOpen, setAddOpen] = useState(false)
  const [addTicker, setAddTicker] = useState('')
  const [addQty, setAddQty] = useState('')
  const [addAvg, setAddAvg] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Edit modal
  const [editOpen, setEditOpen] = useState(false)
  const [editRow, setEditRow] = useState<PortfolioRow | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editAvg, setEditAvg] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Não autenticado.'); setLoading(false); return }

    const [portfolioRes, pricesRes, fundRes, profilesRes, tickersRes, snapshotRes] = await Promise.all([
      supabase.from('portfolios').select('*').eq('user_id', user.id),
      supabase.from('stock_prices').select('ticker, price'),
      supabase.from('stock_fundamentals').select('ticker, dividend_yield, dps'),
      supabase.from('stock_profiles').select('ticker, company_name, currency'),
      supabase.from('tickers').select('ticker'),
      supabase.from('portfolio_snapshots')
        .select('snapshot_date, total_value, total_cost')
        .eq('user_id', user.id)
        .order('snapshot_date', { ascending: true })
        .limit(365),
    ])

    if (portfolioRes.error) { setError(portfolioRes.error.message); setLoading(false); return }

    const priceMap = new Map((pricesRes.data ?? []).map((r) => [r.ticker, r.price]))
    const fundMap = new Map((fundRes.data ?? []).map((r) => [r.ticker, r]))
    const profileMap = new Map((profilesRes.data ?? []).map((r) => [r.ticker, r]))

    const enriched = (portfolioRes.data ?? []).map((p) => ({
      ...p,
      company_name: profileMap.get(p.ticker)?.company_name ?? null,
      currency: profileMap.get(p.ticker)?.currency ?? null,
      current_price: priceMap.get(p.ticker) ?? null,
      dividend_yield: fundMap.get(p.ticker)?.dividend_yield ?? null,
      dps: fundMap.get(p.ticker)?.dps ?? null,
    }))
    setRows(enriched)
    setSnapshots(snapshotRes.data ?? [])

    const heldTickers = new Set(enriched.map((r) => r.ticker))
    const allTickers = (tickersRes.data ?? []).map((t) => ({
      ticker: t.ticker,
      company_name: profileMap.get(t.ticker)?.company_name ?? null,
    })).filter((t) => !heldTickers.has(t.ticker))
    setTickers(allTickers)

    setLoading(false)
  }

  const enrichedRows: EnrichedRow[] = useMemo(() => {
    const totalValue = rows.reduce((sum, r) => {
      const cv = calcCurrentValue(r.quantity, r.current_price)
      return sum + (cv ?? 0)
    }, 0)
    return rows.map((r) => {
      const cv = calcCurrentValue(r.quantity, r.current_price)
      const cb = calcCostBasis(r.quantity, r.avg_price)
      return {
        ...r,
        current_value: cv,
        cost_basis: cb,
        pl_abs: calcPlAbs(cv, cb),
        pl_pct: calcPlPct(cv, cb),
        annual_div: calcAnnualDiv(r.dividend_yield, cv),
        weight: calcWeight(cv, totalValue),
      }
    })
  }, [rows])

  const summary = useMemo(() => {
    const totalInvested = enrichedRows.reduce((s, r) => s + convert(r.cost_basis ?? 0, r.currency ?? 'USD'), 0)
    const totalValue = enrichedRows.reduce((s, r) => s + convert(r.current_value ?? 0, r.currency ?? 'USD'), 0)
    const totalPl = totalValue - totalInvested
    const totalPlPct = totalInvested > 0 ? totalPl / totalInvested : null
    const totalDiv = enrichedRows.reduce((s, r) => s + convert(r.annual_div ?? 0, r.currency ?? 'USD'), 0)
    const portfolioYield = totalValue > 0 ? totalDiv / totalValue : null
    return { totalInvested, totalValue, totalPl, totalPlPct, totalDiv, portfolioYield }
  }, [enrichedRows, convert, currency])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null)
    setAddLoading(true)
    if (!addTicker) { setAddError('Selecione um ticker.'); setAddLoading(false); return }
    const qty = parseFloat(addQty)
    const avg = parseFloat(addAvg)
    if (!qty || qty <= 0) { setAddError('Quantidade inválida.'); setAddLoading(false); return }
    if (!avg || avg <= 0) { setAddError('Preço médio inválido.'); setAddLoading(false); return }

    const { data: { user } } = await supabase.auth.getUser()
    const { error: err } = await supabase.from('portfolios').insert({
      ticker: addTicker, quantity: qty, avg_price: avg, user_id: user!.id,
    })
    if (err) {
      setAddError(err.message)
    } else {
      setAddOpen(false)
      setAddTicker(''); setAddQty(''); setAddAvg('')
      fetchAll()
    }
    setAddLoading(false)
  }

  async function handleEdit(e: React.FormEvent) {
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
      .eq('id', editRow!.id)
    if (err) {
      setEditError(err.message)
    } else {
      setEditOpen(false)
      fetchAll()
    }
    setEditLoading(false)
  }

  async function handleDelete(id: string) {
    setDeleteLoading(true)
    await supabase.from('portfolios').delete().eq('id', id)
    setDeleteId(null)
    setDeleteLoading(false)
    fetchAll()
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-muted-foreground">Carregando portfólio...</div></div>
  }
  if (error) return <div className="p-6 text-destructive">Erro: {error}</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Portfólio</h1>
        <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) { setAddError(null); setAddTicker(''); setAddQty(''); setAddAvg('') } }}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />Adicionar Posição</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Adicionar Posição</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-2">
                <Label>Ticker</Label>
                <Select value={addTicker} onValueChange={setAddTicker}>
                  <SelectTrigger><SelectValue placeholder="Selecionar ticker..." /></SelectTrigger>
                  <SelectContent>
                    {tickers.map((t) => (
                      <SelectItem key={t.ticker} value={t.ticker}>
                        {t.ticker}{t.company_name ? ` — ${t.company_name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="add-qty">Quantidade</Label>
                  <Input id="add-qty" type="number" min="0" step="any" placeholder="100" value={addQty} onChange={(e) => setAddQty(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-avg">Preço Médio</Label>
                  <Input id="add-avg" type="number" min="0" step="any" placeholder="25.50" value={addAvg} onChange={(e) => setAddAvg(e.target.value)} />
                </div>
              </div>
              {addError && <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{addError}</div>}
              <DialogFooter>
                <Button type="submit" disabled={addLoading}>{addLoading ? 'Adicionando...' : 'Adicionar'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="portfolio">
        <TabsList>
          <TabsTrigger value="portfolio">Portfólio</TabsTrigger>
          <TabsTrigger value="dividends">Dividend Tracker</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Portfolio ── */}
        <TabsContent value="portfolio" className="space-y-6 mt-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Total Investido', value: fmt(summary.totalInvested, currency) },
              { label: 'Valor Atual', value: fmt(summary.totalValue, currency) },
              {
                label: 'P&L',
                value: fmt(summary.totalPl, currency),
                color: summary.totalPl >= 0 ? 'text-green-600' : 'text-red-600',
              },
              {
                label: 'P&L (%)',
                value: fmtPct(summary.totalPlPct),
                color: (summary.totalPlPct ?? 0) >= 0 ? 'text-green-600' : 'text-red-600',
              },
              { label: 'Div. Anuais Est.', value: fmt(summary.totalDiv, currency) },
              { label: 'Yield do Portfólio', value: fmtPct(summary.portfolioYield) },
            ].map((c) => (
              <Card key={c.label}>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{c.label}</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className={`text-lg font-bold ${c.color ?? ''}`}>{c.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Equity Curve */}
          {snapshots.length < 2 ? (
            <Card>
              <CardContent className="px-6 py-8 text-center text-sm text-muted-foreground">
                A curva de patrimônio aparecerá após 2 ou mais atualizações de preços.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Evolução do Portfólio</CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-4">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={snapshots} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="snapshot_date"
                      tickFormatter={(d: string) => {
                        const dt = new Date(d + 'T12:00:00')
                        return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                      }}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(v: number) => fmt(v, currency)}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={90}
                    />
                    <Tooltip
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(value: any, name: any) => [fmt(value as number, currency), name as string]}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      labelFormatter={(label: any) => new Date(String(label) + 'T12:00:00').toLocaleDateString('pt-BR')}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="total_value"
                      name="Valor Atual"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="total_cost"
                      name="Custo"
                      stroke="#94a3b8"
                      strokeWidth={2}
                      dot={false}
                      strokeDasharray="4 4"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Portfolio Table */}
          <div className="rounded-lg border overflow-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  {['Ticker', 'Empresa', 'Qtd', 'Preço Médio', 'Preço Atual', 'Valor Atual', 'Custo', 'P&L', 'P&L (%)', 'DY%', 'Div. Anual Est.', 'Peso %', ''].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {enrichedRows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium">
                      <Link to={`/analysis/${r.ticker}`} className="text-primary hover:underline">{r.ticker}</Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate">{r.company_name ?? '-'}</td>
                    <td className="px-3 py-2">{r.quantity}</td>
                    <td className="px-3 py-2">{fmt(r.avg_price, r.currency)}</td>
                    <td className="px-3 py-2">{r.current_price != null ? fmt(r.current_price, r.currency) : '-'}</td>
                    <td className="px-3 py-2">{r.current_value != null ? fmt(r.current_value, r.currency) : '-'}</td>
                    <td className="px-3 py-2">{r.cost_basis != null ? fmt(r.cost_basis, r.currency) : '-'}</td>
                    <td className={`px-3 py-2 font-medium ${(r.pl_abs ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      <span className="flex items-center gap-1">
                        {(r.pl_abs ?? 0) >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {r.pl_abs != null ? fmt(r.pl_abs, r.currency) : '-'}
                      </span>
                    </td>
                    <td className={`px-3 py-2 font-medium ${(r.pl_pct ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {r.pl_pct != null ? fmtPct(r.pl_pct) : '-'}
                    </td>
                    <td className="px-3 py-2">{r.dividend_yield != null ? `${(r.dividend_yield * 100).toFixed(2)}%` : '-'}</td>
                    <td className="px-3 py-2">{r.annual_div != null ? fmt(r.annual_div, r.currency) : '-'}</td>
                    <td className="px-3 py-2">{r.weight != null ? `${(r.weight * 100).toFixed(1)}%` : '-'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            setEditRow(r)
                            setEditQty(String(r.quantity))
                            setEditAvg(String(r.avg_price))
                            setEditError(null)
                            setEditOpen(true)
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(r.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {enrichedRows.length === 0 && (
                  <tr><td colSpan={13} className="px-3 py-12 text-center text-muted-foreground">Nenhuma posição no portfólio. Adicione seu primeiro ativo.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── Tab 2: Dividend Tracker ── */}
        <TabsContent value="dividends" className="mt-4">
          <DividendTrackerTab rows={enrichedRows} />
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditError(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Posição — {editRow?.ticker}</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-qty">Quantidade</Label>
                <Input id="edit-qty" type="number" min="0" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-avg">Preço Médio</Label>
                <Input id="edit-avg" type="number" min="0" step="any" value={editAvg} onChange={(e) => setEditAvg(e.target.value)} />
              </div>
            </div>
            {editError && <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{editError}</div>}
            <DialogFooter>
              <Button type="submit" disabled={editLoading}>{editLoading ? 'Salvando...' : 'Salvar'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remover Posição</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tem certeza que deseja remover esta posição do portfólio? Esta ação não pode ser desfeita.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={deleteLoading} onClick={() => deleteId && handleDelete(deleteId)}>
              {deleteLoading ? 'Removendo...' : 'Remover'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
