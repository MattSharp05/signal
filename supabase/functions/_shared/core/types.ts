// Runtime-agnostic domain types shared by Edge Functions, the Node CLI, the browser and tests.

export type EvidenceClass =
  | 'verified'
  | 'platform_metric'
  | 'founder_reported'
  | 'third_party_estimate'
  | 'ai_estimate'
  | 'unknown'

export type Confidence = 'high' | 'medium' | 'low'

export type MetricType =
  | 'mrr'
  | 'arr'
  | 'revenue_run_rate'
  | 'revenue_30d'
  | 'total_revenue'
  | 'one_time_sales'
  | 'customers'
  | 'users'
  | 'accounts'
  | 'downloads'
  | 'monthly_visits'
  | 'checkout_visits_monthly'
  | 'checkout_visits_total'
  | 'traffic_growth_pct'
  | 'revenue_growth_pct'
  | 'mrr_growth_pct'
  | 'global_rank'
  | 'upvotes'
  | 'comments'
  | 'stars'

export type MetricUnit = 'USD' | 'count' | 'visits' | 'percent' | 'rank'

export type ProductStage = 'new_launch' | 'early_traction' | 'established' | 'unknown'

export type AliasKind =
  | 'domain'
  | 'host_path'
  | 'name'
  | 'ph_slug'
  | 'github_repo'
  | 'trustmrr_slug'
  | 'hn_item'
  | 'social'

export interface Alias {
  kind: AliasKind
  value: string
}

export type SourceKind = 'api' | 'rss' | 'sitemap' | 'public_page' | 'licensed' | 'manual'
export type SourceRole = 'discovery' | 'enrichment' | 'both'
export type SourceStatus =
  | 'operational'
  | 'requires_credentials'
  | 'manual'
  | 'unsupported'
  | 'licensed'
  | 'error'

export type EventType =
  | 'discovered'
  | 'new_source'
  | 'metric_change'
  | 'revenue_milestone'
  | 'traffic_change'
  | 'pricing_change'
  | 'launch'
  | 'new_ad'
  | 'announcement'
  | 'merged'

// ---------- Raw (connector output) ----------

export interface RawMetric {
  metric: MetricType
  value: number
  unit: MetricUnit
  currency?: string
  periodStart?: string // ISO date
  periodEnd?: string
  periodLabel?: string // human label e.g. "Sep 2026", "last 30 days", "Apr–Sep 2026"
  asOf?: string // ISO date the figure refers to
  evidence: EvidenceClass
  confidence: Confidence
  quote?: string
  note?: string
  /** attribution when a source relays another provider's estimate, e.g. "Similarweb via QuietMoney" */
  attribution?: string
}

export interface RawRelationship {
  name: string
  domain?: string
  kind: 'competitor' | 'similar' | 'same_company'
  reason?: string
}

export interface RawAd {
  externalId: string
  platform: 'meta' | 'tiktok' | 'google' | 'other'
  advertiser?: string
  headline?: string
  body?: string
  mediaType?: 'image' | 'video' | 'carousel' | 'text' | 'unknown'
  mediaUrl?: string
  landingUrl?: string
  firstObserved?: string
  lastObserved?: string
  isActive?: boolean
  originalUrl?: string
}

export interface RawMention {
  sourceId: string
  externalId: string
  url: string
  title?: string
  excerpt?: string
  author?: string
  publishedAt?: string
  identity: {
    name?: string
    websiteUrl?: string
    aliases: Alias[]
    company?: string
    logoUrl?: string
    category?: string
    tags?: string[]
    platforms?: string[]
    description?: string
    tagline?: string
    launchDate?: string
    businessModel?: string
    pricingSummary?: string
  }
  metrics: RawMetric[]
  relationships?: RawRelationship[]
  ads?: RawAd[]
  /** plain text body for optional AI extraction */
  text?: string
  raw?: unknown
}

// ---------- Stored entities ----------

export interface Product {
  id: string
  slug: string
  name: string
  domain: string | null
  websiteUrl: string | null
  companyId: string | null
  companyName: string | null
  tagline: string | null
  description: string | null
  category: string | null
  tags: string[]
  platforms: string[]
  businessModel: string | null
  pricingSummary: string | null
  launchDate: string | null
  logoUrl: string | null
  stage: ProductStage
  status: 'active' | 'merged'
  mergedInto: string | null
  relevanceScore: number
  /** derived for filtering/sorting only: best monthly-equivalent revenue (USD) and its evidence */
  monthlyRevenue: number | null
  revenueEvidence: EvidenceClass | null
  /** derived: strongest growth % observed (MRR > revenue > traffic) */
  growthPct: number | null
  /** derived: most trusted evidence class among this product's observations */
  evidenceLevel: EvidenceClass | null
  opportunityScore: OpportunityScore | null
  summaryMetrics: SummaryMetrics
  sourceIds: string[]
  sourceCount: number
  firstDiscoveredAt: string
  lastUpdatedAt: string
  lastSignificantAt: string | null
  /** origin label for development data; null for pipeline data */
  dataOrigin: 'pipeline' | 'snapshot' | 'fixture'
}

