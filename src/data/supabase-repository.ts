import type { OpportunityRow } from '@core/memory-store.ts'
import { fromRow, toRow } from '@core/supabase-store.ts'
import type { Advertisement, IngestionJob, MergeCandidate, MetricObservation, Product, ProductEvent, ProductRelationship, ResearchReport, SourceMention, SourceRecord } from '@core/types.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DataMeta, FeedFilters, FeedPage, ManualAdInput, Note, ProductDetail, Repository, Settings, UpdateItem, UserState } from './repository'

const PRODUCT_COLS =
  'id,slug,name,domain,website_url,company_id,company_name,tagline,description,category,tags,platforms,business_model,pricing_summary,launch_date,logo_url,stage,status,merged_into,relevance_score,monthly_revenue,revenue_evidence,growth_pct,evidence_level,opportunity_score,summary_metrics,source_ids,source_count,first_discovered_at,last_updated_at,last_significant_at,data_origin'

type Row = Record<string, unknown>

export class SupabaseRepository implements Repository {
  constructor(private db: SupabaseClient) {}

  private async q<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await p
    if (error) throw new Error(error.message)
    return data as T
  }

  private async uid(): Promise<string> {
    const { data } = await this.db.auth.getUser()
    if (!data.user) throw new Error('Not signed in')
    return data.user.id
  }

  private p = (r: Row) => fromRow<Product>(r)

  async meta(): Promise<DataMeta> {
    return { mode: 'supabase', snapshotCollectedAt: null, origin: 'live', aiConfigured: null }
  }

  async listFeed(f: FeedFilters, offset: number, limit: number, user: UserState): Promise<FeedPage> {
    let q = this.db.from('products').select(PRODUCT_COLS, { count: 'estimated' }).eq('status', 'active')
    if (f.q?.trim()) {
      const s = f.q.trim().replace(/[%,()*]/g, ' ')
      q = q.or(`name.ilike.*${s}*,domain.ilike.*${s}*,company_name.ilike.*${s}*,tagline.ilike.*${s}*,description.ilike.*${s}*,category.ilike.*${s}*,business_model.ilike.*${s}*,tags.cs.{${s}}`)
    }
    if (f.category) q = q.eq('category', f.category)
    if (f.platform) q = q.contains('platforms', [f.platform])
    if (f.stage) q = q.eq('stage', f.stage)
    if (f.source) q = q.contains('source_ids', [f.source])
    if (f.quick === 'new') q = q.or(`stage.eq.new_launch,launch_date.gte.${new Date(Date.now() - 14 * 86400_000).toISOString()}`)
    if (f.quick === 'trending') q = q.gte('relevance_score', 35)
    if (f.quick === 'revenue' || f.hasRevenue) q = q.not('monthly_revenue', 'is', null)
    if (f.revenueMin != null) q = q.gte('monthly_revenue', f.revenueMin)
    if (f.revenueMax != null) q = q.lte('monthly_revenue', f.revenueMax)
    if (f.growthMin != null) q = q.gte('growth_pct', f.growthMin)
    if (f.businessModel) q = q.ilike('business_model', `%${f.businessModel}%`)
    if (f.maxAgeDays) q = q.gte('first_discovered_at', new Date(Date.now() - f.maxAgeDays * 86400_000).toISOString())
    if (f.evidence === 'verified') q = q.eq('evidence_level', 'verified')
    if (f.evidence === 'founder_or_better') q = q.in('evidence_level', ['verified', 'founder_reported'])
    if (f.evidence === 'any_metric') q = q.not('evidence_level', 'is', null).neq('evidence_level', 'platform_metric')
    if (f.savedOnly) q = q.in('id', user.saved.map((s) => s.productId).concat('00000000-0000-0000-0000-000000000000'))
    if (f.trackedOnly) q = q.in('id', user.tracked.map((s) => s.productId).concat('00000000-0000-0000-0000-000000000000'))
    const order: Record<FeedFilters['sort'], [string, boolean]> = {
      discovered: ['first_discovered_at', false], updated: ['last_updated_at', false], trending: ['relevance_score', false],
      revenue: ['monthly_revenue', false], growth: ['growth_pct', false], sources: ['source_count', false], launched: ['launch_date', false],
    }
    const [col, asc] = order[f.sort]
    q = q.order(col, { ascending: asc, nullsFirst: false }).order('last_updated_at', { ascending: false }).range(offset, offset + limit - 1)
    const { data, error, count } = await q
    if (error) throw new Error(error.message)
    const items = (data as Row[]).map(this.p)
    return { items, nextOffset: items.length === limit ? offset + limit : null, total: count ?? null }
  }

  async getProduct(slugOrId: string): Promise<ProductDetail | null> {
    const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId)
    let row = await this.q<Row | null>(this.db.from('products').select(PRODUCT_COLS).eq(isUuid ? 'id' : 'slug', slugOrId).maybeSingle())
    if (!row) return null
    if (row.status === 'merged' && row.merged_into) row = (await this.q<Row | null>(this.db.from('products').select(PRODUCT_COLS).eq('id', row.merged_into as string).maybeSingle())) ?? row
    const product = this.p(row)
    const id = product.id
    const [mentions, observations, events, relationships, ads, report, similar] = await Promise.all([
      this.q<Row[]>(this.db.from('source_mentions').select('*').eq('product_id', id)),
      this.q<Row[]>(this.db.from('metric_observations').select('*').eq('product_id', id)),
      this.q<Row[]>(this.db.from('product_events').select('*').eq('product_id', id).order('occurred_at', { ascending: false }).limit(200)),
      this.q<Row[]>(this.db.from('product_relationships').select('*').eq('product_id', id)),
      this.q<Row[]>(this.db.from('advertisements').select('*').eq('product_id', id)),
      this.q<Row | null>(this.db.from('research_reports').select('*').eq('product_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()),
      product.category
        ? this.q<Row[]>(this.db.from('products').select(PRODUCT_COLS).eq('status', 'active').eq('category', product.category).neq('id', id).order('relevance_score', { ascending: false }).limit(6))
        : Promise.resolve([] as Row[]),
    ])
    const rels = relationships.map((r) => fromRow<ProductRelationship>(r))
    const unresolved = rels.filter((r) => !r.relatedProductId).map((r) => r.relatedName)
    if (unresolved.length) {
      const hits = await this.q<Row[]>(this.db.from('products').select('id,name').eq('status', 'active').in('name', unresolved))
      for (const r of rels) if (!r.relatedProductId) r.relatedProductId = (hits.find((h) => String(h.name).toLowerCase() === r.relatedName.toLowerCase())?.id as string) ?? null
    }
    return {
      product,
      mentions: mentions.map((r) => fromRow<SourceMention>(r)),
      observations: observations.map((r) => fromRow<MetricObservation>(r)),
      events: events.map((r) => fromRow<ProductEvent>(r)),
      relationships: rels,
      ads: ads.map((r) => fromRow<Advertisement>(r)),
      report: report ? fromRow<ResearchReport>(report) : null,
      similar: similar.map(this.p),
    }
  }

  async productsByIds(ids: string[]) {
    if (!ids.length) return []
    return (await this.q<Row[]>(this.db.from('products').select(PRODUCT_COLS).in('id', ids))).map(this.p)
  }

  async allProductsLite() {
    const rows = await this.q<Row[]>(this.db.from('products').select(PRODUCT_COLS).eq('status', 'active').order('last_updated_at', { ascending: false }).limit(3000))
    return rows.map(this.p)
  }

  async recentEvents(limit: number) {
    const rows = await this.q<Row[]>(this.db.from('product_events').select('*, products(id,slug,name,logo_url)').order('occurred_at', { ascending: false }).limit(limit))
    return rows.map((r) => {
      const { products: p, ...e } = r as Row & { products: Row }
      return { ...fromRow<ProductEvent>(e), product: { id: p.id as string, slug: p.slug as string, name: p.name as string, logoUrl: (p.logo_url as string) ?? null } }
    })
  }

  async userState(): Promise<UserState> {
    const [saved, tracked, collections, cps] = await Promise.all([
      this.q<Row[]>(this.db.from('saved_products').select('product_id,collection_id,note,created_at')),
      this.q<Row[]>(this.db.from('tracked_products').select('product_id,min_significance,created_at')),
      this.q<Row[]>(this.db.from('collections').select('id,name,created_at').order('created_at')),
      this.q<Row[]>(this.db.from('collection_products').select('collection_id,product_id')),
    ])
    return {
      saved: saved.map((r) => fromRow(r)),
      tracked: tracked.map((r) => fromRow(r)),
      collections: collections.map((r) => fromRow(r)),
      collectionProducts: cps.map((r) => fromRow(r)),
    }
  }

  async setSaved(productId: string, saved: boolean, opts: { collectionId?: string | null; note?: string | null } = {}) {
    if (saved) await this.q(this.db.from('saved_products').upsert({ product_id: productId, collection_id: opts.collectionId ?? null, note: opts.note ?? null }))
    else {
      await this.q(this.db.from('saved_products').delete().eq('product_id', productId))
      await this.q(this.db.from('collection_products').delete().eq('product_id', productId))
    }
  }

  async setTracked(productId: string, tracked: boolean, minSignificance = 50) {
    if (tracked) await this.q(this.db.from('tracked_products').upsert({ product_id: productId, min_significance: minSignificance }))
    else await this.q(this.db.from('tracked_products').delete().eq('product_id', productId))
  }

  async createCollection(name: string) {
    const r = await this.q<Row>(this.db.from('collections').insert({ name }).select('id,name,created_at').single())
    return fromRow<{ id: string; name: string; createdAt: string }>(r)
  }
  async deleteCollection(id: string) {
    await this.q(this.db.from('collections').delete().eq('id', id))
  }
  async addToCollection(collectionId: string, productId: string) {
    await this.q(this.db.from('collection_products').upsert({ collection_id: collectionId, product_id: productId }))
    await this.q(this.db.from('saved_products').upsert({ product_id: productId, collection_id: collectionId }, { onConflict: 'user_id,product_id', ignoreDuplicates: true }))
  }
  async removeFromCollection(collectionId: string, productId: string) {
    await this.q(this.db.from('collection_products').delete().eq('collection_id', collectionId).eq('product_id', productId))
  }

  async listNotes(productId: string): Promise<Note[]> {
    return (await this.q<Row[]>(this.db.from('research_notes').select('*').eq('product_id', productId).order('created_at', { ascending: false }))).map((r) => fromRow<Note>(r))
  }
  async addNote(productId: string, body: string, kind: Note['kind']) {
    await this.q(this.db.from('research_notes').insert({ product_id: productId, body, kind }))
  }
  async deleteNote(id: string) {
    await this.q(this.db.from('research_notes').delete().eq('id', id))
  }

  async listOpportunities(): Promise<OpportunityRow[]> {
    const rows = await this.q<Row[]>(this.db.from('opportunities').select('*, opportunity_products(product_id)').order('updated_at', { ascending: false }))
    return rows.map((r) => {
      const { opportunity_products: ops, ...rest } = r as Row & { opportunity_products: { product_id: string }[] }
      return { ...fromRow<OpportunityRow>(rest), productIds: ops.map((o) => o.product_id) }
    })
  }

  async saveOpportunity(o: Partial<OpportunityRow> & { title: string }) {
    const { productIds, id, createdAt: _c, updatedAt: _u, ...fields } = o
    void _c
    void _u
    const row = id
      ? await this.q<Row>(this.db.from('opportunities').update({ ...toRow(fields), updated_at: new Date().toISOString() }).eq('id', id).select('*').single())
      : await this.q<Row>(this.db.from('opportunities').insert(toRow(fields)).select('*').single())
    const oid = row.id as string
    if (productIds) {
      await this.q(this.db.from('opportunity_products').delete().eq('opportunity_id', oid))
      if (productIds.length) await this.q(this.db.from('opportunity_products').insert(productIds.map((p) => ({ opportunity_id: oid, product_id: p }))))
    }
    return { ...fromRow<OpportunityRow>(row), productIds: productIds ?? [] }
  }

  async deleteOpportunity(id: string) {
    await this.q(this.db.from('opportunities').delete().eq('id', id))
  }

  async listUpdates(): Promise<UpdateItem[]> {
    const rows = await this.q<Row[]>(this.db.from('notifications').select('id, created_at, read_at, product_events(*), products(id,slug,name,logo_url,domain)').order('created_at', { ascending: false }).limit(200))
    return rows.map((r) => {
      const p = r.products as Row
      return {
        id: r.id as string, read: !!r.read_at, createdAt: r.created_at as string, event: fromRow<ProductEvent>(r.product_events as Row),
        product: { id: p.id as string, slug: p.slug as string, name: p.name as string, logoUrl: (p.logo_url as string) ?? null, domain: (p.domain as string) ?? null },
      }
    })
  }
  async markUpdatesRead(ids: string[]) {
    if (ids.length) await this.q(this.db.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids))
  }

  async listSources() {
    return (await this.q<Row[]>(this.db.from('sources').select('*').order('name'))).map((r) => fromRow<SourceRecord>(r))
  }
  async updateSource(id: string, patch: { enabled?: boolean; refreshMinutes?: number }) {
    const cur = (await this.listSources()).find((s) => s.id === id)
    if (!cur) throw new Error('Unknown source')
    await this.q(this.db.rpc('update_source_settings', { source: id, is_enabled: patch.enabled ?? cur.enabled, refresh: patch.refreshMinutes ?? cur.refreshMinutes }))
  }
  async runSource(id: string): Promise<IngestionJob> {
    const { data, error } = await this.db.functions.invoke('ingest', { body: { mode: 'source', sourceId: id } })
    if (error) throw new Error(error.message)
    const j = (data as { jobs: { source: string; status: IngestionJob['status']; created: number; mentions: number; error: string | null }[] }).jobs[0]
    const jobs = await this.listJobs(1)
    return jobs[0] ?? ({ sourceId: j.source, status: j.status, productsCreated: j.created, mentionsNew: j.mentions, error: j.error } as IngestionJob)
  }
  async addRssSource(url: string, name: string) {
    await this.q(this.db.rpc('add_rss_source', { feed_url: url, display_name: name }))
  }
  async listJobs(limit: number) {
    return (await this.q<Row[]>(this.db.from('ingestion_jobs').select('*').order('started_at', { ascending: false }).limit(limit))).map((r) => fromRow<IngestionJob>(r))
  }
  async listMergeCandidates() {
    const rows = (await this.q<Row[]>(this.db.from('merge_candidates').select('*').eq('status', 'open').order('score', { ascending: false }).limit(100))).map((r) => fromRow<MergeCandidate>(r))
    const ps = await this.productsByIds([...new Set(rows.flatMap((r) => [r.productA, r.productB]))])
    const by = new Map(ps.map((p) => [p.id, p]))
    return rows.map((r) => ({ ...r, a: by.get(r.productA) ?? null, b: by.get(r.productB) ?? null }))
  }
  async mergeProducts(survivorId: string, loserId: string, candidateId: string) {
    await this.q(this.db.rpc('merge_products', { survivor: survivorId, loser: loserId, candidate: candidateId }))
  }
  async dismissMergeCandidate(id: string) {
    await this.q(this.db.rpc('dismiss_merge_candidate', { candidate: id }))
  }

  async addProduct(url: string) {
    const { data, error } = await this.db.functions.invoke('add-product', { body: { url } })
    if (error) {
      const ctx = (error as { context?: Response }).context
      const msg = ctx ? ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error : null
      throw new Error(msg ?? error.message)
    }
    const d = data as { slug: string; created: boolean; warnings: string[] }
    return { slug: d.slug, created: d.created, warnings: d.warnings ?? [] }
  }
  async generateReport(productId: string) {
    const { data, error } = await this.db.functions.invoke('research', { body: { productId } })
    if (error) throw new Error(error.message)
    return fromRow<ResearchReport>((data as { report: Row }).report)
  }
  async addManualAd(productId: string, ad: ManualAdInput) {
    const uid = await this.uid()
    await this.q(
      this.db.from('advertisements').insert({
        ...toRow(ad), product_id: productId, source_id: 'manual', external_id: crypto.randomUUID(), manual: true, created_by: uid,
        media_type: ad.mediaUrl ? 'image' : 'unknown', first_observed: ad.firstObserved ?? new Date().toISOString(), last_observed: new Date().toISOString(),
      }),
    )
  }
  async analyzeAd(adId: string) {
    const { error } = await this.db.functions.invoke('research', { body: { adId } })
    if (error) throw new Error(error.message)
  }

  async getSettings(): Promise<Settings> {
    const [s, n] = await Promise.all([
      this.q<Row | null>(this.db.from('user_settings').select('weights').maybeSingle()),
      this.q<Row | null>(this.db.from('notification_preferences').select('digest,default_min_significance').maybeSingle()),
    ])
    return {
      weights: (s?.weights as Settings['weights']) ?? { growth: 30, monetization: 30, distribution: 25, feasibility: 15 },
      digest: (n?.digest as Settings['digest']) ?? 'off',
      defaultMinSignificance: (n?.default_min_significance as number) ?? 50,
    }
  }
  async saveSettings(s: Settings) {
    await this.q(this.db.from('user_settings').upsert({ weights: s.weights }))
    await this.q(this.db.from('notification_preferences').upsert({ digest: s.digest, default_min_significance: s.defaultMinSignificance }))
  }
}
