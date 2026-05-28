import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'
import Login from '@/pages/Login'
import Screener from '@/pages/Screener'
import Portfolio from '@/pages/Portfolio'
import Analysis from '@/pages/Analysis'
import { TrendingUp, BarChart2, Briefcase, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-1" />
            Sair
          </Button>
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

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

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
      <AppRoutes session={session} />
    </BrowserRouter>
  )
}
