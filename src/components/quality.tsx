/**
 * Reusable UI primitives for displaying Quality Score, company profile, data
 * quality, and per-method component signals. Shared by Screener, Dashboard
 * and Analysis pages.
 */
import { Star, Check, X, Minus, CircleSlash, ShieldCheck, ShieldAlert } from 'lucide-react'
import type { QualityScoreResult, DataQualityResult, ComponentScore } from '@/lib/calculations'

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export function qualityColorClasses(color: QualityScoreResult['color']): string {
  switch (color) {
    case 'green-dark': return 'bg-green-600 text-white border-transparent'
    case 'green':      return 'bg-green-100 text-green-800 border-green-300'
    case 'yellow':     return 'bg-yellow-100 text-yellow-800 border-yellow-300'
    case 'orange':     return 'bg-orange-100 text-orange-800 border-orange-300'
    case 'red':        return 'bg-red-100 text-red-800 border-red-300'
  }
}

export function qualityAccentHex(color: QualityScoreResult['color']): string {
  switch (color) {
    case 'green-dark': return '#16a34a'
    case 'green':      return '#22c55e'
    case 'yellow':     return '#eab308'
    case 'orange':     return '#f97316'
    case 'red':        return '#ef4444'
  }
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

export function StarRating({ stars, size = 14 }: { stars: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${stars} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={i <= stars ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-muted-foreground/40'}
        />
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Quality Score badge (score + stars)
// ---------------------------------------------------------------------------

export function QualityScoreBadge({
  result,
  showStars = true,
  className = '',
}: {
  result: QualityScoreResult
  showStars?: boolean
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${qualityColorClasses(result.color)} ${className}`}
      title={`${result.category} — ${Math.round(result.score)}/120`}
    >
      <span>{Math.round(result.score)}</span>
      {showStars && <StarRating stars={result.stars} size={11} />}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Profile badge
// ---------------------------------------------------------------------------

export function ProfileBadge({
  label,
  description,
  className = '',
}: {
  label: string
  description?: string
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ${className}`}
      title={description}
    >
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Data quality indicator
// ---------------------------------------------------------------------------

export function DataQualityIcon({ result }: { result: DataQualityResult }) {
  const tip =
    result.level === 'HIGH'
      ? `Qualidade de dados alta (${result.score}/100)`
      : `Qualidade de dados ${result.level === 'MEDIUM' ? 'média' : 'baixa'} (${result.score}/100)` +
        (result.missingFields.length > 0 ? ` — faltando: ${result.missingFields.join(', ')}` : '')

  const icon =
    result.level === 'HIGH'
      ? <ShieldCheck className="h-4 w-4 text-green-600" />
      : result.level === 'MEDIUM'
        ? <ShieldAlert className="h-4 w-4 text-yellow-600" />
        : <CircleSlash className="h-4 w-4 text-red-500" />

  return <span className="inline-flex" title={tip}>{icon}</span>
}

export function DataQualityBadge({ result }: { result: DataQualityResult }) {
  const cls =
    result.level === 'HIGH'
      ? 'bg-green-100 text-green-800 border-green-300'
      : result.level === 'MEDIUM'
        ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
        : 'bg-red-100 text-red-800 border-red-300'
  const tip = result.missingFields.length > 0 ? `Faltando: ${result.missingFields.join(', ')}` : 'Todos os campos disponíveis'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
      title={tip}
    >
      {result.level === 'HIGH' ? <ShieldCheck className="h-3 w-3" /> : result.level === 'MEDIUM' ? <ShieldAlert className="h-3 w-3" /> : <CircleSlash className="h-3 w-3" />}
      {result.level === 'HIGH' ? 'HIGH' : result.level === 'MEDIUM' ? 'MEDIUM' : 'LOW'}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Per-method component icons
// ---------------------------------------------------------------------------

const COMPONENT_SHORT: Record<string, string> = {
  Bazin: 'B', Graham: 'G', DCF: 'D', Relativo: 'R', DDM: '$', Analyst: 'A',
}

function signalIcon(signal: ComponentScore['signal']) {
  switch (signal) {
    case 'POSITIVE': return <Check className="h-3 w-3 text-green-600" />
    case 'NEGATIVE': return <X className="h-3 w-3 text-red-500" />
    case 'NEUTRAL':  return <Minus className="h-3 w-3 text-yellow-600" />
    case 'N/A':      return <Minus className="h-3 w-3 text-muted-foreground/40" />
  }
}

export function ComponentIcons({ components }: { components: ComponentScore[] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {components.map((c) => {
        const naReason = !c.applicable ? `${c.name}: não aplicável para este perfil` : `${c.name}: ${c.score != null ? Math.round(c.score) : '—'}`
        return (
          <span
            key={c.name}
            className="inline-flex items-center gap-0.5"
            title={naReason}
          >
            <span className="text-[10px] font-semibold text-muted-foreground">{COMPONENT_SHORT[c.name] ?? c.name[0]}</span>
            {signalIcon(c.signal)}
          </span>
        )
      })}
    </span>
  )
}
