import { useEffect, useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { supabase, supabaseReady } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'
import Login from '@/pages/Login'
import Screener from '@/pages/Screener'
import Portfolio from '@/pages/Portfolio'
import Analysis from '@/pages/Analysis'
import { TrendingUp, BarChart2, Briefcase, LogOut, Bell, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CurrencyProvider, useCurrency, type DisplayCurrency } from '@/lib/currency'

const CURRENCIES: DisplayCurrency[] = ['BRL', 'USD', 'EUR']

function CurrencySelector() {
  const { currency, setCurrency, ratesLoading, ratesError } = useCurrency()
  return (
    <div className="flex items-center gap-1">
      {CURRENCIES.map((c) => (
        <button
          key={c}
          onClick={() => setCurrency(c)}
          title={ratesError ?? undefined}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            currency === c
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          {c}
        </button>
      ))}
      {ratesLoading && <span className="text-xs text-muted-foreground ml-1">…</span>}
    </div>
  )
}

type TriggeredAlert = { id: string; ticker: string; triggered_at: string }

function AlertsBanner({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState<TriggeredAlert[]>([])
  const [dismissed, setDismissed] = useState(false)

  const fetchAlerts = useCallback(async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from('alerts_triggered')
      .select('id, ticker, triggered_at')
      .eq('user_id', userId)
      .gte('triggered_at', sevenDaysAgo)
      .order('triggered_at', { ascending: false })
    setAlerts(data ?? [])
  }, [userId])

  useEffect(() => { fetchAlerts() }, [fetchAlerts])

  async function handleDismiss() {
    await supabase.from('alerts_triggered').delete().eq('user_id', userId)
    setDismissed(true)
  }

  if (dismissed || alerts.length === 0) return null

  const firstTicker = alerts[0].ticker

  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <div className="max-w-screen-xl mx-auto px-4 py-2 flex items-center justify-between gap-4">
        <button
          className="flex items-center gap-2 text-sm text-amber-800 hover:text-amber-900 font-medium flex-1 text-left"
          onClick={() => navigate(`/analysis/${firstTicker}`)}
        >
          <Bell className="h-4 w-4 shrink-0" />
          {alerts.length} alerta{alerts.length > 1 ? 's' : ''} de preço atingido{alerts.length > 1 ? 's' : ''}.
          Clique para ver em {firstTicker}.
        </button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-amber-700 hover:text-amber-900 hover:bg-amber-100" onClick={handleDismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function Layout({ children, session }: { children: React.ReactNode; session: Session | null }) {
  const navigate = useNavigate()

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
    }`

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <NavLink to="/screener" className="flex items-center gap-2 text-primary font-bold text-lg">
              <TrendingUp className="h-5 w-5" />
              FundaScope
            </NavLink>
            <nav className="flex items-center gap-1">
              <NavLink to="/screener" className={navLinkClass}>
                <BarChart2 className="h-4 w-4" />
                Screener
              </NavLink>
              <NavLink to="/portfolio" className={navLinkClass}>
                <Briefcase className="h-4 w-4" />
                Portfólio
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <CurrencySelector />
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-1" />
              Sair
            </Button>
          </div>
        </div>
      </header>
      {session?.user?.id && <AlertsBanner userId={session.user.id} />}
      <main className="flex-1 max-w-screen-xl mx-auto w-full px-4 py-6">
        {children}
      </main>
    </div>
  )
}

function AuthGuard({ session, children }: { session: Session | null; children: React.ReactNode }) {
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AppRoutes({ session }: { session: Session | null }) {
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/screener" replace /> : <Login />} />
      <Route
        path="/screener"
        element={
          <AuthGuard session={session}>
            <Layout session={session}><Screener /></Layout>
          </AuthGuard>
        }
      />
      <Route
        path="/portfolio"
        element={
          <AuthGuard session={session}>
            <Layout session={session}><Portfolio /></Layout>
          </AuthGuard>
        }
      />
      <Route
        path="/analysis/:ticker"
        element={
          <AuthGuard session={session}>
            <Layout session={session}><Analysis /></Layout>
          </AuthGuard>
        }
      />
      <Route path="/" element={<Navigate to={session ? '/screener' : '/login'} replace />} />
      <Route path="*" element={<Navigate to={session ? '/screener' : '/login'} replace />} />
    </Routes>
  )
}

function ConfigError() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full rounded-lg border bg-white shadow p-8 space-y-4">
        <h1 className="text-xl font-bold text-destructive">Configuração incompleta</h1>
        <p className="text-sm text-muted-foreground">
          As variáveis de ambiente do Supabase não foram encontradas. Crie um arquivo{' '}
          <code className="bg-muted px-1 rounded">.env</code> na raiz do projeto com:
        </p>
        <pre className="bg-muted rounded p-4 text-xs overflow-auto">
{`SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...      # anon/public key
SUPABASE_SERVICE_ROLE_KEY=eyJ... # service_role key (admin script only)`}
        </pre>
        <p className="text-xs text-muted-foreground">
          As chaves estão em{' '}
          <strong>Supabase Dashboard → Project Settings → API</strong>.
          Após editar o <code className="bg-muted px-1 rounded">.env</code>, reinicie o servidor de desenvolvimento.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  if (!supabaseReady) return <ConfigError />

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <CurrencyProvider>
        <AppRoutes session={session} />
      </CurrencyProvider>
    </BrowserRouter>
  )
}
