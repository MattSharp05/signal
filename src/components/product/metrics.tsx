import { shortSourceName } from '@core/connectors/index.ts'
import { EVIDENCE_LABEL, METRIC_META, formatMetricValue } from '@core/metrics.ts'
import type { MetricObservation, SummaryMetric, SummaryMetrics } from '@core/types.ts'
import { pickCardMetrics } from '@core/summarize.ts'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import { cn, formatDate } from '@/lib/utils'
import { ConfidenceIndicator, EvidenceDot } from './atoms'

function valueColor(m: SummaryMetric) {
  if (METRIC_META[m.metric].unit !== 'percent') return 'text-text'
  return m.value > 0 ? 'text-positive' : m.value < 0 ? 'text-negative' : 'text-text'
}

/** Up to 3 dynamically chosen metrics; each opens its evidence. Never fills missing values. */
export function ProductMetrics({ summary, observations, className }: { summary: SummaryMetrics; observations?: MetricObservation[]; className?: string }) {
  const metrics = pickCardMetrics(summary, 3)
  if (!metrics.length) {
    return <div className={cn('text-xs text-subtle', className)}>No metrics collected yet</div>
  }
  return (
    <div className={cn('grid grid-cols-3 gap-3', className)}>
      {metrics.map((m) => (
        <MetricCell key={m.metric} m={m} observations={observations} />
      ))}
    </div>
  )
}

export function MetricCell({ m, observations, large }: { m: SummaryMetric; observations?: MetricObservation[]; large?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="group min-w-0 rounded text-left" onClick={(e) => e.stopPropagation()} aria-label={`${METRIC_META[m.metric].label}: evidence`}>
          <div className="flex items-center gap-1 text-2xs text-muted">
            <EvidenceDot evidence={m.evidence} />
            <span className="truncate">{METRIC_META[m.metric].short}</span>
            {m.conflict ? <AlertTriangle className="size-3 text-warning" aria-label="Sources disagree" /> : null}
          </div>
          <div className={cn('tnum font-semibold tracking-tight group-hover:underline decoration-border-strong underline-offset-2', large ? 'text-lg' : 'text-[15px]', valueColor(m))}>
            {formatMetricValue(m.metric, m.value)}
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" onClick={(e) => e.stopPropagation()}>
        <EvidenceDetail m={m} observations={observations} />
      </PopoverContent>
    </Popover>
  )
}

export function EvidenceDetail({ m, observations }: { m: SummaryMetric; observations?: MetricObservation[] }) {
  const all = (observations ?? []).filter((o) => o.metric === m.metric).sort((a, b) => (b.asOf ?? b.collectedAt).localeCompare(a.asOf ?? a.collectedAt))
  const primary = all.find((o) => o.id === m.observationId)
  return (
    <div className="space-y-2 text-[13px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-muted">{METRIC_META[m.metric].label}</div>
          <div className="tnum text-lg font-semibold">{formatMetricValue(m.metric, m.value)}</div>
        </div>
        <ConfidenceIndicator evidence={m.evidence} />
      </div>
      <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted">Source</dt>
        <dd>
          <a className="inline-flex items-center gap-1 text-accent hover:underline" href={m.sourceUrl} target="_blank" rel="noreferrer">
            {shortSourceName(m.sourceId)} <ExternalLink className="size-3" />
          </a>
        </dd>
        <dt className="text-muted">Period</dt>
        <dd>{m.periodLabel ?? 'Not stated'}</dd>
        <dt className="text-muted">As of</dt>
        <dd>{m.asOf ? formatDate(m.asOf) : 'Not stated'}</dd>
        <dt className="text-muted">Confidence</dt>
        <dd className="capitalize">{m.confidence}</dd>
        {primary?.attribution ? (
          <>
            <dt className="text-muted">Attribution</dt>
            <dd>{primary.attribution}</dd>
          </>
        ) : null}
        <dt className="text-muted">Collected</dt>
        <dd>{primary ? formatDate(primary.collectedAt) : '—'}</dd>
      </dl>
      {primary?.quote ? <blockquote className="border-l-2 border-border pl-2 text-xs text-muted">“{primary.quote}”</blockquote> : null}
      {primary?.note ? <p className="text-xs text-warning">{primary.note}</p> : null}
      {all.length > 1 ? (
        <div className="border-t border-border pt-2">
          <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-subtle">All observations ({all.length})</div>
          <ul className="max-h-36 space-y-1 overflow-auto">
            {all.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted">
                  {shortSourceName(o.sourceId)} · {o.periodLabel ?? formatDate(o.asOf ?? o.collectedAt)}
                </span>
                <span className="tnum shrink-0 font-medium" title={EVIDENCE_LABEL[o.evidence]}>
                  {formatMetricValue(o.metric, o.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {m.conflict ? (
        <p className="flex gap-1.5 rounded bg-warning-soft p-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Sources disagree on this figure. Both observations are kept; see Sources &amp; Evidence for the explanation.
        </p>
      ) : null}
    </div>
  )
}

/** Small inline SVG chart for a metric's history (no chart library needed). */
export function MetricHistoryChart({ points, metric, height = 64 }: { points: MetricObservation[]; metric: MetricObservation['metric']; height?: number }) {
  if (points.length < 2) return null
  const w = 280
  const vals = points.map((p) => p.value)
  const min = Math.min(...vals, 0)
  const max = Math.max(...vals)
  const x = (i: number) => (i / (points.length - 1)) * (w - 8) + 4
  const y = (v: number) => height - 14 - ((v - min) / (max - min || 1)) * (height - 24)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={`${METRIC_META[metric].label} history`}>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={p.id}>
          <circle cx={x(i)} cy={y(p.value)} r="2.5" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.5">
            <title>{`${p.periodLabel ?? formatDate(p.asOf)}: ${formatMetricValue(metric, p.value)}`}</title>
          </circle>
          {i === 0 || i === points.length - 1 ? (
            <text x={x(i)} y={height - 2} fontSize="9" textAnchor={i === 0 ? 'start' : 'end'} fill="var(--muted)">
              {p.periodLabel ?? formatDate(p.asOf)}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  )
}
