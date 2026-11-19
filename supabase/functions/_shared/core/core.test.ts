import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { groundFacts } from './ai.ts'
import { categorize } from './categorize.ts'
import { parseCashflowingPage } from './connectors/cashflowing.ts'
import { parseShowHnTitle } from './connectors/hn.ts'
import { defaultSourceRecords } from './connectors/index.ts'
import { parseQuietMoneyPage } from './connectors/quietmoney.ts'
import { parseTrustMrrPage } from './connectors/trustmrr.ts'
import { parseWebsite } from './connectors/website.ts'
import { htmlToText, parseFeed } from './html.ts'
import { parseRobots, robotsAllows } from './http.ts'
import { MemoryStore, emptyData } from './memory-store.ts'
import { extractMetricsFromText, formatMetricValue, parseCompactNumber } from './metrics.ts'
import { normalizeName, normalizeUrl } from './normalize.ts'
import { ingestMention } from './pipeline.ts'
import { computeOpportunityScore } from './scoring.ts'
import { pickCardMetrics } from './summarize.ts'
import type { RawMention } from './types.ts'

const fx = (f: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${f}`, import.meta.url)), 'utf8')
const store = () => new MemoryStore(emptyData(defaultSourceRecords()))
const fixedNow = () => new Date('2026-11-19T12:00:00Z')

describe('normalize', () => {
  it('normalizes domains and strips tracking', () => {
    const n = normalizeUrl('https://WWW.WhatBrandonThinks.com/about?utm_source=x#top')!
    expect(n.domain).toBe('whatbrandonthinks.com')
    expect(n.url).toBe('https://whatbrandonthinks.com/about')
  })
  it('handles multi-part suffixes and subdomains', () => {
    expect(normalizeUrl('https://app.example.co.uk')!.domain).toBe('example.co.uk')
    expect(normalizeUrl('app.foo.io')!.domain).toBe('foo.io')
  })
  it('uses host/path identity for shared hosts', () => {
    expect(normalizeUrl('https://github.com/Owner/Repo/tree/main')!.hostPath).toBe('github.com/owner/repo')
    expect(normalizeUrl('https://cool-tool.vercel.app/x')!.hostPath).toBe('cool-tool.vercel.app')
    expect(normalizeUrl('https://cool-tool.vercel.app')!.domain).toBeNull()
  })
  it('marks aggregators', () => {
    expect(normalizeUrl('https://www.producthunt.com/products/x')!.isAggregator).toBe(true)
    expect(normalizeUrl('https://news.ycombinator.com/item?id=1')!.isAggregator).toBe(true)
  })
  it('normalizes names', () => {
    expect(normalizeName('WhatBrandonThinks.com')).toBe(normalizeName('What Brandon Thinks'))
    expect(normalizeName('Show HN: Acme AI')).toBe('acme')
  })
})

describe('metrics', () => {
  it('parses compact numbers', () => {
    expect(parseCompactNumber('60K')).toBe(60000)
    expect(parseCompactNumber('$3.4k')).toBe(3400)
    expect(parseCompactNumber('710,000+')).toBe(710000)
    expect(parseCompactNumber('-16.06%')).toBe(-16.06)
  })
  it('extracts explicit founder claims only', () => {
    const m = extractMetricsFromText('We just hit $12k MRR with 3,400 users. Founded 2026.', 'founder_reported')
    expect(m.find((x) => x.metric === 'mrr')?.value).toBe(12000)
    expect(m.find((x) => x.metric === 'users')?.value).toBe(3400)
    expect(extractMetricsFromText('We plan to grow revenue a lot', 'founder_reported')).toHaveLength(0)
  })
  it('formats', () => {
    expect(formatMetricValue('mrr', 3368.44)).toBe('$3.4K')
    expect(formatMetricValue('global_rank', 171066)).toBe('#171,066')
    expect(formatMetricValue('traffic_growth_pct', -16.06)).toBe('-16%')
  })
})

describe('parsers (real fixtures)', () => {
  it('TrustMRR → verified revenue', () => {
    const m = parseTrustMrrPage(fx('trustmrr-aistote.html'), 'https://trustmrr.com/startup/aistote')!
    expect(m.identity.name).toBe('Aistote')
    expect(m.identity.aliases).toContainEqual({ kind: 'domain', value: 'aistote.com' })
    const mrr = m.metrics.find((x) => x.metric === 'mrr')!
    expect(mrr.value).toBeCloseTo(3368.44)
    expect(mrr.evidence).toBe('verified')
    expect(m.metrics.find((x) => x.metric === 'customers')?.value).toBe(352)
  })
  it('QuietMoney → third-party estimates + alternatives', () => {
    const m = parseQuietMoneyPage(fx('quietmoney-whatbrandonthinks.html'), 'https://quietmoney.000ooo.ooo/s/whatbrandonthinks.com/')!
    expect(m.identity.aliases).toContainEqual({ kind: 'domain', value: 'whatbrandonthinks.com' })
    const cv = m.metrics.filter((x) => x.metric === 'checkout_visits_monthly')
    expect(cv.map((x) => x.value)).toEqual([60172, 63070])
    expect(cv.every((x) => x.evidence === 'third_party_estimate')).toBe(true)
    expect(m.metrics.find((x) => x.metric === 'traffic_growth_pct')?.value).toBe(-16.06)
    expect(m.relationships?.map((r) => r.name)).toContain('Tally')
    expect(m.metrics.some((x) => ['mrr', 'arr', 'revenue_30d'].includes(x.metric))).toBe(false)
  })
  it('Cashflowing → monthly checkout history, never the estimator', () => {
    const m = parseCashflowingPage(fx('cashflowing-whatbrandonthinks.html'), 'https://cashflowing.app/en/sites/whatbrandonthinks.com', 'whatbrandonthinks.com')!
    const total = m.metrics.find((x) => x.metric === 'checkout_visits_total')!
    expect(total.value).toBe(122000)
    expect(total.periodStart).toBe('2026-04-01')
    const monthly = m.metrics.filter((x) => x.metric === 'checkout_visits_monthly').map((x) => [x.periodLabel, x.value])
    expect(monthly).toEqual([['Jul 2026', 25000], ['Aug 2026', 52800], ['Sep 2026', 44400]])
    expect(m.metrics.some((x) => ['mrr', 'arr', 'revenue_run_rate'].includes(x.metric))).toBe(false)
  })
  it('Founder website → founder-reported accounts', () => {
    const home = fx('whatbrandonthinks-home.html')
    const about = htmlToText(fx('whatbrandonthinks-about.html'))
    const { mention } = parseWebsite(home, 'https://whatbrandonthinks.com', [{ url: 'https://whatbrandonthinks.com/about', text: about }])
    const acc = mention.metrics.find((x) => x.metric === 'accounts')!
    expect(acc.value).toBe(710000)
    expect(acc.evidence).toBe('founder_reported')
    expect(mention.identity.name).toBeTruthy()
  })
  it('Product Hunt feed parses entries', () => {
    const items = parseFeed(fx('producthunt-feed.xml'))
    expect(items.length).toBeGreaterThan(10)
    expect(items[0].link).toMatch(/producthunt\.com\/products\//)
  })
  it('Show HN titles', () => {
    expect(parseShowHnTitle('Show HN: Maptools – Search your Google Maps saved places')).toEqual({ name: 'Maptools', tagline: 'Search your Google Maps saved places' })
  })
  it('categorizes', () => {
    expect(categorize('AI that reads your group chat and roasts your friends').tags).toContain('Consumer AI')
  })
})

describe('robots', () => {
  it('honors longest-match allow/disallow', () => {
    const r = parseRobots('User-agent: *\nAllow: /\nDisallow: /api/\n\nUser-agent: ClaudeBot\nDisallow: /')
    expect(robotsAllows(r, '/s/foo/')).toBe(true)
    expect(robotsAllows(r, '/api/x')).toBe(false)
  })
})

describe('pipeline', () => {
  const qm = () => parseQuietMoneyPage(fx('quietmoney-whatbrandonthinks.html'), 'https://quietmoney.000ooo.ooo/s/whatbrandonthinks.com/')!
  const cf = () => parseCashflowingPage(fx('cashflowing-whatbrandonthinks.html'), 'https://cashflowing.app/en/sites/whatbrandonthinks.com', 'whatbrandonthinks.com')!
  const site = () => parseWebsite(fx('whatbrandonthinks-home.html'), 'https://www.whatbrandonthinks.com/', [{ url: 'https://www.whatbrandonthinks.com/about', text: htmlToText(fx('whatbrandonthinks-about.html')) }]).mention

  it('consolidates three sources into one canonical profile, keeping evidence classes', async () => {
    const s = store()
    const deps = { store: s, now: fixedNow }
    const a = await ingestMention(deps, qm())
    const b = await ingestMention(deps, cf())
    const c = await ingestMention(deps, site())
    expect(a.created).toBe(true)
    expect(b.created).toBe(false)
    expect(c.created).toBe(false)
    expect(new Set([a.productId, b.productId, c.productId]).size).toBe(1)
    const p = (await s.getProduct(a.productId))!
    expect(s.data.products).toHaveLength(1)
    expect(p.sourceIds.sort()).toEqual(['cashflowing', 'quietmoney', 'website'])
    expect(p.summaryMetrics.accounts?.evidence).toBe('founder_reported')
    expect(p.summaryMetrics.checkout_visits_monthly?.evidence).toBe('third_party_estimate')
    expect(p.summaryMetrics.mrr).toBeUndefined() // never invented
    expect(p.stage).toBe('established')
    expect(s.data.events.some((e) => e.type === 'new_source')).toBe(true)
  })

  it('is idempotent: re-ingesting the same mentions creates nothing', async () => {
    const s = store()
    const deps = { store: s, now: fixedNow }
    for (const m of [qm(), cf(), site()]) await ingestMention(deps, m)
    const before = { o: s.data.observations.length, e: s.data.events.length, m: s.data.mentions.length, p: s.data.products.length }
    for (const m of [qm(), cf(), site()]) {
      const r = await ingestMention(deps, m)
      expect(r.observationsNew).toBe(0)
    }
    expect({ o: s.data.observations.length, e: s.data.events.length, m: s.data.mentions.length, p: s.data.products.length }).toEqual(before)
  })

  it('never merges on name alone; flags a merge candidate instead', async () => {
    const s = store()
    const deps = { store: s, now: fixedNow }
    const base: RawMention = { sourceId: 'producthunt_feed', externalId: 'ph1', url: 'https://www.producthunt.com/products/acme', identity: { name: 'Acme', aliases: [{ kind: 'ph_slug', value: 'acme' }] }, metrics: [] }
    const other: RawMention = { sourceId: 'hn_show', externalId: 'hn1', url: 'https://news.ycombinator.com/item?id=1', identity: { name: 'Acme', websiteUrl: 'https://acme.dev', aliases: [] }, metrics: [] }
    const a = await ingestMention(deps, base)
    const b = await ingestMention(deps, other)
    expect(a.productId).not.toBe(b.productId)
    expect(s.data.mergeCandidates).toHaveLength(1)
    // different domains with the same name → separate, no candidate
    const c = await ingestMention(deps, { ...other, externalId: 'hn2', identity: { name: 'Acme', websiteUrl: 'https://acme.io', aliases: [] } })
    const pairs = s.data.mergeCandidates.map((m) => [m.productA, m.productB].sort().join())
    expect(pairs).not.toContain([b.productId, c.productId].sort().join())
    expect(pairs).toContain([a.productId, c.productId].sort().join())
  })

  it('detects significant metric changes as events', async () => {
    const s = store()
    const deps = { store: s, now: fixedNow }
    const mk = (v: number, label: string, asOf: string): RawMention => ({
      sourceId: 'trustmrr', externalId: 'x', url: 'https://trustmrr.com/startup/x', identity: { name: 'X', websiteUrl: 'https://x.com', aliases: [] },
      metrics: [{ metric: 'mrr', value: v, unit: 'USD', evidence: 'verified', confidence: 'high', periodLabel: label, asOf }],
    })
    await ingestMention(deps, mk(8000, 'Current', '2026-10-01'))
    const r = await ingestMention(deps, mk(12000, 'Current', '2026-11-01'))
    expect(r.events.map((e) => e.type)).toContain('revenue_milestone')
  })

  it('card metrics prefer revenue, then users, then traffic', async () => {
    const s = store()
    const deps = { store: s, now: fixedNow }
    const r = await ingestMention(deps, site())
    await ingestMention(deps, qm())
    const p = (await s.getProduct(r.productId))!
    expect(pickCardMetrics(p.summaryMetrics).map((m) => m.metric).slice(0, 2)).toEqual(['accounts', 'checkout_visits_monthly'])
  })
})

describe('scoring', () => {
  it('reports insufficient evidence instead of false precision', () => {
    const s = computeOpportunityScore({ product: { category: 'Other', platforms: ['Web'], tags: [], businessModel: null, pricingSummary: null, sourceIds: ['hn_show'], launchDate: null, firstDiscoveredAt: '2026-11-19' }, summary: {} })
    expect(s.sufficient).toBe(false)
  })
})

describe('AI grounding', () => {
  it('drops facts whose quote is not in the source or whose value mismatches', () => {
    const text = 'We now have 1,200 paying customers and $8k MRR.'
    const out = groundFacts(text, [
      { metric: 'customers', value: 1200, period_label: null, quote: '1,200 paying customers' },
      { metric: 'mrr', value: 80000, period_label: null, quote: '$8k MRR' },
      { metric: 'arr', value: 96000, period_label: null, quote: '$96k ARR' },
    ], 'founder_reported')
    expect(out.map((o) => o.metric)).toEqual(['customers'])
  })
})
