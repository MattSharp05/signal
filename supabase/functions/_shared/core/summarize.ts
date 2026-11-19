import { CARD_PRIORITY, EVIDENCE_RANK, METRIC_META, REVENUE_METRICS, monthlyRevenueEquivalent } from './metrics.ts'
import type { MetricObservation, MetricType, Product, ProductStage, SummaryMetric, SummaryMetrics } from './types.ts'

const CONFLICT_RATIO = 0.25

function obsTime(o: MetricObservation): number {
  return new Date(o.asOf ?? o.periodEnd ?? o.publishedAt ?? o.collectedAt).getTime()
}

/** Preferred observation per metric: most trusted evidence, then newest. Flags conflicts across sources for the same period label. */
export function computeSummaryMetrics(observations: MetricObservation[]): SummaryMetrics {
  const byMetric = new Map<MetricType, MetricObservation[]>()
  for (const o of observations) {
    if (!byMetric.has(o.metric)) byMetric.set(o.metric, [])
    byMetric.get(o.metric)!.push(o)
  }
  const out: SummaryMetrics = {}
  for (const [metric, list] of byMetric) {
    const sorted = [...list].sort((a, b) => EVIDENCE_RANK[b.evidence] - EVIDENCE_RANK[a.evidence] || obsTime(b) - obsTime(a))
    const best = sorted[0]
    out[metric] = {
      metric,
      value: best.value,
      unit: best.unit,
      evidence: best.evidence,
      confidence: best.confidence,
      observationId: best.id,
      sourceId: best.sourceId,
      sourceUrl: best.sourceUrl,
      periodLabel: best.periodLabel,
      asOf: best.asOf,
      conflict: findConflicts(list).length > 0,
      observationCount: list.length,
    }
  }
  return out
}

export interface Conflict {
  metric: MetricType
  a: MetricObservation
  b: MetricObservation
  ratio: number
}

/** Same metric, roughly the same period, different sources, values differing > 25%. */
export function findConflicts(list: MetricObservation[]): Conflict[] {
  const out: Conflict[] = []
  const latestPerSource = new Map<string, MetricObservation>()
  for (const o of list) {
    const k = o.sourceId
    const cur = latestPerSource.get(k)
    if (!cur || obsTime(o) > obsTime(cur)) latestPerSource.set(k, o)
  }
  const arr = [...latestPerSource.values()]
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i]
      const b = arr[j]
      if (METRIC_META[a.metric].unit === 'percent') continue
      const days = Math.abs(obsTime(a) - obsTime(b)) / 86400_000
      if (days > 45) continue
      const hi = Math.max(a.value, b.value)
      const lo = Math.min(a.value, b.value)
      if (hi === 0) continue
      const ratio = (hi - lo) / hi
      if (ratio > CONFLICT_RATIO) out.push({ metric: a.metric, a, b, ratio })
    }
  }
  return out
}

export function explainConflict(c: Conflict, sourceName: (id: string) => string): string {
  const pct = Math.round(c.ratio * 100)
  const parts = [`${sourceName(c.a.sourceId)} and ${sourceName(c.b.sourceId)} differ by ${pct}%.`]
  if (c.a.evidence !== c.b.evidence) parts.push(`They are different kinds of evidence (${c.a.evidence.replace('_', ' ')} vs ${c.b.evidence.replace('_', ' ')}).`)
  if ((c.a.periodLabel ?? '') !== (c.b.periodLabel ?? '')) parts.push(`They describe different periods ("${c.a.periodLabel ?? 'unspecified'}" vs "${c.b.periodLabel ?? 'unspecified'}").`)
  if (c.a.attribution || c.b.attribution) parts.push('Third-party estimators use different panels and models.')
  parts.push('Both observations are preserved; neither is averaged.')
  return parts.join(' ')
}

/** Pick up to n card metrics by priority among available ones; skip near-duplicates (e.g., two revenue figures). */
export function pickCardMetrics(summary: SummaryMetrics, n = 3): SummaryMetric[] {
  const out: SummaryMetric[] = []
  let revenueShown = 0
  for (const m of CARD_PRIORITY) {
    const s = summary[m]
    if (!s) continue
    if (REVENUE_METRICS.includes(m)) {
      if (revenueShown >= 2) continue
      revenueShown++
    }
    if (m === 'checkout_visits_monthly' && out.some((o) => o.metric === 'monthly_visits')) continue
    if (m === 'comments' && out.length >= 2) continue
    out.push(s)
    if (out.length >= n) break
  }
  return out
}

export function bestMonthlyRevenue(summary: SummaryMetrics): { value: number; evidence: SummaryMetric['evidence'] } | null {
  let best: { value: number; evidence: SummaryMetric['evidence']; rank: number } | null = null
  for (const m of ['mrr', 'revenue_30d', 'arr', 'revenue_run_rate'] as MetricType[]) {
    const s = summary[m]
    if (!s) continue
    const v = monthlyRevenueEquivalent(m, s.value)
    if (v == null) continue
    const rank = EVIDENCE_RANK[s.evidence]
    if (!best || rank > best.rank) best = { value: v, evidence: s.evidence, rank }
  }
  return best ? { value: best.value, evidence: best.evidence } : null
}

const LAUNCH_SOURCES = new Set(['hn_show', 'producthunt_feed', 'producthunt_api', 'github_rising', 'reddit'])

export function computeStage(p: Pick<Product, 'firstDiscoveredAt' | 'launchDate' | 'sourceIds'>, summary: SummaryMetrics, now = new Date()): ProductStage {
  const rev = bestMonthlyRevenue(summary)
  const users = Math.max(summary.users?.value ?? 0, summary.accounts?.value ?? 0, summary.customers?.value ? summary.customers.value * 10 : 0)
  const checkout = summary.checkout_visits_monthly?.value ?? 0
  if ((rev && rev.value >= 10_000) || users >= 100_000 || checkout >= 20_000) return 'established'
  if ((rev && rev.value > 0) || users > 0 || checkout > 0 || summary.monthly_visits || summary.customers?.value) return 'early_traction'
  const launch = new Date(p.launchDate ?? p.firstDiscoveredAt).getTime()
  if (p.sourceIds.some((s) => LAUNCH_SOURCES.has(s)) && now.getTime() - launch < 60 * 86400_000) return 'new_launch'
  return 'unknown'
}

/** Metric history for charts: observations of one metric ordered by time. */
export function metricHistory(observations: MetricObservation[], metric: MetricType): MetricObservation[] {
  return observations.filter((o) => o.metric === metric).sort((a, b) => obsTime(a) - obsTime(b))
}

export function derivedColumns(summary: SummaryMetrics): Pick<Product, 'monthlyRevenue' | 'revenueEvidence' | 'growthPct' | 'evidenceLevel'> {
  const rev = bestMonthlyRevenue(summary)
  const g = summary.mrr_growth_pct ?? summary.revenue_growth_pct ?? summary.traffic_growth_pct
  let level: SummaryMetric['evidence'] | null = null
  for (const m of Object.values(summary)) {
    if (m && m.metric !== 'upvotes' && m.metric !== 'comments' && m.metric !== 'stars' && (!level || EVIDENCE_RANK[m.evidence] > EVIDENCE_RANK[level])) level = m.evidence
  }
  if (!level && Object.values(summary).length) level = 'platform_metric'
  return { monthlyRevenue: rev ? Math.round(rev.value) : null, revenueEvidence: rev?.evidence ?? null, growthPct: g ? Math.round(g.value * 10) / 10 : null, evidenceLevel: level }
}
