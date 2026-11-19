import type { Confidence, EvidenceClass, MetricType, MetricUnit, RawMetric } from './types.ts'

export interface MetricMeta {
  label: string
  short: string
  unit: MetricUnit
  group: 'revenue' | 'users' | 'traffic' | 'growth' | 'platform' | 'rank'
  /** lower is better (ranks) */
  inverse?: boolean
}

export const METRIC_META: Record<MetricType, MetricMeta> = {
  mrr: { label: 'Monthly recurring revenue', short: 'MRR', unit: 'USD', group: 'revenue' },
  arr: { label: 'Annual recurring revenue', short: 'ARR', unit: 'USD', group: 'revenue' },
  revenue_run_rate: { label: 'Annualized revenue run rate', short: 'Run rate', unit: 'USD', group: 'revenue' },
  revenue_30d: { label: 'Revenue, last 30 days', short: 'Rev 30d', unit: 'USD', group: 'revenue' },
  total_revenue: { label: 'Total historical revenue', short: 'Total rev', unit: 'USD', group: 'revenue' },
  one_time_sales: { label: 'One-time sales', short: 'Sales', unit: 'USD', group: 'revenue' },
  customers: { label: 'Paying customers / subscriptions', short: 'Customers', unit: 'count', group: 'users' },
  users: { label: 'Users', short: 'Users', unit: 'count', group: 'users' },
  accounts: { label: 'Accounts', short: 'Accounts', unit: 'count', group: 'users' },
  downloads: { label: 'Downloads', short: 'Downloads', unit: 'count', group: 'users' },
  monthly_visits: { label: 'Monthly website visits', short: 'Visits/mo', unit: 'visits', group: 'traffic' },
  checkout_visits_monthly: { label: 'Checkout-page visits per month', short: 'Checkout/mo', unit: 'visits', group: 'traffic' },
  checkout_visits_total: { label: 'Checkout-page visits (period total)', short: 'Checkout', unit: 'visits', group: 'traffic' },
  traffic_growth_pct: { label: 'Traffic growth', short: 'Traffic Δ', unit: 'percent', group: 'growth' },
  revenue_growth_pct: { label: 'Revenue growth', short: 'Rev Δ', unit: 'percent', group: 'growth' },
  mrr_growth_pct: { label: 'MRR growth', short: 'MRR Δ', unit: 'percent', group: 'growth' },
  global_rank: { label: 'Global traffic rank', short: 'Rank', unit: 'rank', group: 'rank', inverse: true },
  upvotes: { label: 'Upvotes / points', short: 'Points', unit: 'count', group: 'platform' },
  comments: { label: 'Comments', short: 'Comments', unit: 'count', group: 'platform' },
  stars: { label: 'GitHub stars', short: 'Stars', unit: 'count', group: 'platform' },
}

/** Card metric priority — most decision-relevant first. */
export const CARD_PRIORITY: MetricType[] = [
  'mrr',
  'revenue_30d',
  'arr',
  'revenue_run_rate',
  'total_revenue',
  'one_time_sales',
  'customers',
  'accounts',
  'users',
  'checkout_visits_monthly',
  'monthly_visits',
  'downloads',
  'mrr_growth_pct',
  'traffic_growth_pct',
  'revenue_growth_pct',
  'upvotes',
  'stars',
  'global_rank',
  'comments',
]

export const REVENUE_METRICS: MetricType[] = ['mrr', 'arr', 'revenue_run_rate', 'revenue_30d', 'total_revenue', 'one_time_sales']
export const TRAFFIC_METRICS: MetricType[] = ['monthly_visits', 'checkout_visits_monthly', 'checkout_visits_total']

export const EVIDENCE_RANK: Record<EvidenceClass, number> = {
  verified: 6,
  platform_metric: 5,
  founder_reported: 4,
  third_party_estimate: 3,
  ai_estimate: 2,
  unknown: 1,
}

export const EVIDENCE_LABEL: Record<EvidenceClass, string> = {
  verified: 'Verified',
  platform_metric: 'Platform metric',
  founder_reported: 'Founder-reported',
  third_party_estimate: 'Third-party estimate',
  ai_estimate: 'AI estimate',
  unknown: 'Unknown',
}

export const EVIDENCE_DESCRIPTION: Record<EvidenceClass, string> = {
  verified: 'Independently verified, e.g. read from the payment provider (Stripe) by the source.',
  platform_metric: 'A count reported by the platform itself (upvotes, stars). Not a business metric.',
  founder_reported: 'Stated by the founder or company. Not independently verified.',
  third_party_estimate: 'Modelled estimate from a third party (e.g. Similarweb). Not actual analytics or revenue.',
  ai_estimate: 'Derived by AI from other evidence. Treat as speculative.',
  unknown: 'Provenance could not be determined.',
}

/** Parse "60K", "1.5M", "$3.4k", "710,000+", "122K", "-16.06%", "2.3B" → number. */
export function parseCompactNumber(input: string): number | null {
  const s = input.replace(/[\s,$€£+]/g, '').replace(/%$/, '')
  const m = s.match(/^(-?\d+(?:\.\d+)?)([kKmMbB])?$/)
  if (!m) return null
  const n = parseFloat(m[1])
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1
  const v = n * mult
  return Number.isFinite(v) ? v : null
}

const NUM = String.raw`\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kKmMbB](?![a-z]))?\+?`

