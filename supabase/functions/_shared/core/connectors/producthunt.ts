import { categorize, detectPlatforms } from '../categorize.ts'
import { htmlToText, parseFeed, toIsoDate } from '../html.ts'
import { aliasesForUrl, normalizeUrl } from '../normalize.ts'
import type { RawMention } from '../types.ts'
import type { ConnectorDefinition } from './types.ts'

export function phSlugFromUrl(url: string): string | null {
  const m = url.match(/producthunt\.com\/(?:products|posts)\/([a-z0-9-]+)/i)
  return m ? m[1].toLowerCase() : null
}

export const productHuntFeed: ConnectorDefinition = {
  id: 'producthunt_feed',
  name: 'Product Hunt – public feed',
  shortName: 'Product Hunt',
  kind: 'rss',
  role: 'discovery',
  homepage: 'https://www.producthunt.com/',
  docsUrl: 'https://www.producthunt.com/feed',
  notes:
    'Public Atom feed of recent launches (name, tagline, hunter, date). The feed has no website URL or vote counts; Product Hunt pages are bot-protected and are not scraped. Products are identified by their Product Hunt slug until another source supplies a domain.',
  defaultStatus: 'operational',
  runsIn: ['server'],
  defaultRefreshMinutes: 120,
  defaultEnabled: true,
  async discover(ctx) {
    const xml = await ctx.http.text('https://www.producthunt.com/feed')
    const items = parseFeed(xml)
    const mentions: RawMention[] = []
    for (const it of items) {
      const slug = phSlugFromUrl(it.link)
      if (!slug) continue
      const paragraphs = [...it.contentHtml.matchAll(/<p>([\s\S]*?)<\/p>/gi)].map((m) => htmlToText(m[1]))
      const tagline = paragraphs.find((p) => p && !/^Discussion\s*\|/i.test(p)) ?? null
      const cat = categorize(`${it.title} ${tagline ?? ''}`)
      mentions.push({
        sourceId: 'producthunt_feed',
        externalId: it.id,
        url: it.link.split('?')[0],
        title: it.title,
        excerpt: tagline ?? undefined,
        author: it.author ?? undefined,
        publishedAt: toIsoDate(it.published),
        identity: {
          name: it.title,
          tagline: tagline ?? undefined,
          aliases: [{ kind: 'ph_slug', value: slug }],
          category: cat.category,
          tags: cat.tags,
          platforms: detectPlatforms(tagline ?? '', []),
          launchDate: toIsoDate(it.published),
        },
        metrics: [],
        text: `${it.title}. ${tagline ?? ''}`,
      })
    }
    return { mentions, cursor: { lastRunAt: ctx.now.toISOString() }, fetched: items.length }
  },
}

interface PHPost {
  id: string
  name: string
  tagline: string
  slug: string
  url: string
  website: string
  votesCount: number
  commentsCount: number
  createdAt: string
  thumbnail?: { url: string } | null
  topics: { edges: { node: { name: string } }[] }
}

export const productHuntApi: ConnectorDefinition = {
  id: 'producthunt_api',
  name: 'Product Hunt – GraphQL API',
  shortName: 'Product Hunt',
  kind: 'api',
  role: 'discovery',
  homepage: 'https://www.producthunt.com/',
  docsUrl: 'https://api.producthunt.com/v2/docs',
  notes:
    'Official API v2 with vote counts, topics and website. Requires a developer token (PRODUCT_HUNT_TOKEN). Commercial use requires Product Hunt approval.',
  defaultStatus: 'requires_credentials',
  requiresCredentials: ['PRODUCT_HUNT_TOKEN'],
  runsIn: ['server'],
  defaultRefreshMinutes: 120,
  defaultEnabled: false,
  async discover(ctx) {
    const token = ctx.env('PRODUCT_HUNT_TOKEN')
    if (!token) throw new Error('PRODUCT_HUNT_TOKEN is not configured')
    const postedAfter = new Date(ctx.now.getTime() - 2 * 86400_000).toISOString()
    const query = `query($after: DateTime!) { posts(order: NEWEST, postedAfter: $after, first: 50) { edges { node {
      id name tagline slug url website votesCount commentsCount createdAt thumbnail { url } topics(first: 5) { edges { node { name } } } } } } }`
    const res = await ctx.http.json<{ data?: { posts: { edges: { node: PHPost }[] } }; errors?: { message: string }[] }>(
      'https://api.producthunt.com/v2/api/graphql',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query, variables: { after: postedAfter } }),
      },
    )
    if (res.errors?.length) throw new Error(`Product Hunt API: ${res.errors[0].message}`)
    const mentions: RawMention[] = []
    for (const { node } of res.data?.posts.edges ?? []) {
      // `website` is usually a producthunt.com redirect; only use it if it is a real external URL
      const site = normalizeUrl(node.website)
      const websiteUrl = site && !site.isAggregator ? site.url : undefined
      const topics = node.topics.edges.map((e) => e.node.name)
      const cat = categorize(`${node.name} ${node.tagline} ${topics.join(' ')}`)
      const asOf = ctx.now.toISOString()
      mentions.push({
        sourceId: 'producthunt_api',
        externalId: node.id,
        url: node.url.split('?')[0],
        title: node.name,
        excerpt: node.tagline,
        publishedAt: node.createdAt,
        identity: {
          name: node.name,
          tagline: node.tagline,
          websiteUrl,
          aliases: [{ kind: 'ph_slug', value: node.slug }, ...aliasesForUrl(websiteUrl)],
          logoUrl: node.thumbnail?.url,
          category: cat.category,
          tags: [...new Set([...cat.tags, ...topics])],
          platforms: detectPlatforms(node.tagline, websiteUrl ? [websiteUrl] : []),
          launchDate: node.createdAt,
        },
        metrics: [
          { metric: 'upvotes', value: node.votesCount, unit: 'count', evidence: 'platform_metric', confidence: 'high', asOf, periodLabel: 'PH votes at collection' },
          { metric: 'comments', value: node.commentsCount, unit: 'count', evidence: 'platform_metric', confidence: 'high', asOf, periodLabel: 'PH comments at collection' },
        ],
      })
    }
    return { mentions, cursor: { lastRunAt: ctx.now.toISOString() }, fetched: mentions.length }
  },
}
