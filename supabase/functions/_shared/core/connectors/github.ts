import { categorize } from '../categorize.ts'
import { aliasesForUrl, normalizeUrl } from '../normalize.ts'
import type { RawMention } from '../types.ts'
import type { ConnectorDefinition } from './types.ts'

interface Repo {
  id: number
  full_name: string
  name: string
  html_url: string
  description: string | null
  homepage: string | null
  stargazers_count: number
  language: string | null
  topics?: string[]
  created_at: string
  pushed_at: string
  owner: { login: string; avatar_url: string }
}

export function prettyRepoName(name: string): string {
  return name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export const githubRising: ConnectorDefinition = {
  id: 'github_rising',
  name: 'GitHub – rising new repositories',
  shortName: 'GitHub',
  kind: 'api',
  role: 'discovery',
  homepage: 'https://github.com/trending',
  docsUrl: 'https://docs.github.com/en/rest/search/search#search-repositories',
  notes:
    'GitHub has no Trending API. This connector uses the official Search API for repositories created in the last N days, ranked by stars. Stars are a platform metric. Optional GITHUB_TOKEN raises rate limits.',
  defaultStatus: 'operational',
  runsIn: ['server', 'browser'],
  defaultRefreshMinutes: 360,
  defaultEnabled: true,
  defaultConfig: { days: 7, minStars: 100 },
  async discover(ctx) {
    const days = Number(ctx.config.days ?? 7)
    const minStars = Number(ctx.config.minStars ?? 100)
    const since = new Date(ctx.now.getTime() - days * 86400_000).toISOString().slice(0, 10)
    const q = encodeURIComponent(`created:>${since} stars:>=${minStars}`)
    const token = ctx.env('GITHUB_TOKEN')
    const headers: Record<string, string> = { accept: 'application/vnd.github+json' }
    if (token) headers.authorization = `Bearer ${token}`
    const data = await ctx.http.json<{ items: Repo[] }>(
      `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${Math.min(50, ctx.budget * 2)}`,
      { headers },
    )
    const mentions: RawMention[] = []
    for (const r of data.items) {
      const home = normalizeUrl(r.homepage)
      const websiteUrl = home && !home.isAggregator ? home.url : r.html_url
      const text = `${r.name} ${r.description ?? ''} ${(r.topics ?? []).join(' ')}`
      const cat = categorize(`${text} developer open source`)
      mentions.push({
        sourceId: 'github_rising',
        externalId: String(r.id),
        url: r.html_url,
        title: r.full_name,
        excerpt: r.description ?? undefined,
        author: r.owner.login,
        publishedAt: r.created_at,
        identity: {
          name: prettyRepoName(r.name),
          tagline: r.description ?? undefined,
          description: r.description ?? undefined,
          websiteUrl,
          aliases: [{ kind: 'github_repo', value: r.full_name.toLowerCase() }, ...aliasesForUrl(websiteUrl), ...aliasesForUrl(r.html_url)],
          logoUrl: r.owner.avatar_url,
          category: cat.category === 'Other' ? 'Developer Tools' : cat.category,
          tags: [...new Set([...cat.tags, ...(r.language ? [r.language] : []), ...(r.topics ?? []).slice(0, 4)])],
          platforms: ['Open source'],
          launchDate: r.created_at,
          businessModel: 'Open source',
        },
        metrics: [
          { metric: 'stars', value: r.stargazers_count, unit: 'count', evidence: 'platform_metric', confidence: 'high', asOf: ctx.now.toISOString(), periodLabel: 'Stars at collection' },
        ],
      })
    }
    return { mentions, cursor: { lastRunAt: ctx.now.toISOString() }, fetched: data.items.length }
  },
}
