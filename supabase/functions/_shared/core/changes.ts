import { EVIDENCE_LABEL, METRIC_META, REVENUE_METRICS, TRAFFIC_METRICS, formatMetricValue } from './metrics.ts'
import type { MetricObservation, ProductEvent } from './types.ts'

const MRR_MILESTONES = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 1_000_000]

type NewEvent = Omit<ProductEvent, 'id'>

function obsTime(o: MetricObservation): number {
  return new Date(o.asOf ?? o.periodEnd ?? o.collectedAt).getTime()
}

/**
 * Compare newly inserted observations with prior observations of the same metric/source/evidence.
 * Only meaningful changes produce events; platform metrics (points/stars) never notify.
 */
export function detectMetricChanges(prior: MetricObservation[], inserted: MetricObservation[], sourceName: (id: string) => string): NewEvent[] {
  const events: NewEvent[] = []
  for (const o of inserted) {
    const meta = METRIC_META[o.metric]
    if (meta.group === 'platform' || meta.unit === 'percent' || meta.unit === 'rank') continue
    const prev = prior
      .filter((p) => p.metric === o.metric && p.sourceId === o.sourceId && p.evidence === o.evidence && obsTime(p) < obsTime(o))
      .sort((a, b) => obsTime(b) - obsTime(a))[0]
    const src = sourceName(o.sourceId)
    const ev = EVIDENCE_LABEL[o.evidence].toLowerCase()

    if (o.metric === 'mrr' && prev) {
      const crossed = MRR_MILESTONES.filter((m) => prev.value < m && o.value >= m).pop()
      if (crossed) {
        events.push({
          productId: o.productId, type: 'revenue_milestone', title: `MRR crossed ${formatMetricValue('mrr', crossed)} (${ev})`,
          detail: `${formatMetricValue('mrr', prev.value)} → ${formatMetricValue('mrr', o.value)} per ${src}.`, significance: o.evidence === 'verified' ? 90 : 75,
          occurredAt: o.asOf ?? o.collectedAt, sourceId: o.sourceId, mentionId: o.mentionId, observationId: o.id,
          dedupeKey: `milestone:${o.productId}:${o.sourceId}:${crossed}`,
        })
        continue
      }
    }
    if (!prev || prev.value === 0) continue
    const delta = (o.value - prev.value) / prev.value
    const isRevenue = REVENUE_METRICS.includes(o.metric)
    const isTraffic = TRAFFIC_METRICS.includes(o.metric)
    const threshold = isRevenue ? 0.2 : isTraffic ? 0.25 : 0.3
    if (Math.abs(delta) < threshold) continue
    const pct = Math.round(delta * 100)
    const base = isRevenue ? 60 : isTraffic ? 50 : 45
    const significance = Math.min(isRevenue ? 90 : 75, base + Math.round(Math.min(1, Math.abs(delta)) * 25))
    events.push({
      productId: o.productId,
      type: isTraffic ? 'traffic_change' : 'metric_change',
      title: `${meta.short} ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% (${ev})`,
      detail: `${formatMetricValue(o.metric, prev.value)} (${prev.periodLabel ?? 'earlier'}) → ${formatMetricValue(o.metric, o.value)} (${o.periodLabel ?? 'latest'}) per ${src}.`,
      significance,
      occurredAt: o.asOf ?? o.collectedAt,
      sourceId: o.sourceId,
      mentionId: o.mentionId,
      observationId: o.id,
      dedupeKey: `change:${o.productId}:${o.metric}:${o.sourceId}:${o.periodLabel ?? ''}:${o.value}`,
    })
  }
  return events
}
