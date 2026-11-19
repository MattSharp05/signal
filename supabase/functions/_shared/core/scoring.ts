import { EVIDENCE_LABEL, formatMetricValue } from './metrics.ts'
import { bestMonthlyRevenue } from './summarize.ts'
import type { OpportunityScore, OpportunityScoreComponent, Product, ScoreWeights, SummaryMetrics } from './types.ts'
import { DEFAULT_WEIGHTS } from './types.ts'

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const log10 = (n: number) => Math.log10(Math.max(1, n))

/** Evidence discount: estimates and founder claims count for less than verified data. */
const TRUST: Record<string, number> = { verified: 1, platform_metric: 0.9, founder_reported: 0.75, third_party_estimate: 0.7, ai_estimate: 0.4, unknown: 0.4 }

export interface ScoreInput {
  product: Pick<Product, 'category' | 'platforms' | 'tags' | 'businessModel' | 'pricingSummary' | 'sourceIds' | 'launchDate' | 'firstDiscoveredAt'>
  summary: SummaryMetrics
  adCount?: number
  distributionNotes?: string[]
}

function growth(i: ScoreInput): OpportunityScoreComponent {
  const s = i.summary
  const reasons: string[] = []
  const parts: number[] = []
  for (const k of ['mrr_growth_pct', 'revenue_growth_pct', 'traffic_growth_pct'] as const) {
    const m = s[k]
    if (!m) continue
    // -50% → 0, 0% → 40, +50% or more → 100
    const v = clamp(40 + m.value * 1.2) * TRUST[m.evidence]
    parts.push(v)
    reasons.push(`${k.replace(/_pct$/, '').replace('_', ' ').toUpperCase()} ${formatMetricValue(k, m.value)} (${EVIDENCE_LABEL[m.evidence]}, ${m.periodLabel ?? 'period n/a'})`)
  }
  const pts = s.upvotes?.value ?? 0
  const stars = s.stars?.value ?? 0
  if (pts >= 20 || stars >= 200) {
    const v = clamp(30 + log10(Math.max(pts * 5, stars)) * 15)
    parts.push(v * 0.8)
    reasons.push(pts ? `${pts} launch upvotes/points (platform metric)` : `${stars} GitHub stars within days of creation`)
  }
  const score = parts.length ? clamp(parts.reduce((a, b) => a + b, 0) / parts.length) : null
  return { key: 'growth', label: 'Growth', score, weight: 0, reasons: reasons.length ? reasons : ['No growth evidence collected yet'] }
}

function monetization(i: ScoreInput): OpportunityScoreComponent {
  const s = i.summary
  const reasons: string[] = []
  const rev = bestMonthlyRevenue(s)
  let score: number | null = null
  if (rev && rev.value > 0) {
    // $1k/mo → 55, $10k → 75, $100k → 95
    score = clamp((log10(rev.value) * 20 - 5) * TRUST[rev.evidence])
    reasons.push(`~${formatMetricValue('mrr', rev.value)}/mo revenue (${EVIDENCE_LABEL[rev.evidence]})`)
  } else if (s.total_revenue && s.total_revenue.value > 0) {
    score = clamp((20 + log10(s.total_revenue.value) * 12) * TRUST[s.total_revenue.evidence])
    reasons.push(`${formatMetricValue('total_revenue', s.total_revenue.value)} total revenue (${EVIDENCE_LABEL[s.total_revenue.evidence]})`)
  }
  if (s.customers?.value) reasons.push(`${s.customers.value.toLocaleString('en-US')} paying customers (${EVIDENCE_LABEL[s.customers.evidence]})`)
  const checkout = s.checkout_visits_monthly
  if (checkout && checkout.value > 0) {
    const v = clamp((10 + log10(checkout.value) * 12) * TRUST[checkout.evidence])
    score = score === null ? v : Math.max(score, Math.round((score * 2 + v) / 3))
    reasons.push(`${formatMetricValue('checkout_visits_monthly', checkout.value)} checkout-page visits/mo (estimate, not purchases)`)
  }
  const hasPricing = !!(i.product.pricingSummary || /subscription|one-time|usage/i.test(i.product.businessModel ?? ''))
  if (hasPricing) {
    reasons.push(`Pricing / business model observed: ${i.product.businessModel ?? i.product.pricingSummary}`)
    if (score === null) score = 30
  }
  return { key: 'monetization', label: 'Monetization', score, weight: 0, reasons: reasons.length ? reasons : ['No monetization evidence collected yet'] }
}

function distribution(i: ScoreInput): OpportunityScoreComponent {
  const s = i.summary
  const reasons: string[] = []
  const parts: number[] = []
  const nSources = new Set(i.product.sourceIds.filter((x) => x !== 'website' && x !== 'manual')).size
  if (nSources > 0) {
    parts.push(clamp(20 + nSources * 15))
    reasons.push(`Covered by ${nSources} independent source${nSources > 1 ? 's' : ''}`)
  }
  const users = Math.max(s.users?.value ?? 0, s.accounts?.value ?? 0)
  if (users > 0) {
    const ev = (s.accounts?.value ?? 0) >= (s.users?.value ?? 0) ? s.accounts! : s.users!
    parts.push(clamp(log10(users) * 16 * TRUST[ev.evidence]))
    reasons.push(`${formatMetricValue('users', users)} users/accounts (${EVIDENCE_LABEL[ev.evidence]})`)
  }
  if (s.global_rank) {
    parts.push(clamp((100 - log10(s.global_rank.value) * 14) * TRUST[s.global_rank.evidence]))
    reasons.push(`Global traffic rank ${formatMetricValue('global_rank', s.global_rank.value)} (estimate)`)
  }
  if (i.adCount) {
    parts.push(60)
    reasons.push(`${i.adCount} ad creative(s) observed (paid acquisition in use)`)
  }
  for (const n of i.distributionNotes ?? []) reasons.push(n)
  const score = parts.length ? clamp(parts.reduce((a, b) => a + b, 0) / parts.length) : null
  return { key: 'distribution', label: 'Distribution', score, weight: 0, reasons: reasons.length ? reasons : ['No distribution evidence collected yet'] }
}

