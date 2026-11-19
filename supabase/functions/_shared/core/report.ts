import type { EvidencePack } from './ai-types.ts'
import { shortSourceName } from './connectors/index.ts'
import { EVIDENCE_LABEL, METRIC_META, REVENUE_METRICS, formatMetricValue } from './metrics.ts'
import { explainConflict, findConflicts } from './summarize.ts'
import type { MetricObservation, ReportFact, ResearchReport } from './types.ts'

function obsFact(o: MetricObservation): ReportFact {
  const src = shortSourceName(o.sourceId)
  const period = o.periodLabel ? `, ${o.periodLabel}` : ''
  const attr = o.attribution ? ` (${o.attribution})` : ''
  return { text: `${METRIC_META[o.metric].label}: ${formatMetricValue(o.metric, o.value)}${period} — ${EVIDENCE_LABEL[o.evidence].toLowerCase()} from ${src}${attr}.`, evidenceIds: [o.id] }
}

function latestPerMetricSource(obs: MetricObservation[]): MetricObservation[] {
  const m = new Map<string, MetricObservation>()
  for (const o of obs) {
    const k = `${o.metric}|${o.sourceId}|${o.evidence}`
    const cur = m.get(k)
    const t = (x: MetricObservation) => x.asOf ?? x.periodEnd ?? x.collectedAt
    if (!cur || t(o) > t(cur)) m.set(k, o)
  }
  return [...m.values()]
}

/**
 * Deterministic report built only from stored evidence. Contains no speculation by design.
 * Used when AI is not configured and as the "lite" tier.
 */
export function buildRuleReport(pack: EvidencePack): ResearchReport['content'] {
  const { product: p, mentions, observations, relationships } = pack
  const latest = latestPerMetricSource(observations)
  const revenue = latest.filter((o) => REVENUE_METRICS.includes(o.metric) || o.metric === 'customers')
  const demand = latest.filter((o) => ['checkout_visits_monthly', 'checkout_visits_total', 'monthly_visits', 'users', 'accounts', 'downloads', 'upvotes', 'stars', 'traffic_growth_pct', 'mrr_growth_pct', 'revenue_growth_pct', 'global_rank'].includes(o.metric))
  const facts: ReportFact[] = []
  const firstMention = [...mentions].sort((a, b) => (a.publishedAt ?? a.discoveredAt).localeCompare(b.publishedAt ?? b.discoveredAt))[0]
  if (firstMention) facts.push({ text: `First seen on ${shortSourceName(firstMention.sourceId)}${firstMention.publishedAt ? ` (${firstMention.publishedAt.slice(0, 10)})` : ''}.`, evidenceIds: [firstMention.id] })
  const srcs = [...new Set(mentions.map((m) => shortSourceName(m.sourceId)))]
  if (srcs.length) facts.push({ text: `Covered by ${srcs.length} source${srcs.length > 1 ? 's' : ''}: ${srcs.join(', ')}.`, evidenceIds: mentions.map((m) => m.id).slice(0, 8) })
  if (p.pricingSummary) {
    const pm = mentions.find((m) => m.sourceId === 'website' || m.sourceId === 'manual' || m.sourceId === 'quietmoney')
    facts.push({ text: `Pricing: ${p.pricingSummary}.`, evidenceIds: pm ? [pm.id] : [] })
  }

  const acquisition: ReportFact[] = mentions
    .filter((m) => m.excerpt && /Acquisition|Growth story/.test(m.excerpt))
    .flatMap((m) => (m.excerpt ?? '').split('\n\n').filter(Boolean).map((t) => ({ text: t, evidenceIds: [m.id] })))
  for (const m of mentions.filter((x) => ['hn_show', 'producthunt_feed', 'producthunt_api', 'reddit'].includes(x.sourceId))) {
    acquisition.push({ text: `Launch/community post on ${shortSourceName(m.sourceId)}: “${m.title ?? m.url}”.`, evidenceIds: [m.id] })
  }

  const caveats: string[] = []
  if (!revenue.length) caveats.push('No revenue figures have been collected. Revenue is unknown — not zero.')
  if (latest.some((o) => o.metric.startsWith('checkout'))) caveats.push('Checkout-page visits are modelled estimates of people reaching a checkout page; they are not purchases or revenue.')
  if (latest.some((o) => o.evidence === 'founder_reported')) caveats.push('Founder-reported figures have not been independently verified.')
  if (latest.some((o) => o.evidence === 'third_party_estimate')) caveats.push('Third-party traffic figures are estimates (e.g. Similarweb panels), not the company’s analytics.')
  const byMetric = new Map<string, MetricObservation[]>()
  for (const o of observations) byMetric.set(o.metric, [...(byMetric.get(o.metric) ?? []), o])
  for (const list of byMetric.values()) for (const c of findConflicts(list)) caveats.push(`${METRIC_META[c.metric].label}: ${explainConflict(c, (id) => shortSourceName(id))}`)

  const competitors = [...new Set(relationships.map((r) => r.relatedName))]
  const interpretation: string[] = []
  if (p.stage === 'established') interpretation.push('Evidence suggests an established business (meaningful revenue, users or checkout traffic).')
  else if (p.stage === 'early_traction') interpretation.push('Some traction evidence exists, but the scale is limited or unverified.')
  else if (p.stage === 'new_launch') interpretation.push('Recently launched; no traction evidence beyond launch-platform engagement yet.')
  const os = p.opportunityScore
  if (os) {
    interpretation.push(
      os.sufficient
        ? `Opportunity score ${os.overall}/100 (evidence coverage ${Math.round(os.coverage * 100)}%).`
        : `Insufficient evidence for a reliable opportunity score (coverage ${Math.round(os.coverage * 100)}%).`,
    )
  }

  return {
    whatItDoes: p.description ?? p.tagline,
    whoItServes: p.category ? `${p.category}${p.tags.length ? ` · ${p.tags.slice(0, 4).join(', ')}` : ''}` : null,
    howItMakesMoney: p.businessModel ?? (p.pricingSummary ? 'Paid plans observed (see pricing).' : null),
    facts,
    demandEvidence: demand.map(obsFact),
    revenueClaims: revenue.map(obsFact),
    acquisitionChannels: acquisition,
    competitors,
    interpretation,
    speculation: [],
    technicalComplexity: null,
    opportunities: [],
    caveats,
  }
}
