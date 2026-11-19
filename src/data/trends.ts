import type { Product, ProductEvent } from '@core/types.ts'

export interface CategoryTrend {
  category: string
  total: number
  last7: number
  prev7: number
  withRevenue: number
  medianGrowth: number | null
  weekly: number[] // discoveries per week, oldest → newest (8 weeks)
}

const DAY = 86400_000

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Aggregations over the product database. Simple ranked lists — no claims beyond what the data supports. */
export function computeTrends(products: Product[], events: ProductEvent[] = [], now = Date.now()) {
  const launchT = (p: Product) => new Date(p.launchDate ?? p.firstDiscoveredAt).getTime()
  const byCat = new Map<string, Product[]>()
  for (const p of products) byCat.set(p.category ?? 'Other', [...(byCat.get(p.category ?? 'Other') ?? []), p])

  const categories: CategoryTrend[] = [...byCat.entries()].map(([category, ps]) => {
    const weekly = Array.from({ length: 8 }, (_, i) => {
      const end = now - (7 - i) * 7 * DAY
      const start = end - 7 * DAY
      return ps.filter((p) => launchT(p) > start && launchT(p) <= end).length
    })
    return {
      category,
      total: ps.length,
      last7: ps.filter((p) => now - launchT(p) <= 7 * DAY).length,
      prev7: ps.filter((p) => now - launchT(p) > 7 * DAY && now - launchT(p) <= 14 * DAY).length,
      withRevenue: ps.filter((p) => p.monthlyRevenue != null).length,
      medianGrowth: median(ps.map((p) => p.growthPct).filter((g): g is number => g != null)),
      weekly,
    }
  })

  const models = new Map<string, number>()
  for (const p of products) for (const m of (p.businessModel ?? '').split(' + ').filter(Boolean)) models.set(m, (models.get(m) ?? 0) + 1)

  const tags = new Map<string, number>()
  for (const p of products) if (p.tags.includes('Consumer AI') || p.category === 'Consumer AI') tags.set(p.category ?? 'Other', (tags.get(p.category ?? 'Other') ?? 0) + 1)

  const gaining = products
    .filter((p) => (p.growthPct ?? 0) > 0)
    .sort((a, b) => (b.growthPct ?? 0) - (a.growthPct ?? 0))
    .slice(0, 10)

  const revenueLeaders = products
    .filter((p) => p.monthlyRevenue != null)
    .sort((a, b) => (b.monthlyRevenue ?? 0) - (a.monthlyRevenue ?? 0))
    .slice(0, 10)

  const recentSignificant = events.filter((e) => e.significance >= 60 && now - new Date(e.occurredAt).getTime() < 30 * DAY).length

  return {
    categories: categories.sort((a, b) => b.last7 - a.last7 || b.total - a.total),
    businessModels: [...models.entries()].sort((a, b) => b[1] - a[1]),
    consumerAiNiches: [...tags.entries()].sort((a, b) => b[1] - a[1]),
    gaining,
    revenueLeaders,
    recentSignificant,
    totalProducts: products.length,
    withRevenue: products.filter((p) => p.monthlyRevenue != null).length,
  }
}
