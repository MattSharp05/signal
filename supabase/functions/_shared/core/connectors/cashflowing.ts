import { extractMeta, htmlToText } from '../html.ts'
import { parseCompactNumber } from '../metrics.ts'
import { aliasesForUrl } from '../normalize.ts'
import type { RawMention, RawMetric } from '../types.ts'
import type { ConnectorDefinition } from './types.ts'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const monthIdx = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase())

function monthRange(year: number, m: number) {
  const start = new Date(Date.UTC(year, m, 1))
  const end = new Date(Date.UTC(year, m + 1, 0))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

/**
 * Parse a Cashflowing site page. Ingests ONLY observed checkout-traffic figures and the Similarweb rank.
 * The page's "revenue estimator" is a slider model driven by user assumptions and is deliberately ignored.
 */
export function parseCashflowingPage(html: string, pageUrl: string, domain: string): RawMention | null {
  const meta = extractMeta(html, pageUrl)
  const desc = meta.description ?? ''
  const text = htmlToText(html)
  const metrics: RawMetric[] = []
  const attribution = 'Cashflowing (modelled third-party estimate)'
  const note = 'Visits to checkout pages are modelled estimates, not purchases or revenue.'

  const total = desc.match(/sent\s+([\d.,]+[KkMm]?)\s+visits to checkout pages from\s+([A-Za-z]+)\s+to\s+([A-Za-z]+)\s+(\d{4})/i)
  let year: number | null = null
  let endMonth: number | null = null
  if (total) {
    const v = parseCompactNumber(total[1])
    year = Number(total[4])
    const sm = monthIdx(total[2])
    endMonth = monthIdx(total[3])
    if (v && sm >= 0 && endMonth >= 0) {
      const startYear = sm > endMonth ? year - 1 : year
      metrics.push({
        metric: 'checkout_visits_total', value: v, unit: 'visits', evidence: 'third_party_estimate', confidence: 'medium',
        periodStart: monthRange(startYear, sm).start, periodEnd: monthRange(year, endMonth).end,
        periodLabel: `${total[2].slice(0, 3)}–${total[3].slice(0, 3)} ${year}`, asOf: monthRange(year, endMonth).end,
        quote: total[0], attribution, note,
      })
    }
  }

  // Monthly trend: "Trend, April to September 0 Apr 0 May 0 Jun 25K Jul 52.8K Aug 44.4K Sep"
  const trend = text.match(/Trend,\s*[A-Za-z]+\s+to\s+[A-Za-z]+\s+((?:[\d.,]+[KkMm]?\s+[A-Z][a-z]{2}\s*){2,12})/)
  if (trend && year !== null && endMonth !== null) {
    const pairs = [...trend[1].matchAll(/([\d.,]+[KkMm]?)\s+([A-Z][a-z]{2})/g)]
    for (const [, val, mon] of pairs) {
      const v = parseCompactNumber(val)
      const mi = monthIdx(mon)
      if (!v || mi < 0) continue // zero months are treated as "no data", never as a measured zero
      const y = mi > endMonth ? year - 1 : year
      const r = monthRange(y, mi)
      metrics.push({
        metric: 'checkout_visits_monthly', value: v, unit: 'visits', evidence: 'third_party_estimate', confidence: 'medium',
        periodStart: r.start, periodEnd: r.end, periodLabel: `${mon} ${y}`, asOf: r.end,
        quote: `${val} ${mon} (Cashflowing trend chart)`, attribution, note,
      })
    }
  }

  const rank = text.match(/#([\d,]+)\s+in the world\s*\(Similarweb\)/i)
  if (rank) {
    const r = parseCompactNumber(rank[1])
    if (r) metrics.push({ metric: 'global_rank', value: r, unit: 'rank', evidence: 'third_party_estimate', confidence: 'medium', periodLabel: 'Latest', quote: rank[0], attribution: 'Similarweb via Cashflowing' })
  }

  const provider = text.match(/All through ([A-Z][\w ]+?Checkout|Stripe|Paddle|Lemon Squeezy|Gumroad|PayPal)/)?.[1]
  const what = text.match(/What [^ ]+ does\s+(.+?)\s+Summarised from/i)?.[1]
  if (!metrics.length && !what) return null
  const nameFromTitle = (meta.ogTitle ?? meta.title ?? '').split(/ revenue estimate| —/)[0]?.trim()

  return {
    sourceId: 'cashflowing',
    externalId: domain,
    url: pageUrl,
    title: meta.ogTitle ?? meta.title ?? `${domain} on Cashflowing`,
    excerpt: [desc, provider ? `Checkout provider observed: ${provider}.` : null].filter(Boolean).join(' '),
    identity: {
      name: nameFromTitle || undefined,
      websiteUrl: `https://${domain}`,
      description: what,
      aliases: aliasesForUrl(`https://${domain}`),
      tags: provider ? [provider] : [],
    },
    metrics,
    text: what,
  }
}

export const cashflowing: ConnectorDefinition = {
  id: 'cashflowing',
  name: 'Cashflowing',
  shortName: 'Cashflowing',
  kind: 'public_page',
  role: 'enrichment',
  homepage: 'https://cashflowing.app/',
  docsUrl: 'https://cashflowing.app/en/ranking',
  notes:
    'Per-domain lookup of modelled checkout-page traffic (by month) and checkout provider. Used for enrichment only: its sitemap is dominated by large retailers. The on-page "revenue estimator" is an assumptions slider and is never ingested. Full dataset is licensed (paid).',
  defaultStatus: 'operational',
  runsIn: ['server'],
  defaultRefreshMinutes: 10080,
  defaultEnabled: true,
  async enrich(ctx, target) {
    if (!target.domain) return []
    const url = `https://cashflowing.app/en/sites/${target.domain}`
    const res = await ctx.http.request(url)
    if (!res.ok) return []
    const m = parseCashflowingPage(await res.text(), url, target.domain)
    return m ? [m] : []
  },
}