const EASY = ['Consumer AI', 'AI Utility', 'Productivity', 'Relationships & Social', 'Education', 'Health & Wellness', 'Design & Creative', 'Marketing', 'Entertainment & Games', 'Travel & Lifestyle']
const HARD = ['Hardware', 'Security & Privacy', 'Finance']

function feasibility(i: ScoreInput): OpportunityScoreComponent {
  const c = i.product.category ?? 'Other'
  let score = 55
  const reasons: string[] = []
  if (EASY.includes(c)) {
    score = 72
    reasons.push(`${c} products are typically buildable by a small team`)
  } else if (HARD.includes(c)) {
    score = 30
    reasons.push(`${c} usually implies regulatory, hardware or trust barriers`)
  } else reasons.push(`No category-specific feasibility signal for ${c}`)
  const pl = i.product.platforms
  if (pl.includes('Web') && pl.length <= 2) {
    score += 8
    reasons.push('Web-first product (no app-store dependency)')
  }
  if (pl.includes('iOS') || pl.includes('Android')) {
    score -= 6
    reasons.push('Native mobile app adds build and distribution cost')
  }
  if (/marketplace/i.test(i.product.businessModel ?? '')) {
    score -= 15
    reasons.push('Marketplace models need two-sided liquidity')
  }
  return { key: 'feasibility', label: 'Build feasibility', score: clamp(score), weight: 0, reasons: [...reasons, 'Heuristic based on category and platform — assumed, not measured'], assumed: true }
}

export function computeOpportunityScore(i: ScoreInput, weights: ScoreWeights = DEFAULT_WEIGHTS, now = new Date()): OpportunityScore {
  const comps = [growth(i), monetization(i), distribution(i), feasibility(i)].map((c) => ({ ...c, weight: weights[c.key] }))
  const total = comps.reduce((a, c) => a + c.weight, 0) || 1
  // Feasibility is assumed, so it does not count toward evidence coverage.
  const covered = comps.filter((c) => c.score !== null && !c.assumed).reduce((a, c) => a + c.weight, 0)
  const scored = comps.filter((c) => c.score !== null)
  const wsum = scored.reduce((a, c) => a + c.weight, 0)
  const overall = wsum ? Math.round(scored.reduce((a, c) => a + (c.score as number) * c.weight, 0) / wsum) : null
  const coverage = Math.round((covered / total) * 100) / 100
  return { overall, coverage, sufficient: coverage >= 0.55, components: comps, computedAt: now.toISOString() }
}

/** Relevance drives tiering (deep AI research) and the "Trending" sort. 0–100. */
export function computeRelevance(i: ScoreInput, now = new Date()): number {
  const s = i.summary
  let r = 0
  const rev = bestMonthlyRevenue(s)
  if (rev && rev.value > 0) r += Math.min(40, 10 + log10(rev.value) * 7)
  if (s.checkout_visits_monthly) r += Math.min(20, log10(s.checkout_visits_monthly.value) * 4)
  if (s.accounts || s.users) r += 8
  const growthVals = [s.mrr_growth_pct?.value, s.traffic_growth_pct?.value, s.revenue_growth_pct?.value].filter((v): v is number => v != null)
  if (growthVals.length) r += Math.max(-10, Math.min(15, Math.max(...growthVals) / 4))
  r += Math.min(15, log10((s.upvotes?.value ?? 0) * 3 + (s.stars?.value ?? 0)) * 5)
  r += Math.min(15, (new Set(i.product.sourceIds).size - 1) * 6)
  const ageDays = (now.getTime() - new Date(i.product.firstDiscoveredAt).getTime()) / 86400_000
  if (ageDays < 3) r += 5
  return clamp(r)
}

/** Re-apply user weights to stored component scores (weights are per-user; components are shared). */
export function reweight(score: OpportunityScore, weights: ScoreWeights): OpportunityScore {
  const comps = score.components.map((c) => ({ ...c, weight: weights[c.key] }))
  const total = comps.reduce((a, c) => a + c.weight, 0) || 1
  const covered = comps.filter((c) => c.score !== null && !c.assumed).reduce((a, c) => a + c.weight, 0)
  const scored = comps.filter((c) => c.score !== null)
  const wsum = scored.reduce((a, c) => a + c.weight, 0)
  const overall = wsum ? Math.round(scored.reduce((a, c) => a + (c.score as number) * c.weight, 0) / wsum) : null
  const coverage = Math.round((covered / total) * 100) / 100
  return { ...score, overall, coverage, sufficient: coverage >= 0.55, components: comps }
}
