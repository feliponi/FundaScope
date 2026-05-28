import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

export type DisplayCurrency = 'USD' | 'BRL' | 'EUR'

/** USD-based exchange rates, e.g. { USD:1, BRL:5.89, EUR:0.92 } */
type Rates = { USD: 1; BRL: number; EUR: number }

type CurrencyCtx = {
  currency: DisplayCurrency
  setCurrency: (c: DisplayCurrency) => void
  rates: Rates | null
  ratesUpdatedAt: Date | null
  ratesLoading: boolean
  ratesError: string | null
  refreshRates: () => void
  /** Convert `amount` from `fromCurrency` to the currently selected display currency */
  convert: (amount: number, fromCurrency: string) => number
  /** Convert + format in the selected display currency */
  fmt: (amount: number | null | undefined, fromCurrency: string | null | undefined) => string
}

const Ctx = createContext<CurrencyCtx | null>(null)

const LOCALES: Record<DisplayCurrency, string> = {
  BRL: 'pt-BR',
  USD: 'en-US',
  EUR: 'de-DE',
}

// Reasonable fallback rates used when the API is unreachable on first load
const FALLBACK_RATES: Rates = { USD: 1, BRL: 5.85, EUR: 0.92 }

const STORAGE_KEY_CURRENCY = 'fundascope_currency'
const STORAGE_KEY_RATES = 'fundascope_rates'
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000   // 6 hours

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<DisplayCurrency>(() => {
    const stored = localStorage.getItem(STORAGE_KEY_CURRENCY)
    return (stored as DisplayCurrency) ?? 'BRL'
  })

  const [rates, setRates] = useState<Rates | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_RATES)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })

  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<Date | null>(null)
  const [ratesLoading, setRatesLoading] = useState(!rates)
  const [ratesError, setRatesError] = useState<string | null>(null)

  const fetchRates = useCallback(async () => {
    setRatesLoading(true)
    setRatesError(null)
    try {
      const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=BRL,EUR')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const newRates: Rates = { USD: 1, BRL: data.rates.BRL, EUR: data.rates.EUR }
      setRates(newRates)
      setRatesUpdatedAt(new Date())
      localStorage.setItem(STORAGE_KEY_RATES, JSON.stringify(newRates))
    } catch {
      setRatesError('Cotações offline — usando última taxa conhecida.')
      if (!rates) {
        setRates(FALLBACK_RATES)
      }
    } finally {
      setRatesLoading(false)
    }
  }, [rates])

  useEffect(() => {
    fetchRates()
    const id = setInterval(fetchRates, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  function setCurrency(c: DisplayCurrency) {
    setCurrencyState(c)
    localStorage.setItem(STORAGE_KEY_CURRENCY, c)
  }

  function convert(amount: number, fromCurrency: string): number {
    if (!rates) return amount
    const from = fromCurrency.toUpperCase() as DisplayCurrency
    const to = currency
    if (from === to) return amount
    // fromCurrency → USD → displayCurrency
    const fromRate = (rates as Record<string, number>)[from] ?? 1
    const toRate = (rates as Record<string, number>)[to] ?? 1
    return (amount / fromRate) * toRate
  }

  function fmt(amount: number | null | undefined, fromCurrency: string | null | undefined): string {
    if (amount == null) return '-'
    const converted = convert(amount, fromCurrency ?? 'USD')
    const locale = LOCALES[currency] ?? 'en-US'
    return converted.toLocaleString(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    })
  }

  return (
    <Ctx.Provider value={{
      currency, setCurrency,
      rates, ratesUpdatedAt, ratesLoading, ratesError,
      refreshRates: fetchRates,
      convert, fmt,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useCurrency(): CurrencyCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider')
  return ctx
}
