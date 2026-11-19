// Connectors that need credentials or approvals. Implemented against the official APIs; they run only when configured.
import { categorize, detectPlatforms } from '../categorize.ts'
import { decodeEntities } from '../html.ts'
import { extractMetricsFromText } from '../metrics.ts'
import { aliasesForUrl, isAggregatorHost, normalizeName, safeUrl } from '../normalize.ts'
import type { RawAd, RawMention } from '../types.ts'
import type { ConnectorDefinition } from './types.ts'

// ---------------- Reddit (official Data API, OAuth client credentials) ----------------

interface RedditPost {
  id: string
  title: string
  url: string
  permalink: string
  selftext: string
  author: string
  score: number
  num_comments: number
  created_utc: number
  is_self: boolean
  subreddit: string
}

export const reddit: ConnectorDefinition = {
  id: 'reddit',
  name: 'Reddit – r/SaaS, r/SideProject, r/indiehackers',
  shortName: 'Reddit',
  kind: 'api',
  role: 'discovery',
  homepage: 'https://www.reddit.com/r/SideProject/',
  docsUrl: 'https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki',
  notes:
    'Official Reddit Data API via OAuth (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET). Anonymous JSON/RSS access is blocked. Commercial use may require an agreement with Reddit. Revenue claims in posts are founder-reported, low confidence.',
  defaultStatus: 'requires_credentials',
  requiresCredentials: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
  runsIn: ['server'],
  defaultRefreshMinutes: 120,
  defaultEnabled: false,
  defaultConfig: { subreddits: ['SaaS', 'SideProject', 'indiehackers'], minScore: 5 },
  async discover(ctx) {
    const id = ctx.env('REDDIT_CLIENT_ID')
    const secret = ctx.env('REDDIT_CLIENT_SECRET')
    if (!id || !secret) throw new Error('Reddit credentials are not configured')
    const tok = await ctx.http.json<{ access_token: string }>('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: { authorization: `Basic ${btoa(`${id}:${secret}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    const subs = (ctx.config.subreddits as string[] | undefined) ?? ['SaaS', 'SideProject', 'indiehackers']
    const minScore = Number(ctx.config.minScore ?? 5)
    const mentions: RawMention[] = []
    let fetched = 0
    for (const sub of subs) {
      const data = await ctx.http.json<{ data: { children: { data: RedditPost }[] } }>(`https://oauth.reddit.com/r/${sub}/new?limit=50`, {
        headers: { authorization: `Bearer ${tok.access_token}` },
      })
      for (const { data: p } of data.data.children) {
        fetched++
        if (p.score < minScore) continue
        const body = decodeEntities(p.selftext ?? '')
        const link = !p.is_self ? p.url : (body.match(/https?:\/\/[^\s)\]]+/g) ?? []).find((u) => { const s = safeUrl(u); return s && !isAggregatorHost(s.hostname) })
        const aliases = aliasesForUrl(link)
        if (!aliases.length) continue // posts without a product link are not product discoveries
        const text = `${p.title}\n${body}`
        const cat = categorize(text)
        mentions.push({
          sourceId: 'reddit',
          externalId: p.id,
          url: `https://www.reddit.com${p.permalink}`,
          title: p.title,
          excerpt: body.slice(0, 400) || undefined,
          author: p.author,
          publishedAt: new Date(p.created_utc * 1000).toISOString(),
          identity: { websiteUrl: link, aliases, category: cat.category, tags: [...cat.tags, `r/${p.subreddit}`], platforms: detectPlatforms(text, link ? [link] : []) },
          metrics: [
            { metric: 'upvotes', value: p.score, unit: 'count', evidence: 'platform_metric', confidence: 'high', asOf: ctx.now.toISOString(), periodLabel: 'Reddit score at collection' },
            ...extractMetricsFromText(text, 'founder_reported', 'low'),
          ],
          text,
        })
      }
    }
    return { mentions, cursor: { lastRunAt: ctx.now.toISOString() }, fetched }
  },
}

// ---------------- Meta Ad Library (official Graph API) ----------------

interface MetaAd {
  id: string
  page_name?: string
  ad_creative_bodies?: string[]
  ad_creative_link_titles?: string[]
  ad_creative_link_captions?: string[]
  ad_delivery_start_time?: string
  ad_delivery_stop_time?: string
  ad_snapshot_url?: string
  publisher_platforms?: string[]
}

