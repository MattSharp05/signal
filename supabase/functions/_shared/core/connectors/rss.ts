import { categorize, detectPlatforms } from '../categorize.ts'
import { htmlToText, parseFeed, toIsoDate } from '../html.ts'
import { extractMetricsFromText } from '../metrics.ts'
import { aliasesForUrl, isAggregatorHost, safeUrl } from '../normalize.ts'
import type { RawMention } from '../types.ts'
import type { ConnectorContext, DiscoveryBatch } from './types.ts'

/**
 * Generic RSS/Atom connector for user-added feeds (custom sources).
 * An item becomes a product mention only when it links to a non-aggregator website.
 * Claims in item text are founder_reported (if `config.evidence` = founder) or unknown, low confidence.
 */
export async function discoverRss(ctx: ConnectorContext, sourceId: string): Promise<DiscoveryBatch> {
  const feedUrl = String(ctx.config.url ?? '')
  if (!safeUrl(feedUrl)) throw new Error('Custom RSS source has no valid feed URL')
  const xml = await ctx.http.text(feedUrl)
  const items = parseFeed(xml).slice(0, Math.max(10, ctx.budget * 2))
  const evidence = ctx.config.evidence === 'founder_reported' ? 'founder_reported' : 'unknown'
  const mentions: RawMention[] = []
  for (const it of items) {
    const body = htmlToText(it.contentHtml)
    const candidates = [it.link, ...(it.contentHtml.match(/https?:\/\/[^\s"'<>)]+/g) ?? [])]
    const site = candidates.find((u) => {
      const s = safeUrl(u)
      return s && !isAggregatorHost(s.hostname) && s.hostname !== safeUrl(feedUrl)?.hostname
    })
    const aliases = aliasesForUrl(site)
    if (!aliases.length) continue
    const text = `${it.title}\n${body}`
    const cat = categorize(text)
    mentions.push({
      sourceId,
      externalId: it.id,
      url: it.link || site!,
      title: it.title,
      excerpt: body.slice(0, 400),
      author: it.author ?? undefined,
      publishedAt: toIsoDate(it.published ?? it.updated),
      identity: { name: it.title.slice(0, 60), websiteUrl: site, aliases, category: cat.category, tags: cat.tags, platforms: detectPlatforms(text, [site!]) },
      metrics: extractMetricsFromText(text, evidence, 'low'),
      text,
    })
  }
  return { mentions, cursor: { lastRunAt: ctx.now.toISOString() }, fetched: items.length }
}
