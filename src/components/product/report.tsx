import { shortSourceName } from '@core/connectors/index.ts'
import { METRIC_META, REVENUE_METRICS } from '@core/metrics.ts'
import { explainConflict, findConflicts, metricHistory } from '@core/summarize.ts'
import type { MetricObservation, MetricType, OpportunityScore, ReportFact, SummaryMetric } from '@core/types.ts'
import { AlertTriangle, ExternalLink, FileText, Loader2, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/overlay'
import { useReportMutation, useWeightedScore } from '@/data/hooks'
import type { ProductDetail } from '@/data/repository'
import { cn, formatDate, hostOf } from '@/lib/utils'
import { MetricCell, MetricHistoryChart } from './metrics'

export function Section({ title, children, aside, className }: { title: string; children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-subtle">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Unavailable({ children = 'Unavailable' }: { children?: ReactNode }) {
  return <span className="text-subtle">{children}</span>
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0">{v ?? <Unavailable />}</dd>
    </>
  )
}

export function ScoreBreakdown({ score: raw }: { score: OpportunityScore | null }) {
  const score = useWeightedScore(raw)
  if (!score) return <p className="text-[13px] text-subtle">Not scored yet.</p>
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        {score.sufficient && score.overall !== null ? (
          <span className="tnum text-2xl font-semibold">{score.overall}</span>
        ) : (
          <Badge tone="warning">Insufficient evidence</Badge>
        )}
        <span className="text-xs text-muted">
          Evidence coverage {Math.round(score.coverage * 100)}% · heuristic, not a market measurement
        </span>
      </div>
      <div className="space-y-2.5">
        {score.components.map((c) => (
          <div key={c.key}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">
                {c.label} <span className="font-normal text-subtle">· weight {c.weight}%{c.assumed ? ' · assumed' : ''}</span>
              </span>
              <span className="tnum font-medium">{c.score ?? <Unavailable>No evidence</Unavailable>}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface">
              {c.score !== null ? <div className={cn('h-1.5 rounded-full', c.assumed ? 'bg-border-strong' : 'bg-accent')} style={{ width: `${c.score}%` }} /> : null}
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {c.reasons.map((r, i) => (
                <li key={i}>· {r}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function FactList({ facts, d }: { facts: ReportFact[]; d: ProductDetail }) {
  if (!facts.length) return <p className="text-[13px] text-subtle">None collected.</p>
  const mentionById = new Map(d.mentions.map((m) => [m.id, m]))
  const obsById = new Map(d.observations.map((o) => [o.id, o]))
  return (
    <ul className="space-y-1.5 text-[13px]">
      {facts.map((f, i) => {
        const refs = f.evidenceIds.map((id) => mentionById.get(id) ?? obsById.get(id)).filter(Boolean) as { id: string; sourceId: string; url?: string; sourceUrl?: string }[]
        return (
          <li key={i} className="leading-snug">
            {f.text}{' '}
            {refs.slice(0, 3).map((r) => (
              <a key={r.id} href={r.url ?? r.sourceUrl} target="_blank" rel="noreferrer" className="ml-0.5 inline-flex items-center rounded bg-surface px-1 text-2xs text-muted hover:text-accent">
                {shortSourceName(r.sourceId)}
              </a>
            ))}
          </li>
        )
      })}
    </ul>
  )
}

function bestHistoryMetric(obs: MetricObservation[]): MetricType | null {
  const counts = new Map<MetricType, number>()
  for (const o of obs) if (!['upvotes', 'comments', 'stars'].includes(o.metric)) counts.set(o.metric, (counts.get(o.metric) ?? 0) + 1)
  const pref: MetricType[] = ['mrr', 'revenue_30d', 'customers', 'checkout_visits_monthly', 'monthly_visits', 'users', 'accounts']
  return pref.find((m) => (counts.get(m) ?? 0) >= 2) ?? null
}

/** The expanded report shown inline under a card and in the research panel's Overview. */
export function ProductReport({ d, compact }: { d: ProductDetail; compact?: boolean }) {
  const p = d.product
  const report = d.report
  const gen = useReportMutation(p.id)
  const summary = Object.values(p.summaryMetrics) as SummaryMetric[]
  const revenue = summary.filter((m) => REVENUE_METRICS.includes(m.metric) || m.metric === 'customers')
  const traction = summary.filter((m) => !REVENUE_METRICS.includes(m.metric) && m.metric !== 'customers')
  const historyMetric = bestHistoryMetric(d.observations)
  const conflicts = [...new Set(d.observations.map((o) => o.metric))].flatMap((m) => findConflicts(d.observations.filter((o) => o.metric === m)))
  const competitors = d.relationships
  const isAI = report?.generator === 'ai'

  return (
    <div className={cn('space-y-6', compact && 'space-y-5')}>
      <Section title="Overview">
        {p.description ? <p className="text-[13px] leading-relaxed">{p.description}</p> : <p className="text-[13px] text-subtle">No description collected yet.</p>}
        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[13px]">
          <KV k="Website" v={p.websiteUrl ? <a href={p.websiteUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{hostOf(p.websiteUrl)}</a> : null} />
          <KV k="Category" v={p.category} />
          <KV k="Platform" v={p.platforms.length ? p.platforms.join(', ') : null} />
          <KV k="Launched" v={p.launchDate ? formatDate(p.launchDate) : null} />
          <KV k="Company" v={p.companyName} />
          <KV k="Business model" v={p.businessModel} />
          <KV k="Pricing" v={p.pricingSummary} />
          <KV k="First discovered" v={formatDate(p.firstDiscoveredAt)} />
        </dl>
      </Section>

      <Section title="Revenue & traction">
        {revenue.length + traction.length === 0 ? (
          <p className="text-[13px] text-subtle">No revenue or traction figures have been collected. Unknown — not zero.</p>
        ) : (
          <div className="space-y-3">
            {revenue.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{revenue.map((m) => <MetricCell key={m.metric} m={m} observations={d.observations} />)}</div>
            ) : (
              <p className="text-[13px] text-subtle">Revenue: unavailable.</p>
            )}
            {traction.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{traction.map((m) => <MetricCell key={m.metric} m={m} observations={d.observations} />)}</div> : null}
          </div>
        )}
        {conflicts.map((c, i) => (
          <p key={i} className="flex gap-1.5 rounded bg-warning-soft p-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <b>{METRIC_META[c.metric].label}:</b> {explainConflict(c, (id) => shortSourceName(id))}
            </span>
          </p>
        ))}
      </Section>

      {historyMetric ? (
        <Section title={`Growth history · ${METRIC_META[historyMetric].label}`}>
          <MetricHistoryChart metric={historyMetric} points={metricHistory(d.observations, historyMetric)} />
          <p className="text-2xs text-subtle">Each point is a stored observation; estimates are labeled at source.</p>
        </Section>
      ) : null}

      <Section title="Distribution">
        <FactList facts={report?.content.acquisitionChannels ?? []} d={d} />
      </Section>

      <Section title="Opportunity score">
        <ScoreBreakdown score={p.opportunityScore} />
      </Section>

      <Section title={`Sources (${p.sourceCount})`}>
        <ul className="space-y-1 text-[13px]">
          {d.mentions.slice(0, compact ? 5 : 50).map((m) => (
            <li key={m.id} className="flex items-baseline justify-between gap-3">
              <a href={m.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-accent">
                <span className="font-medium">{shortSourceName(m.sourceId)}</span> <span className="text-muted">· {m.title ?? hostOf(m.url)}</span>
              </a>
              <span className="shrink-0 text-2xs text-subtle">{m.publishedAt ? formatDate(m.publishedAt) : `collected ${formatDate(m.collectedAt)}`}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Competitors & similar">
        {competitors.length || d.similar.length ? (
          <div className="flex flex-wrap gap-1.5">
            {competitors.map((r) => (
              <Badge key={r.id} tone="outline" className="font-normal">{r.relatedName}</Badge>
            ))}
            {d.similar.slice(0, compact ? 3 : 6).map((s) => (
              <Badge key={s.id} tone="neutral" className="font-normal">{s.name}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-subtle">None identified yet.</p>
        )}
      </Section>

      <Section title="Advertising">
        {d.ads.length ? (
          <p className="text-[13px]">
            {d.ads.length} creative{d.ads.length > 1 ? 's' : ''} on record ({[...new Set(d.ads.map((a) => a.platform))].join(', ')}).
          </p>
        ) : (
          <p className="text-[13px] text-subtle">No ad creatives on record. Ad-library connectors need credentials; manual references can be added in the Advertising tab.</p>
        )}
      </Section>

      <Section
        title="Analysis"
        aside={
          report ? (
            <Tooltip content={isAI ? `Generated by ${report.model}. Facts cite stored evidence; interpretation and speculation are labeled.` : 'Rule-based summary from stored evidence. No AI, no speculation.'}>
              <span className="inline-flex">
                <Badge tone={isAI ? 'accent' : 'neutral'}>
                  {isAI ? <Sparkles /> : <FileText />}
                  {isAI ? 'AI analysis' : 'Rule-based'} · {formatDate(report.createdAt)}
                </Badge>
              </span>
            </Tooltip>
          ) : null
        }
      >
        {report ? (
          <div className="space-y-3 text-[13px]">
            {report.content.facts.length ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted">Sourced facts</div>
                <FactList facts={report.content.facts} d={d} />
              </div>
            ) : null}
            {report.content.interpretation.length ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted">Interpretation</div>
                <ul className="space-y-1">{report.content.interpretation.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            ) : null}
            {report.content.speculation.length ? (
              <div>
                <div className="mb-1 text-xs font-medium text-warning">Speculation (not evidence)</div>
                <ul className="space-y-1 text-muted">{report.content.speculation.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            ) : null}
            {report.content.technicalComplexity ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted">Technical complexity</div>
                <p>{report.content.technicalComplexity}</p>
              </div>
            ) : null}
            {report.content.opportunities.length ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted">Potential opportunities</div>
                <ul className="list-disc space-y-1 pl-4">{report.content.opportunities.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            ) : null}
            {report.content.caveats.length ? (
              <div className="rounded bg-surface p-2.5 text-xs text-muted">
                <div className="mb-1 font-medium text-text">Caveats</div>
                <ul className="space-y-1">{report.content.caveats.map((t, i) => <li key={i}>· {t}</li>)}</ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] text-subtle">No report yet.</p>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="secondary" onClick={() => gen.mutate()} disabled={gen.isPending}>
            {gen.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {report ? 'Regenerate report' : 'Generate report'}
          </Button>
          {gen.isError ? <span className="text-xs text-negative">{(gen.error as Error).message}</span> : null}
        </div>
      </Section>
      {p.websiteUrl && !compact ? (
        <a href={p.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
          Visit {hostOf(p.websiteUrl)} <ExternalLink className="size-3.5" />
        </a>
      ) : null}
    </div>
  )
}
