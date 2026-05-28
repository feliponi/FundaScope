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
  fmtCurrency,
  fmtPct,
  fmtNumber,
} from '@/lib/calculations'
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

type PortfolioRow = {
  id: string
  ticker: string
  quantity: number
  avg_price: number
  company_name?: string | null
  currency?: string | null
  current_price?: number | null
  dividend_yield?: number | null
}

type TickerOption = { ticker: string; company_name: string | null }

export default function Portfolio() {
  const [rows, setRows] = useState<PortfolioRow[]>([])
  const [tickers, setTickers] = useState<TickerOption[]>([])
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

    const [portfolioRes, pricesRes, fundRes, profilesRes, tickersRes] = await Promise.all([
      supabase.from('portfolios').select('*').eq('user_id', user.id),
      supabase.from('stock_prices').select('ticker, price'),
      supabase.from('stock_fundamentals').select('ticker, dividend_yield'),
      supabase.from('stock_profiles').select('ticker, company_name, currency'),
      supabase.from('tickers').select('ticker'),
    ])

    if (portfolioRes.error) { setError(portfolioRes.error.message); setLoading(false); return }

    const priceMap = new Map((pricesRes.data ?? []).map((r) => [r.ticker, r.price]))
    const fundMap = new Map((fundRes.data ?? []).map((r) => [r.ticker, r.dividend_yield]))
    const profileMap = new Map((profilesRes.data ?? []).map((r) => [r.ticker, r]))

    const enriched = (portfolioRes.data ?? []).map((p) => ({
      ...p,
      company_name: profileMap.get(p.ticker)?.company_name ?? null,
      currency: profileMap.get(p.ticker)?.currency ?? null,
      current_price: priceMap.get(p.ticker) ?? null,
      dividend_yield: fundMap.get(p.ticker) ?? null,
    }))
    setRows(enriched)

    const heldTickers = new Set(enriched.map((r) => r.ticker))
    const allTickers = (tickersRes.data ?? []).map((t) => ({
      ticker: t.ticker,
      company_name: profileMap.get(t.ticker)?.company_name ?? null,
    })).filter((t) => !heldTickers.has(t.ticker))
    setTickers(allTickers)

    setLoading(false)
  }

  const enrichedRows = useMemo(() => {
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
    const totalInvested = enrichedRows.reduce((s, r) => s + (r.cost_basis ?? 0), 0)
    const totalValue = enrichedRows.reduce((s, r) => s + (r.current_value ?? 0), 0)
    const totalPl = totalValue - totalInvested
    const totalPlPct = totalInvested > 0 ? totalPl / totalInvested : null
    const totalDiv = enrichedRows.reduce((s, r) => s + (r.annual_div ?? 0), 0)
    const portfolioYield = totalValue > 0 ? totalDiv / totalValue : null
    return { totalInvested, totalValue, totalPl, totalPlPct, totalDiv, portfolioYield }
  }, [enrichedRows])

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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Total Investido *', value: summary.totalInvested.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) },
          { label: 'Valor Atual *', value: summary.totalValue.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) },
          {
            label: 'P&L *',
            value: summary.totalPl.toLocaleString('pt-BR', { maximumFractionDigits: 2, signDisplay: 'exceptZero' }),
            color: summary.totalPl >= 0 ? 'text-green-600' : 'text-red-600',
          },
          {
            label: 'P&L (%)',
            value: fmtPct(summary.totalPlPct),
            color: (summary.totalPlPct ?? 0) >= 0 ? 'text-green-600' : 'text-red-600',
          },
          { label: 'Div. Anuais Est. *', value: summary.totalDiv.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) },
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
      <p className="text-xs text-muted-foreground -mt-2">
        * Totais somados na moeda original de cada ativo (sem conversão cambial).
      </p>

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
                <td className="px-3 py-2">{fmtCurrency(r.avg_price, r.currency)}</td>
                <td className="px-3 py-2">{r.current_price != null ? fmtCurrency(r.current_price, r.currency) : '-'}</td>
                <td className="px-3 py-2">{r.current_value != null ? fmtCurrency(r.current_value, r.currency) : '-'}</td>
                <td className="px-3 py-2">{r.cost_basis != null ? fmtCurrency(r.cost_basis, r.currency) : '-'}</td>
                <td className={`px-3 py-2 font-medium ${(r.pl_abs ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <span className="flex items-center gap-1">
                    {(r.pl_abs ?? 0) >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {r.pl_abs != null ? fmtCurrency(r.pl_abs, r.currency) : '-'}
                  </span>
                </td>
                <td className={`px-3 py-2 font-medium ${(r.pl_pct ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {r.pl_pct != null ? fmtPct(r.pl_pct) : '-'}
                </td>
                <td className="px-3 py-2">{r.dividend_yield != null ? `${(r.dividend_yield * 100).toFixed(2)}%` : '-'}</td>
                <td className="px-3 py-2">{r.annual_div != null ? fmtCurrency(r.annual_div, r.currency) : '-'}</td>
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
