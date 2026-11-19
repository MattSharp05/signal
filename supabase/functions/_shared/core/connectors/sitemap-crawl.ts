import { parseSitemap, type SitemapEntry } from '../html.ts'
import type { ConnectorContext } from './types.ts'

/**
 * Incremental sitemap crawl: returns up to `budget` entries (newest lastmod first) whose page
 * changed since we last collected it. Never re-fetches unchanged pages.
 */
export async function pickChangedEntries(
  ctx: ConnectorContext,
  sitemapUrl: string,
  filter: (e: SitemapEntry) => boolean,
  toExternalId: (e: SitemapEntry) => string,
  budget: number,
): Promise<SitemapEntry[]> {
  const xml = await ctx.http.text(sitemapUrl)
  const { urls } = parseSitemap(xml)
  const candidates = urls.filter(filter).sort((a, b) => (b.lastmod ?? '').localeCompare(a.lastmod ?? ''))
  const picked: SitemapEntry[] = []
  for (const e of candidates) {
    if (picked.length >= budget) break
    const last = await ctx.lastCollected(toExternalId(e))
    if (!last) picked.push(e)
    else if (e.lastmod && new Date(e.lastmod).getTime() > new Date(last).getTime() + 3600_000) picked.push(e)
  }
  ctx.log(`sitemap ${sitemapUrl}: ${urls.length} urls, ${candidates.length} candidates, ${picked.length} picked`)
  return picked
}
