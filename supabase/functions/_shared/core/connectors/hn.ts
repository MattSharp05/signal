import { categorize, detectPlatforms } from '../categorize.ts'
import { htmlToText } from '../html.ts'
import { extractMetricsFromText } from '../metrics.ts'
import { aliasesForUrl } from '../normalize.ts'
import type { RawMention } from '../types.ts'
import type { ConnectorDefinition } from './types.ts'

interface HNHit {
  objectID: string
  title: string
  url: string | null
  author: string
  points: number | null
  num_comments: number | null
  created_at: string
  created_at_i: number
  story_text?: string | null
}

/** "Show HN: Brandon – AI that reads your group chat" → { name: "Brandon", tagline: "AI that reads your group chat" } */
export function parseShowHnTitle(title: string): { name: string; tagline: string | null } {
  const t = title.replace(/^(show|launch)\s+hn\s*:\s*/i, '').trim()
  const m = t.match(/^(.{1,60}?)\s+[–—:|-]\s+(.+)$/) ?? t.match(/^(.{1,60}?)\s*[,(]\s*(.+?)\)?$/)
  if (m) return { name: m[1].trim(), tagline: m[2].trim() }
  return { name: t.split(/\s+/).slice(0, 4).join(' '), tagline: t }
}

export const hnShow: ConnectorDefinition = {
  id: 'hn_show',
  name: 'Hacker News – Show HN',
  shortName: 'Show HN',
  kind: 'api',
  role: 'discovery',
  homepage: 'https://news.ycombinator.com/show',
  docsUrl: 'https://hn.algolia.com/api',
  notes: 'Official Algolia HN Search API. Points and comments are platform metrics, not business metrics.',
  defaultStatus: 'operational',
  runsIn: ['server', 'browser'],
  defaultRefreshMinutes: 60,
  defaultEnabled: true,
  defaultConfig: { minPoints: 5, lookbackHours: 48 },
  async discover(ctx) {
    const minPoints = Number(ctx.config.minPoints ?? 5)
    const lookback = Number(ctx.config.lookbackHours ?? 48)
    const since = Math.floor(ctx.now.getTime() / 1000) - lookback * 3600
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=${Math.min(200, ctx.budget * 10)}&numericFilters=created_at_i>${since},points>=${minPoints}`
    const data = await ctx.http.json<{ hits: HNHit[] }>(url)
    const mentions: RawMention[] = []
    for (const h of data.hits) {
      if (!/^show hn/i.test(h.title)) continue
      const { name, tagline } = parseShowHnTitle(h.title)
      const itemUrl = `https://news.ycombinator.com/item?id=${h.objectID}`
      const body = h.story_text ? htmlToText(h.story_text) : ''
      const text = `${h.title}\n${body}`
      const aliases = [...aliasesForUrl(h.url), { kind: 'hn_item' as const, value: h.objectID }]
      const cat = categorize(`${tagline ?? ''} ${body}`)
      const asOf = ctx.now.toISOString()
      mentions.push({
        sourceId: 'hn_show',
        externalId: h.objectID,
        url: itemUrl,
        title: h.title,
        excerpt: body ? body.slice(0, 400) : tagline ?? undefined,
        author: h.author,
        publishedAt: h.created_at,
        identity: {
          name,
          tagline: tagline ?? undefined,
          websiteUrl: h.url ?? undefined,
          aliases,
          category: cat.category,
          tags: cat.tags,
          platforms: detectPlatforms(text, h.url ? [h.url] : []),
          launchDate: h.created_at,
        },
        metrics: [
          ...(h.points != null
            ? [{ metric: 'upvotes' as const, value: h.points, unit: 'count' as const, evidence: 'platform_metric' as const, confidence: 'high' as const, asOf, periodLabel: 'HN points at collection' }]
            : []),
          ...(h.num_comments != null
            ? [{ metric: 'comments' as const, value: h.num_comments, unit: 'count' as const, evidence: 'platform_metric' as const, confidence: 'high' as const, asOf, periodLabel: 'HN comments at collection' }]
            : []),
          // founder posts often state revenue — founder_reported, low confidence
          ...extractMetricsFromText(text, 'founder_reported', 'low'),
        ],
        text,
      })
    }
    return { mentions, cursor: { lastRunAt: ctx.now.toISOString() }, fetched: data.hits.length }
  },
}
