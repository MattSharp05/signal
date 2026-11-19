import { categorize } from '../categorize.ts'
import { collapse, decodeEntities, extractJsonLd, htmlToText, ldOfType, stripTags, toIsoDate } from '../html.ts'
import { parseCompactNumber } from '../metrics.ts'
import { aliasesForUrl, normalizeUrl } from '../normalize.ts'
import type { RawMention, RawMetric, RawRelationship } from '../types.ts'
import { pickChangedEntries } from './sitemap-crawl.ts'
import type { ConnectorDefinition } from './types.ts'

const BASE = 'https://quietmoney.000ooo.ooo'

export function quietMoneyDomain(url: string): string | null {
  return url.match(/000ooo\.ooo\/s\/([^/]+)\/?$/i)?.[1]?.toLowerCase() ?? null
}

function faqAnswer(faq: Record<string, unknown> | undefined, re: RegExp): string | null {
  const items = (faq?.mainEntity as Record<string, unknown>[] | undefined) ?? []
  for (const q of items) {
    if (re.test(String(q.name ?? ''))) {
      const a = (q.acceptedAnswer as Record<string, unknown> | undefined)?.text
      return typeof a === 'string' ? a : null
    }
  }
  return null
}

function monthBefore(iso: string): string {
  const d = new Date(iso)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.toISOString()
}

export function parseQuietMoneyPage(html: string, pageUrl: string): RawMention | null {
  const blocks = extractJsonLd(html)
  const article = ldOfType(blocks, 'Article')
  const faq = ldOfType(blocks, 'FAQPage')
  const domainFromUrl = quietMoneyDomain(pageUrl)
  const about = (article?.about as Record<string, unknown> | undefined) ?? {}
  const website = typeof about.url === 'string' ? about.url : domainFromUrl ? `https://${domainFromUrl}` : undefined
  if (!website) return null
  const modified = toIsoDate(String(article?.dateModified ?? '')) ?? undefined

  const h1 = html.match(/<header class="sh">[\s\S]*?<h1>([\s\S]*?)<\/h1>\s*<p>([\s\S]*?)<\/p>/i)
  const name = h1 ? collapse(decodeEntities(stripTags(h1[1]))) : String(about.name ?? domainFromUrl)
  const description = h1 ? collapse(decodeEntities(stripTags(h1[2]))) : undefined
  const typeLabel = html.match(/<span class="ty">([\s\S]*?)<\/span>/i)?.[1]
  const story = html.match(/<blockquote class="quote hook">([\s\S]*?)<\/blockquote>/i)?.[1]
  const storyText = story ? collapse(decodeEntities(stripTags(story))) : undefined
  const text = htmlToText(html)

  const metrics: RawMetric[] = []
  const checkout = faqAnswer(faq, /checkout visits/i)
  if (checkout) {
    const cur = checkout.match(/about\s+([\d,]+(?:\.\d+)?[KkMm]?)\s+last month/i)
    const prev = checkout.match(/month before was\s+([\d,]+(?:\.\d+)?[KkMm]?)/i)
    const curV = cur ? parseCompactNumber(cur[1]) : null
    const prevV = prev ? parseCompactNumber(prev[1]) : null
    if (curV) {
      metrics.push({
        metric: 'checkout_visits_monthly', value: curV, unit: 'visits', evidence: 'third_party_estimate', confidence: 'medium',
        periodLabel: modified ? `Month before ${modified.slice(0, 10)}` : 'Last month', asOf: modified,
        quote: checkout.slice(0, 220), attribution: 'Similarweb estimate via QuietMoney',
        note: 'Visits to a checkout page are not purchases.',
      })
    }
    if (prevV && modified) {
      metrics.push({
        metric: 'checkout_visits_monthly', value: prevV, unit: 'visits', evidence: 'third_party_estimate', confidence: 'medium',
        periodLabel: `Prior month (before ${modified.slice(0, 10)})`, asOf: monthBefore(modified),
        quote: checkout.slice(0, 220), attribution: 'Similarweb estimate via QuietMoney',
        note: 'Period derived from "the month before"; approximate.',
      })
    }
  }
  const rank = text.match(/Global rank\s+([\d,]+),\s*(-?[\d.]+)%\s*month over month/i)
  if (rank) {
    const r = parseCompactNumber(rank[1])
    if (r) metrics.push({ metric: 'global_rank', value: r, unit: 'rank', evidence: 'third_party_estimate', confidence: 'medium', asOf: modified, periodLabel: 'Latest month', quote: rank[0], attribution: 'Similarweb via QuietMoney' })
    const g = parseFloat(rank[2])
    if (Number.isFinite(g)) metrics.push({ metric: 'traffic_growth_pct', value: g, unit: 'percent', evidence: 'third_party_estimate', confidence: 'medium', asOf: modified, periodLabel: 'Month over month', quote: rank[0], attribution: 'Similarweb via QuietMoney' })
  }

  const relationships: RawRelationship[] = []
  const alts = faqAnswer(faq, /alternatives/i)
  const altList = alts?.match(/same category:\s*([^.]+)\./i)?.[1]
  if (altList) {
    for (const n of altList.split(',').map((s) => s.trim()).filter(Boolean)) {
      relationships.push({ name: n, kind: 'similar', reason: 'Listed by QuietMoney as a site in the same category' })
    }
  }
  const pricing = faqAnswer(faq, /how much does/i)
  const acquisition = faqAnswer(faq, /new users come from/i)
  const cat = categorize(`${name} ${description ?? ''} ${typeLabel ?? ''}`)
  const excerptParts = [acquisition ? `Acquisition (QuietMoney): ${acquisition}` : null, storyText ? `Growth story (QuietMoney, compiled from public sources): ${storyText}` : null].filter(Boolean)

  return {
    sourceId: 'quietmoney',
    externalId: normalizeUrl(website)?.domain ?? domainFromUrl ?? website,
    url: pageUrl,
    title: typeof article?.headline === 'string' ? article.headline : `${name} on QuietMoney`,
    excerpt: excerptParts.join('\n\n') || description,
    publishedAt: modified,
    identity: {
      name,
      websiteUrl: website,
      description,
      tagline: description,
      aliases: aliasesForUrl(website),
      category: cat.category,
      tags: [...new Set([...cat.tags, ...(typeLabel ? [collapse(stripTags(typeLabel))] : [])])],
      pricingSummary: pricing && !/not found/i.test(pricing) ? pricing.slice(0, 200) : undefined,
    },
    metrics,
    relationships,
    text: [description, acquisition, storyText].filter(Boolean).join('\n'),
  }
}