export interface SummaryMetric {
  metric: MetricType
  value: number
  unit: MetricUnit
  evidence: EvidenceClass
  confidence: Confidence
  observationId: string
  sourceId: string
  sourceUrl: string
  periodLabel: string | null
  asOf: string | null
  conflict: boolean
  observationCount: number
}

export type SummaryMetrics = Partial<Record<MetricType, SummaryMetric>>

export interface SourceMention {
  id: string
  sourceId: string
  productId: string
  externalId: string
  url: string
  title: string | null
  excerpt: string | null
  author: string | null
  publishedAt: string | null
  discoveredAt: string
  collectedAt: string
  contentHash: string
}

export interface MetricObservation {
  id: string
  productId: string
  mentionId: string | null
  sourceId: string
  metric: MetricType
  value: number
  unit: MetricUnit
  currency: string | null
  periodStart: string | null
  periodEnd: string | null
  periodLabel: string | null
  asOf: string | null
  evidence: EvidenceClass
  confidence: Confidence
  sourceUrl: string
  quote: string | null
  note: string | null
  attribution: string | null
  publishedAt: string | null
  collectedAt: string
  dedupeKey: string
}

export interface ProductEvent {
  id: string
  productId: string
  type: EventType
  title: string
  detail: string | null
  significance: number
  occurredAt: string
  sourceId: string | null
  mentionId: string | null
  observationId: string | null
  dedupeKey: string
}

export interface ProductRelationship {
  id: string
  productId: string
  relatedProductId: string | null
  relatedName: string
  relatedDomain: string | null
  kind: 'competitor' | 'similar' | 'same_company'
  reason: string | null
  sourceId: string | null
}

export interface MergeCandidate {
  id: string
  productA: string
  productB: string
  reason: string
  score: number
  status: 'open' | 'merged' | 'dismissed'
  createdAt: string
}

export interface Advertisement {
  id: string
  productId: string
  sourceId: string
  externalId: string
  platform: RawAd['platform']
  advertiser: string | null
  headline: string | null
  body: string | null
  mediaType: RawAd['mediaType'] | null
  mediaUrl: string | null
  landingUrl: string | null
  firstObserved: string | null
  lastObserved: string | null
  isActive: boolean | null
  originalUrl: string | null
  analysis: AdAnalysis | null
  manual: boolean
}

export interface AdAnalysis {
  hook: string
  audience: string
  emotionalAppeal: string
  valueProposition: string
  callToAction: string
  format: string
  angle: string
  generator: 'ai'
  model: string
}

export interface SourceRecord {
  id: string
  name: string
  kind: SourceKind
  role: SourceRole
  status: SourceStatus
  enabled: boolean
  refreshMinutes: number
  homepage: string
  docsUrl: string | null
  notes: string | null
  credentialEnv: string[]
  credentialsPresent: boolean | null
  runsIn: ('server' | 'browser')[]
  config: Record<string, unknown>
  cursor: Record<string, unknown>
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  productsDiscovered: number
  mentionsCollected: number
  custom: boolean
}

export interface IngestionJob {
  id: string
  sourceId: string
  status: 'running' | 'success' | 'partial' | 'error'
  trigger: 'schedule' | 'manual' | 'submission'
  startedAt: string
  finishedAt: string | null
  itemsFetched: number
  mentionsNew: number
  productsCreated: number
  productsUpdated: number
  observationsNew: number
  eventsNew: number
  error: string | null
  log: string[]
}

export interface OpportunityScoreComponent {
  key: 'growth' | 'monetization' | 'distribution' | 'feasibility'
  label: string
  score: number | null
  weight: number
  reasons: string[]
  assumed?: boolean
}

export interface OpportunityScore {
  overall: number | null
  coverage: number
  sufficient: boolean
  components: OpportunityScoreComponent[]
  computedAt: string
}

export interface ScoreWeights {
  growth: number
  monetization: number
  distribution: number
  feasibility: number
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  growth: 30,
  monetization: 30,
  distribution: 25,
  feasibility: 15,
}

export interface ReportFact {
  text: string
  evidenceIds: string[]
}

export interface ResearchReport {
  id: string
  productId: string
  tier: 'lite' | 'deep'
  generator: 'rules' | 'ai'
  model: string | null
  createdAt: string
  content: {
    whatItDoes: string | null
    whoItServes: string | null
    howItMakesMoney: string | null
    facts: ReportFact[]
    demandEvidence: ReportFact[]
    revenueClaims: ReportFact[]
    acquisitionChannels: ReportFact[]
    competitors: string[]
    interpretation: string[]
    speculation: string[]
    technicalComplexity: string | null
    opportunities: string[]
    caveats: string[]
  }
  costTokens: number | null
}
