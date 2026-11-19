import { categorize } from '../categorize.ts'
import { extractJsonLd, ldOfType, toIsoDate } from '../html.ts'
import { aliasesForUrl, normalizeUrl, slugify } from '../normalize.ts'
import type { MetricType, MetricUnit, RawMention, RawMetric } from '../types.ts'
import { pickChangedEntries } from './sitemap-crawl.ts'
import type { ConnectorDefinition } from './types.ts'

const PROPERTY_MAP: Record<string, { metric: MetricType; unit: MetricUnit; period: string }> = {
  'verified revenue, all time': { metric: 'total_revenue', unit: 'USD', period: 'All time' },
  'verified revenue, last 30 days': { metric: 'revenue_30d', unit: 'USD', period: 'Last 30 days' },
  'current mrr': { metric: 'mrr', unit: 'USD', period: 'Current' },
  'current customers/subscriptions': { metric: 'customers', unit: 'count', period: 'Current' },
  'revenue growth, last 30 days': { metric: 'revenue_growth_pct', unit: 'percent', period: 'Last 30 days' },
  'mrr growth, last 30 days': { metric: 'mrr_growth_pct', unit: 'percent', period: 'Last 30 days' },
}

export function trustMrrSlug(url: string): string | null {
  return url.match(/trustmrr\.com\/startup\/([a-z0-9-]+)/i)?.[1]?.toLowerCase() ?? null
}

/** Parse a TrustMRR startup page (schema.org JSON-LD). Returns null if the page has no organization block. */
export function parseTrustMrrPage(html: string, pageUrl: string): RawMention | null {
  const blocks = extractJsonLd(html)
  const org = ldOfType(blocks, 'Organization')
  const page = ldOfType(blocks, 'WebPage')
  if (!org) return null
  const slug = trustMrrSlug(pageUrl) ?? String(org.identifier ?? '')
  const name = String(org.name ?? slug)
  const website = typeof org.url === 'string' ? org.url : undefined
  const asOf = toIsoDate(String(page?.dateModified ?? '')) ?? undefined
  const metrics: RawMetric[] = []
  const props = Array.isArray(org.additionalProperty) ? (org.additionalProperty as Record<string, unknown>[]) : []
  let paymentProvider: string | null = null
  for (const p of props) {
    const key = String(p.name ?? '').toLowerCase()
    if (key === 'payment provider') paymentProvider = String(p.value)
    const map = PROPERTY_MAP[key]
    const v = typeof p.value === 'number' ? p.value : Number(p.value)
    if (!map || !Number.isFinite(v)) continue
    // TrustMRR reports zero/blank when no active revenue; keep zeros for revenue (a real verified fact) but skip growth on zero bases
    metrics.push({
      metric: map.metric,
      value: Math.round(v * 100) / 100,
      unit: map.unit,
      currency: map.unit === 'USD' ? 'USD' : undefined,
      periodLabel: map.period,
      asOf,
      evidence: 'verified',
      confidence: 'high',
      quote: `${p.name}: ${p.value}${p.unitText ? ` ${p.unitText}` : ''}`,
      attribution: paymentProvider ? `Verified by TrustMRR via ${paymentProvider}` : 'Verified by TrustMRR via payment provider',
    })
  }
  for (const m of metrics) if (paymentProvider) m.attribution = `Verified by TrustMRR via ${paymentProvider}`
  const keywords = Array.isArray(org.keywords) ? (org.keywords as string[]) : []
  const description = typeof org.description === 'string' ? org.description : undefined
  const cat = categorize(`${name} ${description ?? ''} ${keywords.join(' ')}`)
  const audience = keywords.find((k) => /^b2[bc]$/i.test(k))
  return {
    sourceId: 'trustmrr',
    externalId: slug,
    url: `https://trustmrr.com/startup/${slug}`,
    title: String(page?.name ?? `${name} verified startup revenue`),
    excerpt: description,
    publishedAt: toIsoDate(String(page?.datePublished ?? '')),
    identity: {
      name,
      websiteUrl: website,
      description,
      tagline: description,
      aliases: [{ kind: 'trustmrr_slug', value: slug }, ...aliasesForUrl(website)],
      logoUrl: typeof org.logo === 'string' ? org.logo : undefined,
      category: cat.category,
      tags: [...new Set([...cat.tags, ...(audience ? [audience.toUpperCase()] : []), ...(paymentProvider ? [paymentProvider] : [])])],
      launchDate: toIsoDate(String(org.foundingDate ?? '')),
    },
    metrics,
    text: description,
  }
}

export const trustMrr: ConnectorDefinition = {
  id: 'trustmrr',
  name: 'TrustMRR',
  shortName: 'TrustMRR',
  kind: 'sitemap',
  role: 'both',
  homepage: 'https://trustmrr.com/',
  docsUrl: 'https://trustmrr.com/startup-sitemap.xml',
  notes:
    'Startups connect their payment provider (e.g. Stripe) and TrustMRR publishes verified revenue. Signal reads the public startup sitemap and schema.org data on each public page (robots.txt allows all). Highest-trust revenue source.',
  defaultStatus: 'operational',
  runsIn: ['server'],
  defaultRefreshMinutes: 360,
  defaultEnabled: true,
  defaultConfig: { pagesPerRun: 30 },
  async discover(ctx) {
    const budget = Math.min(ctx.budget, Number(ctx.config.pagesPerRun ?? 30))
    const entries = await pickChangedEntries(
      ctx,
      'https://trustmrr.com/startup-sitemap.xml',
      (e) => /\/startup\/[a-z0-9-]+$/i.test(e.loc),
      (e) => trustMrrSlug(e.loc) ?? e.loc,
      budget,
    )
    const mentions: RawMention[] = []
    for (const e of entries) {
      try {
        const html = await ctx.http.text(e.loc)
        const m = parseTrustMrrPage(html, e.loc)
        if (m) mentions.push(m)
      } catch (err) {
        ctx.log(`trustmrr ${e.loc}: ${(err as Error).message}`)
      }
    }
    return { mentions, cursor: { lastRunAt: ctx.now.toISOString() }, fetched: entries.length }
  },
  async enrich(ctx, target) {
    if (!target.domain) return []
    // TrustMRR slugs are name-based; only accept a page whose organization URL matches the product's domain.
    const candidates = [...new Set([slugify(target.name), slugify(target.domain.split('.')[0])])]
    for (const slug of candidates) {
      try {
        const res = await ctx.http.request(`https://trustmrr.com/startup/${slug}`)
        if (!res.ok) continue
        const m = parseTrustMrrPage(await res.text(), `https://trustmrr.com/startup/${slug}`)
        if (m && normalizeUrl(m.identity.websiteUrl)?.domain === target.domain) return [m]
      } catch (err) {
        ctx.log(`trustmrr enrich ${slug}: ${(err as Error).message}`)
      }
    }
    return []
  },
}
