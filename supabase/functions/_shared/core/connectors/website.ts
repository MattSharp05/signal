import { categorize, detectBusinessModel, detectPlatforms, extractPricePoints } from '../categorize.ts'
import { extractMeta, hrefs, htmlToText } from '../html.ts'
import { extractMetricsFromText } from '../metrics.ts'
import { aliasesForUrl, normalizeUrl, registrableDomain } from '../normalize.ts'
import type { Alias, RawMention, RawMetric } from '../types.ts'
import type { ConnectorContext, ConnectorDefinition } from './types.ts'

export function nameFromTitle(title: string | null, siteName: string | null): string | null {
  if (siteName && siteName.length <= 40) return siteName.trim()
  if (!title) return null
  const first = title.split(/\s+[|—–·:-]\s+/)[0]?.trim()
  return first && first.length <= 50 ? first : null
}

const SOCIAL_RE = /https?:\/\/(?:www\.)?(x\.com|twitter\.com|instagram\.com|tiktok\.com|youtube\.com|linkedin\.com\/company)\/(@?[A-Za-z0-9_.-]{2,40})/i

export interface WebsiteParse {
  mention: RawMention
  links: { about: string | null; pricing: string | null }
}

export function parseWebsite(html: string, pageUrl: string, extraTexts: { url: string; text: string }[] = []): WebsiteParse {
  const meta = extractMeta(html, pageUrl)
  const text = htmlToText(html)
  const links = hrefs(html, pageUrl)
  const host = new URL(pageUrl).hostname
  const reg = registrableDomain(host)
  const sameSite = links.filter((l) => {
    try {
      return registrableDomain(new URL(l).hostname) === reg
    } catch {
      return false
    }
  })
  const about = sameSite.find((l) => /\/(about|about-us|story|company|team)\/?$/i.test(new URL(l).pathname)) ?? null
  const pricing = sameSite.find((l) => /\/(pricing|plans|premium|upgrade)\/?$/i.test(new URL(l).pathname)) ?? null

  const allText = [text, ...extraTexts.map((t) => t.text)].join('\n')
  const prices = extractPricePoints(allText)
  const model = detectBusinessModel(allText)
  const description = meta.description ?? meta.ogDescription ?? undefined
  const name = nameFromTitle(meta.ogTitle ?? meta.title, meta.siteName)
  const cat = categorize(`${name ?? ''} ${meta.title ?? ''} ${description ?? ''} ${text.slice(0, 1500)}`)

  // Founder-stated figures. Medium confidence on an About/numbers page, low elsewhere.
  const metrics: RawMetric[] = []
  const collectedAt = new Date().toISOString()
  for (const src of [{ url: pageUrl, text }, ...extraTexts]) {
    const conf = /\/(about|story|company)/i.test(src.url) ? 'medium' : 'low'
    for (const m of extractMetricsFromText(src.text, 'founder_reported', conf)) {
      if (!metrics.some((x) => x.metric === m.metric && x.value === m.value)) {
        metrics.push({ ...m, asOf: collectedAt, periodLabel: 'Stated on website at collection', note: `Stated on ${src.url}` })
      }
    }
  }

  const socials: Alias[] = []
  for (const l of links) {
    const m = l.match(SOCIAL_RE)
    if (m && !/share|intent|sharer/i.test(l)) socials.push({ kind: 'social', value: `${m[1].replace('twitter.com', 'x.com')}/${m[2].replace(/^@/, '')}`.toLowerCase() })
  }

  return {
    links: { about, pricing },
    mention: {
      sourceId: 'website',
      externalId: normalizeUrl(pageUrl)?.domain ?? host,
      url: pageUrl,
      title: meta.title ?? undefined,
      excerpt: description,
      identity: {
        name: name ?? undefined,
        websiteUrl: pageUrl,
        description,
        tagline: meta.ogDescription ?? description,
        aliases: [...aliasesForUrl(pageUrl), ...socials.slice(0, 5)],
        logoUrl: meta.icon ?? undefined,
        category: cat.category,
        tags: cat.tags,
        platforms: detectPlatforms(allText.slice(0, 5000), links),
        businessModel: model ?? undefined,
        pricingSummary: prices.length ? `Price points seen on site: ${prices.join(', ')}` : undefined,
      },
      metrics,
      text: allText.slice(0, 20000),
    },
  }
}

export async function crawlWebsite(ctx: ConnectorContext, websiteUrl: string): Promise<RawMention | null> {
  const home = await ctx.http.text(websiteUrl)
  const first = parseWebsite(home, websiteUrl)
  const extras: { url: string; text: string }[] = []
  for (const l of [first.links.about, first.links.pricing].filter((x): x is string => !!x).slice(0, 2)) {
    try {
      extras.push({ url: l, text: htmlToText(await ctx.http.text(l)) })
    } catch (e) {
      ctx.log(`website ${l}: ${(e as Error).message}`)
    }
  }
  return extras.length ? parseWebsite(home, websiteUrl, extras).mention : first.mention
}

export const website: ConnectorDefinition = {
  id: 'website',
  name: 'Founder website',
  shortName: 'Website',
  kind: 'public_page',
  role: 'enrichment',
  homepage: '',
  notes:
    "Reads the product's own homepage plus About/Pricing pages when linked (robots.txt checked first). Figures stated there are founder-reported and never treated as verified.",
  defaultStatus: 'operational',
  runsIn: ['server'],
  defaultRefreshMinutes: 10080,
  defaultEnabled: true,
  async enrich(ctx, target) {
    const url = target.websiteUrl ?? (target.domain ? `https://${target.domain}` : null)
    if (!url) return []
    // code hosts / app stores are not the product's own website
    if (/^https:\/\/(github\.com|gitlab\.com|huggingface\.co|apps\.apple\.com|play\.google\.com)\//.test(url)) return []
    const m = await crawlWebsite(ctx, url)
    return m ? [m] : []
  },
}
