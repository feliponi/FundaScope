import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { supabase, supabaseReady } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'
import Login from '@/pages/Login'
import Screener from '@/pages/Screener'
import Portfolio from '@/pages/Portfolio'
import Analysis from '@/pages/Analysis'
import { TrendingUp, BarChart2, Briefcase, LogOut } from 'lucide-react'
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

function Layout({ children }: { children: React.ReactNode }) {
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
            <Layout><Screener /></Layout>
          </AuthGuard>
        }
      />
      <Route
        path="/portfolio"
        element={
          <AuthGuard session={session}>
            <Layout><Portfolio /></Layout>
          </AuthGuard>
        }
      />
      <Route
        path="/analysis/:ticker"
        element={
          <AuthGuard session={session}>
            <Layout><Analysis /></Layout>
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