interface TextRule {
  metric: MetricType
  unit: MetricUnit
  /** regex with number in group 1 and multiplier in group 2 */
  re: RegExp
  requiresDollar?: boolean
}

// Conservative patterns: only explicit, labeled figures. Anything ambiguous is left to (grounded) AI extraction.
const TEXT_RULES: TextRule[] = [
  { metric: 'mrr', unit: 'USD', re: new RegExp(String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kKmM])?\+?\s*(?:in\s+)?(?:MRR|monthly recurring revenue)\b`, 'i'), requiresDollar: true },
  { metric: 'arr', unit: 'USD', re: new RegExp(String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kKmMbB])?\+?\s*(?:in\s+)?(?:ARR|annual recurring revenue)\b`, 'i'), requiresDollar: true },
  { metric: 'mrr', unit: 'USD', re: new RegExp(String.raw`\b(?:MRR|monthly recurring revenue)(?:\s+(?:of|is|at|reached|hit))?\s*:?\s*\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kKmM])?`, 'i'), requiresDollar: true },
  { metric: 'arr', unit: 'USD', re: new RegExp(String.raw`\b(?:ARR)(?:\s+(?:of|is|at|reached|hit))?\s*:?\s*\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kKmMbB])?`, 'i'), requiresDollar: true },
  { metric: 'revenue_run_rate', unit: 'USD', re: new RegExp(String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kKmMbB])?\+?\s*(?:annual(?:ized)? run[- ]rate|run[- ]rate)`, 'i'), requiresDollar: true },
  { metric: 'revenue_30d', unit: 'USD', re: new RegExp(String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kKmM])?\+?\s*(?:in\s+)?(?:revenue\s+)?(?:a|per|\/)\s?month\b`, 'i'), requiresDollar: true },
  { metric: 'total_revenue', unit: 'USD', re: new RegExp(String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kKmMbB])?\+?\s*(?:in\s+)?(?:total|lifetime|all[- ]time)\s+(?:revenue|sales)`, 'i'), requiresDollar: true },
  { metric: 'users', unit: 'count', re: new RegExp(String.raw`${NUM}\s+(?:active\s+|monthly\s+|happy\s+|registered\s+)?users\b`, 'i') },
  { metric: 'customers', unit: 'count', re: new RegExp(String.raw`${NUM}\s+(?:paying\s+)?(?:customers|subscribers)\b`, 'i') },
  { metric: 'accounts', unit: 'count', re: new RegExp(String.raw`(?:people with an account|accounts? created|sign[- ]?ups)\s*:?\s*${NUM}`, 'i') },
  { metric: 'accounts', unit: 'count', re: new RegExp(String.raw`${NUM}\s+(?:accounts|sign[- ]?ups)\b`, 'i') },
  { metric: 'downloads', unit: 'count', re: new RegExp(String.raw`${NUM}\s+downloads\b`, 'i') },
]

/**
 * Rule-based metric extraction from free text. Returns figures with a verbatim quote window.
 * The caller decides the evidence class (founder site → founder_reported, etc.).
 */
export function extractMetricsFromText(
  text: string,
  evidence: EvidenceClass,
  confidence: Confidence = 'low',
): RawMetric[] {
  const out: RawMetric[] = []
  const seen = new Set<string>()
  for (const rule of TEXT_RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const base = parseCompactNumber(`${m[1]}${m[2] ?? ''}`)
      if (base === null || base <= 0) continue
      // ignore tiny "users" counts and years like "2026 users"
      if (rule.unit === 'count' && (base < 10 || (base >= 1900 && base <= 2100 && !m[1].includes(',')))) continue
      const key = `${rule.metric}:${base}`
      if (seen.has(key)) continue
      seen.add(key)
      const start = Math.max(0, m.index - 60)
      const end = Math.min(text.length, m.index + m[0].length + 60)
      out.push({
        metric: rule.metric,
        value: base,
        unit: rule.unit,
        currency: rule.unit === 'USD' ? 'USD' : undefined,
        evidence,
        confidence,
        quote: text.slice(start, end).trim(),
      })
    }
  }
  return out
}

export function formatMetricValue(metric: MetricType, value: number): string {
  const unit = METRIC_META[metric]?.unit ?? 'count'
  if (unit === 'percent') return `${value > 0 ? '+' : ''}${value.toFixed(Math.abs(value) < 10 ? 1 : 0)}%`
  if (unit === 'rank') return `#${Math.round(value).toLocaleString('en-US')}`
  const compact = compactNumber(value)
  return unit === 'USD' ? `$${compact}` : compact
}

export function compactNumber(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${trim(v / 1e9)}B`
  if (a >= 1e6) return `${trim(v / 1e6)}M`
  if (a >= 1e4) return `${trim(v / 1e3, 0)}K`
  if (a >= 1e3) return `${trim(v / 1e3)}K`
  return `${Math.round(v)}`
}

function trim(n: number, digits = 1): string {
  return n.toFixed(digits).replace(/\.0+$/, '')
}

/** Normalize a recurring/one-off revenue figure into an approximate monthly USD value for ranking only (never displayed as a fact). */
export function monthlyRevenueEquivalent(metric: MetricType, value: number): number | null {
  switch (metric) {
    case 'mrr':
    case 'revenue_30d':
      return value
    case 'arr':
    case 'revenue_run_rate':
      return value / 12
    default:
      return null
  }
}
