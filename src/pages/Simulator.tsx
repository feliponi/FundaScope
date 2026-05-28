import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  calcBazinSignal,
  calcIntrinsicValue,
  calcMarginOfSafety,
  calculateAllocation,
  type SimulatorAllocation,
  fmtNumber,
  fmtPct,
} from '@/lib/calculations'
import { useCurrency } from '@/lib/currency'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Calculator, Download, Briefcase, Info, CheckCircle } from 'lucide-react'

const PIE_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444',
  '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#f97316',
]

const RADIAN = Math.PI / 180

function PieSliceLabel({
  cx, cy, midAngle, innerRadius, outerRadius, percent, ticker,
}: {
  cx: number; cy: number; midAngle: number
  innerRadius: number; outerRadius: number; percent: number; ticker: string
}) {
  if (percent < 0.05) return null
  const r = innerRadius + (outerRadius - innerRadius) * 0.55
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
      fontSize={11} fontWeight={600}>
      {ticker}
    </text>
  )
}

type RawTicker = {
  ticker: string
  company_name: string | null
  currency: string | null
  price: number | null
  dividend_yield: number | null
  dps: number | null
  eps: number | null
  book_value_per_share: number | null
}

type ResultRow = SimulatorAllocation & { shares_override: number | null }

export default function Simulator() {
  const { fmt, convert, currency, rates } = useCurrency()

  const [rawData, setRawData] = useState<RawTicker[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [amount, setAmount] = useState('')
  const [results, setResults] = useState<ResultRow[]>([])
  const [calculated, setCalculated] = useState(false)
  const [addingToPortfolio, setAddingToPortfolio] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    setError(null)
    const [profilesRes, pricesRes, fundRes] = await Promise.all([
      supabase.from('stock_profiles').select('ticker, company_name, currency'),
      supabase.from('stock_prices').select('ticker, price'),
      supabase.from('stock_fundamentals').select('ticker, dividend_yield, dps, eps, book_value_per_share'),
    ])
    if (profilesRes.error || pricesRes.error || fundRes.error) {
      setError('Erro ao carregar dados do screener.')
      setLoading(false)
      return
    }
    const profileMap = new Map((profilesRes.data ?? []).map((r) => [r.ticker, r]))
    const priceMap = new Map((pricesRes.data ?? []).map((r) => [r.ticker, r.price]))
    const fundMap = new Map((fundRes.data ?? []).map((r) => [r.ticker, r]))

    const { data: tickerList } = await supabase.from('tickers').select('ticker')
    const merged: RawTicker[] = (tickerList ?? []).map((t) => {
      const f = fundMap.get(t.ticker)
      const p = profileMap.get(t.ticker)
      return {
        ticker: t.ticker,
        company_name: p?.company_name ?? null,
        currency: p?.currency ?? null,
        price: priceMap.get(t.ticker) ?? null,
        dividend_yield: f?.dividend_yield ?? null,
        dps: f?.dps ?? null,
        eps: f?.eps ?? null,
        book_value_per_share: f?.book_value_per_share ?? null,
      }
    })
    setRawData(merged)
    setLoading(false)
  }

  // Convert from display currency to a ticker's native currency
  const toNative = useCallback(
    (amountDisplay: number, nativeCurrency: string | null): number => {
      if (!nativeCurrency) return amountDisplay
      const rN = (rates as Record<string, number>)[nativeCurrency] ?? 1
      const rD = (rates as Record<string, number>)[currency] ?? 1
      return amountDisplay * rN / rD
    },
    [rates, currency]
  )

  const eligibleTickers = useMemo(() => {
    return rawData.filter((t) => {
      if (!t.price || !t.dividend_yield || t.dividend_yield <= 0) return false
      if (calcBazinSignal(t.dividend_yield, t.price) !== 'COMPRA') return false
      const intrinsic = calcIntrinsicValue(t.eps, t.book_value_per_share)
      const mos = calcMarginOfSafety(intrinsic, t.price)
      return mos != null && mos >= 30
    })
  }, [rawData])

  function handleCalculate() {
    const amountNum = parseFloat(amount.replace(/,/g, '.'))
    if (!amountNum || amountNum <= 0) return

    const inputs = eligibleTickers.map((t) => {
      const priceDisplay = convert(t.price!, t.currency ?? 'USD')
      const dpsNative = t.dps ?? t.dividend_yield! * t.price!
      const dpsDisplay = convert(dpsNative, t.currency ?? 'USD')
      const intrinsic = calcIntrinsicValue(t.eps, t.book_value_per_share)
      const mos = calcMarginOfSafety(intrinsic, t.price!)!
      return {
        ticker: t.ticker,
        company_name: t.company_name,
        currency: t.currency,
        current_price: priceDisplay,
        current_price_native: t.price!,
        dividend_yield: t.dividend_yield!,
        dps_display: dpsDisplay,
        margin_of_safety: mos,
      }
    })

    const allocation = calculateAllocation(amountNum, inputs)
    setResults(allocation.map((a) => ({ ...a, shares_override: null })))
    setCalculated(true)
  }

  const displayRows = useMemo((): ResultRow[] => {
    return results.map((r) => {
      const shares = r.shares_override ?? r.shares
      const actual_cost = shares * r.current_price
      const leftover = r.allocated - actual_cost
      const est_annual_div = shares * r.dps_display
      return { ...r, shares, actual_cost, leftover, est_annual_div }
    })
  }, [results])

  const totals = useMemo(() => ({
    totalCost: displayRows.reduce((s, r) => s + r.actual_cost, 0),
    totalShares: displayRows.reduce((s, r) => s + r.shares, 0),
    totalAnnualDiv: displayRows.reduce((s, r) => s + r.est_annual_div, 0),
    totalLeftover: displayRows.reduce((s, r) => s + r.leftover, 0),
  }), [displayRows])

  function handleOverride(ticker: string, value: string) {
    const n = parseInt(value, 10)
    setResults((prev) =>
      prev.map((r) =>
        r.ticker === ticker ? { ...r, shares_override: isNaN(n) || n < 0 ? null : n } : r
      )
    )
  }

  function exportCSV() {
    const headers = [
      'Ticker', 'Empresa', 'DY%', 'Peso%', 'Alocado', 'Qtd',
      'Custo', 'Div.Anual Est.', 'Margem Seg.%', 'Sinal',
    ]
    const csvRows = displayRows.map((r) => [
      r.ticker,
      r.company_name ?? '',
      (r.dividend_yield * 100).toFixed(2),
      (r.weight_pct * 100).toFixed(1),
      r.allocated.toFixed(2),
      r.shares,
      r.actual_cost.toFixed(2),
      r.est_annual_div.toFixed(2),
      r.margin_of_safety.toFixed(1),
      'COMPRA',
    ])
    const csv = [headers, ...csvRows].map((row) => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `simulador-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleAddToPortfolio() {
    const toAdd = displayRows.filter((r) => r.shares > 0)
    if (toAdd.length === 0) return
    setAddingToPortfolio(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setAddingToPortfolio(false); return }

    const { data: existing } = await supabase
      .from('portfolios')
      .select('id, ticker, quantity, avg_price')
      .eq('user_id', user.id)

    const existingMap = new Map((existing ?? []).map((p) => [p.ticker, p]))

    for (const r of toAdd) {
      const ex = existingMap.get(r.ticker)
      const nativePrice = r.current_price_native
      if (ex) {
        const newQty = ex.quantity + r.shares
        const newAvg = (ex.quantity * ex.avg_price + r.shares * nativePrice) / newQty
        await supabase
          .from('portfolios')
          .update({ quantity: newQty, avg_price: newAvg, updated_at: new Date().toISOString() })
          .eq('id', ex.id)
      } else {
        await supabase.from('portfolios').insert({
          user_id: user.id,
          ticker: r.ticker,
          quantity: r.shares,
          avg_price: nativePrice,
        })
      }
    }

    showToast(`${toAdd.length} posição(ões) adicionada(s) ao portfólio.`)
    setAddingToPortfolio(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  const pieData = useMemo(
    () => displayRows.map((r) => ({ name: r.ticker, value: r.actual_cost })),
    [displayRows]
  )

  const currencyLabel = currency

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando dados...</div>
  }
  if (error) return <div className="p-6 text-destructive">Erro: {error}</div>

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          <CheckCircle className="h-4 w-4 shrink-0" />
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Simulador de Investimento</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ferramente de apoio à decisão. Não constitui recomendação de investimento.
          </p>
        </div>
      </div>

      {/* Eligibility summary */}
      <Card>
        <CardContent className="px-6 py-4">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                <span className="font-medium text-foreground">{eligibleTickers.length} ticker{eligibleTickers.length !== 1 ? 's' : ''}</span>
                {' '}elegíveis de {rawData.length} total — critérios: sinal Bazin = COMPRA <em>e</em> Margem de Segurança Graham ≥ 30%.
              </p>
              {eligibleTickers.length > 0 && (
                <p className="text-xs">
                  {eligibleTickers.map((t) => t.ticker).join(', ')}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Input */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Valor a Investir</CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <div className="flex items-end gap-4 max-w-sm">
            <div className="flex-1 space-y-2">
              <Label htmlFor="amount">Montante ({currencyLabel})</Label>
              <Input
                id="amount"
                type="number"
                min="0"
                step="any"
                placeholder="10000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCalculate()}
              />
            </div>
            <Button
              onClick={handleCalculate}
              disabled={eligibleTickers.length < 2 || !amount}
              className="gap-2"
            >
              <Calculator className="h-4 w-4" />
              Calcular Alocação
            </Button>
          </div>
          {eligibleTickers.length < 2 && (
            <p className="mt-3 text-sm text-amber-600">
              Tickers insuficientes que atendem aos critérios (sinal Bazin COMPRA + Margem Graham ≥ 30%).
              Adicione mais tickers ou verifique a atualização dos dados.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {calculated && displayRows.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Alocação Sugerida</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportCSV} className="gap-2">
                <Download className="h-4 w-4" />
                Exportar CSV
              </Button>
              <Button
                size="sm"
                onClick={handleAddToPortfolio}
                disabled={addingToPortfolio || displayRows.every((r) => r.shares === 0)}
                className="gap-2"
              >
                <Briefcase className="h-4 w-4" />
                {addingToPortfolio ? 'Adicionando...' : 'Adicionar ao Portfólio'}
              </Button>
            </div>
          </div>

          {/* Donut chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Distribuição por Ticker</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={75}
                    outerRadius={120}
                    dataKey="value"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    labelLine={false}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    label={(props: any) => (
                      <PieSliceLabel
                        cx={props.cx}
                        cy={props.cy}
                        midAngle={props.midAngle}
                        innerRadius={props.innerRadius}
                        outerRadius={props.outerRadius}
                        percent={props.percent}
                        ticker={props.name}
                      />
                    )}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any) => [fmt(value as number, currency), 'Custo']}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Results table */}
          <div className="rounded-lg border overflow-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  {[
                    'Ticker', 'Empresa', 'DY%', 'Peso%', 'Alocado',
                    'Qtd', 'Custo', 'Div. Anual Est.', 'Margem Seg.%', 'Sinal',
                  ].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {displayRows.map((r, i) => (
                  <tr key={r.ticker} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        {r.ticker}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate">
                      {r.company_name ?? '-'}
                    </td>
                    <td className="px-3 py-2">{fmtPct(r.dividend_yield)}</td>
                    <td className="px-3 py-2 font-medium">{fmtPct(r.weight_pct)}</td>
                    <td className="px-3 py-2">{fmt(r.allocated, currency)}</td>
                    <td className="px-3 py-2 w-24">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={r.shares_override ?? r.shares}
                        onChange={(e) => handleOverride(r.ticker, e.target.value)}
                        className="h-7 px-2 text-sm w-20"
                      />
                    </td>
                    <td className="px-3 py-2">{fmt(r.actual_cost, currency)}</td>
                    <td className="px-3 py-2 text-green-700 font-medium">{fmt(r.est_annual_div, currency)}</td>
                    <td className="px-3 py-2">
                      <span className={`${r.margin_of_safety >= 30 ? 'text-green-600' : 'text-yellow-600'} font-medium`}>
                        {fmtNumber(r.margin_of_safety)}%
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                        COMPRA
                      </span>
                    </td>
                  </tr>
                ))}

                {/* Summary row */}
                <tr className="bg-muted/60 font-semibold border-t-2 border-border">
                  <td className="px-3 py-2" colSpan={4}>Total</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2">{totals.totalShares}</td>
                  <td className="px-3 py-2">{fmt(totals.totalCost, currency)}</td>
                  <td className="px-3 py-2 text-green-700">{fmt(totals.totalAnnualDiv, currency)}</td>
                  <td className="px-3 py-2" colSpan={2} />
                </tr>
                <tr className="bg-muted/40 text-xs text-muted-foreground">
                  <td className="px-3 py-1.5" colSpan={4}>Troco (não alocado)</td>
                  <td className="px-3 py-1.5" colSpan={6}>{fmt(totals.totalLeftover, currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