export const metaAds: ConnectorDefinition = {
  id: 'meta_ads',
  name: 'Meta Ad Library API',
  shortName: 'Meta Ads',
  kind: 'api',
  role: 'enrichment',
  homepage: 'https://www.facebook.com/ads/library/',
  docsUrl: 'https://www.facebook.com/ads/library/api/',
  notes:
    'Official Ad Library API (ads_archive). Requires a user access token with identity verification (META_ADS_TOKEN). Coverage: ads delivered in the EU (DSA transparency) plus political/issue ads. Spend and performance are not available for commercial ads and are never inferred.',
  defaultStatus: 'requires_credentials',
  requiresCredentials: ['META_ADS_TOKEN'],
  runsIn: ['server'],
  defaultRefreshMinutes: 1440,
  defaultEnabled: false,
  defaultConfig: { countries: ['FR', 'DE', 'ES', 'IT', 'NL', 'IE'] },
  async enrich(ctx, target) {
    const token = ctx.env('META_ADS_TOKEN')
    if (!token) throw new Error('META_ADS_TOKEN is not configured')
    const countries = (ctx.config.countries as string[] | undefined) ?? ['FR', 'DE']
    const fields = 'id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,publisher_platforms'
    const url = `https://graph.facebook.com/v21.0/ads_archive?search_terms=${encodeURIComponent(target.name)}&ad_type=ALL&ad_reached_countries=${encodeURIComponent(JSON.stringify(countries))}&fields=${fields}&limit=50&access_token=${encodeURIComponent(token)}`
    const data = await ctx.http.json<{ data: MetaAd[] }>(url)
    const want = normalizeName(target.name)
    const ads: RawAd[] = []
    for (const a of data.data) {
      const caption = (a.ad_creative_link_captions ?? [])[0]?.toLowerCase() ?? ''
      // only attach ads whose advertiser page or landing caption matches this product
      if (normalizeName(a.page_name) !== want && !(target.domain && caption.includes(target.domain))) continue
      ads.push({
        externalId: a.id,
        platform: 'meta',
        advertiser: a.page_name,
        headline: a.ad_creative_link_titles?.[0],
        body: a.ad_creative_bodies?.[0],
        mediaType: 'unknown',
        landingUrl: caption ? `https://${caption}` : undefined,
        firstObserved: a.ad_delivery_start_time,
        lastObserved: a.ad_delivery_stop_time ?? ctx.now.toISOString(),
        isActive: !a.ad_delivery_stop_time,
        originalUrl: a.ad_snapshot_url?.replace(/access_token=[^&]+/, ''),
      })
    }
    if (!ads.length) return []
    return [{
      sourceId: 'meta_ads', externalId: `ads:${target.productId}:${ctx.now.toISOString().slice(0, 10)}`,
      url: `https://www.facebook.com/ads/library/?q=${encodeURIComponent(target.name)}`, title: `Meta Ad Library: ${ads.length} ads for ${target.name}`,
      identity: { aliases: target.domain ? [{ kind: 'domain', value: target.domain }] : [], name: target.name }, metrics: [], ads,
    }]
  },
}

// ---------------- Similarweb DigitalRank (official API, key required) ----------------

export const similarweb: ConnectorDefinition = {
  id: 'similarweb',
  name: 'Similarweb DigitalRank API',
  shortName: 'Similarweb',
  kind: 'licensed',
  role: 'enrichment',
  homepage: 'https://www.similarweb.com/',
  docsUrl: 'https://developers.similarweb.com/',
  notes:
    'Global rank via the DigitalRank API (SIMILARWEB_API_KEY). Full traffic data requires a paid Similarweb plan. All values are estimates. Untested in this build (no key available).',
  defaultStatus: 'requires_credentials',
  requiresCredentials: ['SIMILARWEB_API_KEY'],
  runsIn: ['server'],
  defaultRefreshMinutes: 10080,
  defaultEnabled: false,
  async enrich(ctx, target) {
    const key = ctx.env('SIMILARWEB_API_KEY')
    if (!key) throw new Error('SIMILARWEB_API_KEY is not configured')
    if (!target.domain) return []
    const d = await ctx.http.json<{ similar_rank?: { rank: number } }>(`https://api.similarweb.com/v1/similar-rank/${target.domain}/rank?api_key=${encodeURIComponent(key)}`)
    const rank = d.similar_rank?.rank
    if (!rank) return []
    return [{
      sourceId: 'similarweb', externalId: `${target.domain}:${ctx.now.toISOString().slice(0, 7)}`, url: `https://www.similarweb.com/website/${target.domain}/`,
      title: `Similarweb rank for ${target.domain}`, identity: { aliases: [{ kind: 'domain', value: target.domain }] },
      metrics: [{ metric: 'global_rank', value: rank, unit: 'rank', evidence: 'third_party_estimate', confidence: 'medium', asOf: ctx.now.toISOString(), periodLabel: 'Latest', attribution: 'Similarweb' }],
    }]
  },
}