export const quietMoney: ConnectorDefinition = {
  id: 'quietmoney',
  name: 'QuietMoney',
  shortName: 'QuietMoney',
  kind: 'sitemap',
  role: 'both',
  homepage: `${BASE}/`,
  docsUrl: `${BASE}/sitemap.xml`,
  notes:
    'Profiles of quietly profitable sites: checkout-visit estimates (Similarweb-based), traffic sources, growth story and alternatives. Read from the public sitemap and schema.org data (robots.txt allows all except /api/). Pro-only sections are never requested. All figures are third-party estimates.',
  defaultStatus: 'operational',
  runsIn: ['server'],
  defaultRefreshMinutes: 720,
  defaultEnabled: true,
  defaultConfig: { pagesPerRun: 25 },
  async discover(ctx) {
    const budget = Math.min(ctx.budget, Number(ctx.config.pagesPerRun ?? 25))
    const entries = await pickChangedEntries(
      ctx,
      `${BASE}/sitemap.xml`,
      (e) => /\/s\/[^/]+\/?$/.test(e.loc),
      (e) => quietMoneyDomain(e.loc) ?? e.loc,
      budget,
    )
    const mentions: RawMention[] = []
    for (const e of entries) {
      try {
        const m = parseQuietMoneyPage(await ctx.http.text(e.loc), e.loc)
        if (m) mentions.push(m)
      } catch (err) {
        ctx.log(`quietmoney ${e.loc}: ${(err as Error).message}`)
      }
    }
    return { mentions, cursor: { lastRunAt: ctx.now.toISOString() }, fetched: entries.length }
  },
  async enrich(ctx, target) {
    if (!target.domain) return []
    const url = `${BASE}/s/${target.domain}/`
    const res = await ctx.http.request(url)
    if (!res.ok) return []
    const m = parseQuietMoneyPage(await res.text(), url)
    return m ? [m] : []
  },
}
