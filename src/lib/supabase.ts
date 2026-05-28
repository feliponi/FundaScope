import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (import.meta.env.SUPABASE_URL ?? '') as string
const supabaseAnonKey = (import.meta.env.SUPABASE_ANON_KEY ?? '') as string

export const supabaseReady = !!(supabaseUrl && supabaseAnonKey)

// createClient is called even when vars are missing so the module always
// exports a valid object — App.tsx checks supabaseReady before using it.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
)

export type Database = {
  public: {
    Tables: {
      tickers: {
        Row: { ticker: string; last_update: string | null }
        Insert: { ticker: string; last_update?: string | null }
        Update: { ticker?: string; last_update?: string | null }
      }
      stock_profiles: {
        Row: {
          ticker: string
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
      }
      stock_prices: {
        Row: {
          ticker: string
          price: number | null
          price_date: string | null
          updated_at: string | null
        }
      }
      stock_fundamentals: {
        Row: {
          ticker: string
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
      }
      portfolios: {
        Row: {
          id: string
          user_id: string
          ticker: string
          quantity: number
          avg_price: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          ticker: string
          quantity: number
          avg_price: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          quantity?: number
          avg_price?: number
          updated_at?: string
        }
      }
      price_alerts: {
        Row: {
          id: string
          user_id: string
          ticker: string
          target_price: number
          direction: 'above' | 'below'
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          ticker: string
          target_price: number
          direction: 'above' | 'below'
          is_active?: boolean
        }
      }
      alerts_triggered: {
        Row: {
          id: string
          user_id: string
          ticker: string
          target_price: number
          triggered_price: number
          direction: string
          triggered_at: string
        }
      }
      ticker_notes: {
        Row: {
          id: string
          user_id: string
          ticker: string
          content: string
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id?: string
          ticker: string
          content: string
          updated_at?: string
        }
      }
      portfolio_snapshots: {
        Row: {
          id: string
          user_id: string
          total_value: number
          total_cost: number
          snapshot_date: string
        }
      }
    }
  }
}
