import { describe, expect, it } from 'vitest'
import { MemoryStore, emptyData } from '@core/memory-store.ts'
import { defaultSourceRecords } from '@core/connectors/index.ts'
import { ingestMention } from '@core/pipeline.ts'
import type { RawMention } from '@core/types.ts'
import { filterProducts } from './feed'

const user = { saved: [], tracked: [], collections: [], collectionProducts: [] }

function mention(id: string, name: string, domain: string, mrr?: number): RawMention {
  return {
    sourceId: 'trustmrr', externalId: id, url: `https://trustmrr.com/startup/${id}`,
    identity: { name, websiteUrl: `https://${domain}`, aliases: [], category: 'AI Utility', tags: ['AI'] },
    metrics: mrr ? [{ metric: 'mrr', value: mrr, unit: 'USD', evidence: 'verified', confidence: 'high', periodLabel: 'Current', asOf: '2026-11-01' }] : [],
  }
}

describe('feed filtering and tracking', () => {
  it('filters by revenue, search and sorts by revenue', async () => {
    const s = new MemoryStore(emptyData(defaultSourceRecords()))
    await ingestMention({ store: s }, mention('a', 'Alpha', 'alpha.com', 2000))
    await ingestMention({ store: s }, mention('b', 'Beta', 'beta.com', 9000))
    await ingestMention({ store: s }, mention('c', 'Gamma', 'gamma.com'))
    const byRev = filterProducts(s.data.products, { sort: 'revenue', hasRevenue: true }, user)
    expect(byRev.map((p) => p.name)).toEqual(['Beta', 'Alpha'])
    expect(filterProducts(s.data.products, { sort: 'discovered', q: 'gam' }, user).map((p) => p.name)).toEqual(['Gamma'])
    expect(filterProducts(s.data.products, { sort: 'discovered', evidence: 'verified' }, user)).toHaveLength(2)
  })

  it('notifies trackers only above their threshold, once per event', async () => {
    const s = new MemoryStore(emptyData(defaultSourceRecords()))
    const r = await ingestMention({ store: s }, mention('a', 'Alpha', 'alpha.com', 8000))
    s.data.user.tracked.push({ productId: r.productId, minSignificance: 50, createdAt: '' })
    const m2 = mention('a', 'Alpha', 'alpha.com', 12000)
    m2.metrics[0].asOf = '2026-11-15'
    await ingestMention({ store: s }, m2)
    await ingestMention({ store: s }, m2)
    expect(s.data.notifications).toHaveLength(1)
    const ev = s.data.events.find((e) => e.id === s.data.notifications[0].eventId)!
    expect(ev.type).toBe('revenue_milestone')
  })
})
