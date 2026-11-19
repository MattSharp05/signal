// Store implementation over Supabase (service role). Used by Edge Functions and the Node CLI.
import type { SupabaseClient } from '@supabase/supabase-js'
import { slugify } from './normalize.ts'
import { hashString, uuid } from './store.ts'
import type { NewProduct, NotificationRow, Store, Tracker } from './store.ts'
import type {
  Advertisement, Alias, IngestionJob, MergeCandidate, MetricObservation, Product, ProductEvent, ProductRelationship, ResearchReport, SourceMention, SourceRecord,
} from './types.ts'

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

/** Shallow key conversion: nested JSON (summaryMetrics, config, …) is stored as jsonb untouched. */
export function toRow<T extends object>(o: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[snake(k)] = v
  return out
}
export function fromRow<T>(r: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(r)) out[camel(k)] = v
  return out as T
}

// Postgres `date` columns
const toDate = (s: string | null) => (s ? s.slice(0, 10) : null)

export class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}

  private async q<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await p
    if (error) throw new Error(error.message)
    return data as T
  }

  async findProductsByAliases(aliases: Alias[]) {
    if (!aliases.length) return []
    const out: { alias: Alias; productId: string }[] = []
    const kinds = [...new Set(aliases.map((a) => a.kind))]
    for (const kind of kinds) {
      const values = aliases.filter((a) => a.kind === kind).map((a) => a.value.toLowerCase())
      const rows = await this.q<{ product_id: string; kind: Alias['kind']; value: string; products: { status: string; merged_into: string | null } | null }[]>(
        this.db.from('product_aliases').select('product_id, kind, value, products(status, merged_into)').eq('kind', kind).in('value', values),
      )
      for (const r of rows) {
        const id = r.products?.status === 'merged' && r.products.merged_into ? r.products.merged_into : r.product_id
        out.push({ alias: { kind: r.kind, value: r.value }, productId: id })
      }
    }
    return out
  }

  async getProduct(id: string) {
    const r = await this.q<Record<string, unknown> | null>(this.db.from('products').select('*').eq('id', id).maybeSingle())
    return r ? this.product(r) : null
  }

  async getProductBySlug(slug: string) {
    const r = await this.q<Record<string, unknown> | null>(this.db.from('products').select('*').eq('slug', slug).maybeSingle())
    return r ? this.product(r) : null
  }

  private product(r: Record<string, unknown>): Product {
    const { search: _s, ...rest } = r
    void _s
    return fromRow<Product>(rest)
  }

  async createProduct(p: NewProduct): Promise<Product> {
    const base = p.slug ?? slugify(p.name)
    for (let i = 0; i < 4; i++) {
      const slug = i === 0 ? base : `${base}-${hashString(uuid()).slice(0, 5)}`
      const { data, error } = await this.db.from('products').insert(toRow({ ...p, slug, launchDate: p.launchDate })).select('*').single()
      if (!error) return this.product(data)
      if (!/duplicate key.*slug/i.test(error.message)) throw new Error(error.message)
    }
    throw new Error('Could not allocate a unique slug')
  }

  async updateProduct(id: string, patch: Partial<Product>) {
    const { id: _i, slug: _s, ...rest } = patch
    void _i
    void _s
    if (!Object.keys(rest).length) return
    await this.q(this.db.from('products').update(toRow(rest)).eq('id', id))
  }

  async addAliases(productId: string, aliases: Alias[]) {
    for (const a of aliases) {
      // unique partial indexes make conflicting strong aliases a no-op
      const { error } = await this.db.from('product_aliases').insert({ product_id: productId, kind: a.kind, value: a.value.toLowerCase() })
      if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message)
    }
  }

  async listAliases(productId: string) {
    return this.q<Alias[]>(this.db.from('product_aliases').select('kind, value').eq('product_id', productId))
  }

  async listProductsByCategory(category: string, limit: number) {
    const rows = await this.q<Record<string, unknown>[]>(this.db.from('products').select('*').eq('category', category).eq('status', 'active').limit(limit))
    return rows.map((r) => this.product(r))
  }

  async upsertMention(m: Omit<SourceMention, 'id'>) {
    const existing = await this.q<Record<string, unknown> | null>(
      this.db.from('source_mentions').select('*').eq('source_id', m.sourceId).eq('external_id', m.externalId).maybeSingle(),
    )
    if (existing) {
      const ex = fromRow<SourceMention>(existing)
      const changed = ex.contentHash !== m.contentHash
      if (changed) {
        await this.q(this.db.from('source_mentions').update(toRow({ url: m.url, title: m.title, excerpt: m.excerpt, author: m.author, publishedAt: m.publishedAt, collectedAt: m.collectedAt, contentHash: m.contentHash })).eq('id', ex.id))
      }
      return { mention: { ...ex, ...(changed ? { contentHash: m.contentHash, collectedAt: m.collectedAt } : {}) }, isNew: false, changed }
    }
    const row = await this.q<Record<string, unknown>>(this.db.from('source_mentions').insert(toRow(m)).select('*').single())
    return { mention: fromRow<SourceMention>(row), isNew: true, changed: true }
  }

  async mentionCollectedAt(sourceId: string, externalId: string) {
    const r = await this.q<{ collected_at: string } | null>(
      this.db.from('source_mentions').select('collected_at').eq('source_id', sourceId).eq('external_id', externalId).maybeSingle(),
    )
    return r?.collected_at ?? null
  }

  async listMentions(productId: string) {
    const rows = await this.q<Record<string, unknown>[]>(this.db.from('source_mentions').select('*').eq('product_id', productId))
    return rows.map((r) => fromRow<SourceMention>(r))
  }

  async insertObservations(obs: Omit<MetricObservation, 'id'>[]) {
    if (!obs.length) return []
    const rows = obs.map((o) => toRow({ ...o, periodStart: toDate(o.periodStart), periodEnd: toDate(o.periodEnd) }))
    const data = await this.q<Record<string, unknown>[]>(
      this.db.from('metric_observations').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('*'),
    )
    return data.map((r) => fromRow<MetricObservation>(r))
  }

  async listObservations(productId: string) {
    const rows = await this.q<Record<string, unknown>[]>(this.db.from('metric_observations').select('*').eq('product_id', productId))
    return rows.map((r) => fromRow<MetricObservation>(r))
  }

  async insertEvents(events: Omit<ProductEvent, 'id'>[]) {
    if (!events.length) return []
    const data = await this.q<Record<string, unknown>[]>(
      this.db.from('product_events').upsert(events.map((e) => toRow(e)), { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('*'),
    )
    return data.map((r) => fromRow<ProductEvent>(r))
  }

  async listEvents(productId: string) {
    const rows = await this.q<Record<string, unknown>[]>(this.db.from('product_events').select('*').eq('product_id', productId))
    return rows.map((r) => fromRow<ProductEvent>(r))
  }

  async upsertRelationships(rels: Omit<ProductRelationship, 'id'>[]) {
    if (!rels.length) return
    await this.q(this.db.from('product_relationships').upsert(rels.map((r) => toRow(r)), { onConflict: 'product_id,kind,related_name', ignoreDuplicates: true }))
  }

  async listRelationships(productId: string) {
    const rows = await this.q<Record<string, unknown>[]>(this.db.from('product_relationships').select('*').eq('product_id', productId))
    return rows.map((r) => fromRow<ProductRelationship>(r))
  }

  async upsertAds(ads: Omit<Advertisement, 'id'>[]) {
    const out: { ad: Advertisement; isNew: boolean }[] = []
    for (const a of ads) {
      const ex = await this.q<Record<string, unknown> | null>(this.db.from('advertisements').select('*').eq('source_id', a.sourceId).eq('external_id', a.externalId).maybeSingle())
      if (ex) {
        const row = await this.q<Record<string, unknown>>(this.db.from('advertisements').update({ last_observed: a.lastObserved, is_active: a.isActive }).eq('id', ex.id as string).select('*').single())
        await this.db.from('advertisement_observations').insert({ advertisement_id: ex.id, is_active: a.isActive })
        out.push({ ad: fromRow<Advertisement>(row), isNew: false })
      } else {
        const row = await this.q<Record<string, unknown>>(this.db.from('advertisements').insert(toRow(a)).select('*').single())
        await this.db.from('advertisement_observations').insert({ advertisement_id: row.id, is_active: a.isActive })
        out.push({ ad: fromRow<Advertisement>(row), isNew: true })
      }
    }
    return out
  }

  async addMergeCandidate(c: Omit<MergeCandidate, 'id' | 'createdAt' | 'status'>) {
    const { error } = await this.db.from('merge_candidates').insert({ product_a: c.productA, product_b: c.productB, reason: c.reason, score: c.score })
    if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message)
  }

  async saveReport(r: Omit<ResearchReport, 'id'>) {
    const row = await this.q<Record<string, unknown>>(this.db.from('research_reports').insert(toRow(r)).select('*').single())
    return fromRow<ResearchReport>(row)
  }

  async latestReport(productId: string) {
    const r = await this.q<Record<string, unknown> | null>(
      this.db.from('research_reports').select('*').eq('product_id', productId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    )
    return r ? fromRow<ResearchReport>(r) : null
  }

  async getSource(id: string) {
    const r = await this.q<Record<string, unknown> | null>(this.db.from('sources').select('*').eq('id', id).maybeSingle())
    return r ? fromRow<SourceRecord>(r) : null
  }

  async listSources() {
    const rows = await this.q<Record<string, unknown>[]>(this.db.from('sources').select('*'))
    return rows.map((r) => fromRow<SourceRecord>(r))
  }

  async updateSource(id: string, patch: Partial<SourceRecord>) {
    await this.q(this.db.from('sources').update(toRow(patch)).eq('id', id))
  }

  async upsertSources(rows: SourceRecord[]) {
    await this.q(this.db.from('sources').upsert(rows.map((r) => toRow(r)), { onConflict: 'id', ignoreDuplicates: true }))
  }

  async createJob(job: Omit<IngestionJob, 'id'>) {
    const row = await this.q<Record<string, unknown>>(this.db.from('ingestion_jobs').insert(toRow(job)).select('*').single())
    return fromRow<IngestionJob>(row)
  }

  async updateJob(id: string, patch: Partial<IngestionJob>) {
    await this.q(this.db.from('ingestion_jobs').update(toRow(patch)).eq('id', id))
  }

  async listTrackers(productId: string): Promise<Tracker[]> {
    const rows = await this.q<{ user_id: string; min_significance: number }[]>(this.db.from('tracked_products').select('user_id, min_significance').eq('product_id', productId))
    return rows.map((r) => ({ userId: r.user_id, minSignificance: r.min_significance }))
  }

  async insertNotifications(rows: Omit<NotificationRow, 'id' | 'createdAt' | 'readAt'>[]) {
    if (!rows.length) return 0
    const data = await this.q<unknown[]>(
      this.db.from('notifications').upsert(rows.map((r) => toRow(r)), { onConflict: 'user_id,event_id', ignoreDuplicates: true }).select('id'),
    )
    return data.length
  }
}
