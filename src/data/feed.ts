import { EVIDENCE_RANK } from '@core/metrics.ts'
import type { Product } from '@core/types.ts'
import type { FeedFilters, UserState } from './repository'

const DAY = 86400_000

export function launchTime(p: Product): number {
  return new Date(p.launchDate ?? p.firstDiscoveredAt).getTime()
}

/** In-memory feed query used by Local mode (Supabase mode translates the same filters to SQL). */
export function filterProducts(products: Product[], f: FeedFilters, user: UserState, now = Date.now()): Product[] {
  const q = f.q?.trim().toLowerCase()
  const saved = new Set(user.saved.map((s) => s.productId))
  const tracked = new Set(user.tracked.map((s) => s.productId))
  let out = products.filter((p) => p.status === 'active')
  if (q) {
    out = out.filter((p) =>
      [p.name, p.domain, p.companyName, p.category, p.tagline, p.description, p.businessModel, ...p.tags]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(q)),
    )
  }
  if (f.category) out = out.filter((p) => p.category === f.category)
  if (f.platform) out = out.filter((p) => p.platforms.includes(f.platform!))
  if (f.stage) out = out.filter((p) => p.stage === f.stage)
  if (f.quick === 'new') out = out.filter((p) => p.stage === 'new_launch' || now - launchTime(p) < 14 * DAY)
  if (f.quick === 'trending') out = out.filter((p) => p.relevanceScore >= 35)
  if (f.quick === 'revenue' || f.hasRevenue) out = out.filter((p) => p.monthlyRevenue != null || p.summaryMetrics.total_revenue)
  if (f.revenueMin != null) out = out.filter((p) => (p.monthlyRevenue ?? -1) >= f.revenueMin!)
  if (f.revenueMax != null) out = out.filter((p) => p.monthlyRevenue != null && p.monthlyRevenue <= f.revenueMax!)
  if (f.growthMin != null) out = out.filter((p) => (p.growthPct ?? -Infinity) >= f.growthMin!)
  if (f.businessModel) out = out.filter((p) => (p.businessModel ?? '').toLowerCase().includes(f.businessModel!.toLowerCase()))
  if (f.source) out = out.filter((p) => p.sourceIds.includes(f.source!))
  if (f.savedOnly) out = out.filter((p) => saved.has(p.id))
  if (f.trackedOnly) out = out.filter((p) => tracked.has(p.id))
  if (f.maxAgeDays) out = out.filter((p) => now - launchTime(p) <= f.maxAgeDays! * DAY)
  if (f.evidence === 'verified') out = out.filter((p) => p.evidenceLevel === 'verified')
  if (f.evidence === 'founder_or_better') out = out.filter((p) => p.evidenceLevel && EVIDENCE_RANK[p.evidenceLevel] >= EVIDENCE_RANK.founder_reported && p.evidenceLevel !== 'platform_metric')
  if (f.evidence === 'any_metric') out = out.filter((p) => p.evidenceLevel && p.evidenceLevel !== 'platform_metric')

  const by = (fn: (p: Product) => number) => (a: Product, b: Product) => fn(b) - fn(a)
  const t = (s: string | null) => (s ? new Date(s).getTime() : 0)
  const sorters: Record<FeedFilters['sort'], (a: Product, b: Product) => number> = {
    discovered: by((p) => t(p.firstDiscoveredAt)),
    updated: by((p) => t(p.lastUpdatedAt)),
    trending: by((p) => p.relevanceScore * 1e13 + t(p.lastUpdatedAt) / 1e3),
    revenue: by((p) => p.monthlyRevenue ?? -1),
    growth: by((p) => p.growthPct ?? -Infinity),
    sources: by((p) => p.sourceCount * 1e13 + t(p.lastUpdatedAt) / 1e3),
    launched: by((p) => (p.launchDate ? t(p.launchDate) : 0)),
  }
  return out.sort(sorters[f.sort])
}
