import { CONNECTORS, defaultSourceRecords } from '@core/connectors/index.ts'
import { Http } from '@core/http.ts'
import { LOCAL_USER_ID, MemoryStore, emptyData, emptyUserData, type MemoryData, type OpportunityRow } from '@core/memory-store.ts'
import { addProductByUrl, generateReport, recomputeProduct, runSource } from '@core/pipeline.ts'
import { uuid } from '@core/store.ts'
import type { IngestionJob } from '@core/types.ts'
import { del, get, set } from 'idb-keyval'
import { filterProducts } from './feed'
import type { DataMeta, FeedFilters, ManualAdInput, Note, ProductDetail, Repository, Settings, UpdateItem, UserState } from './repository'

const KEY = 'signal-data-v1'

/**
 * Browser-only repository. Persists to IndexedDB, seeded from the labeled pipeline snapshot.
 * Runs the same core pipeline in the browser for connectors that allow cross-origin calls (HN, GitHub).
 */
export class LocalRepository implements Repository {
  private store!: MemoryStore
  private ready: Promise<void>
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.ready = this.load()
  }

  private async load() {
    let data: MemoryData | undefined
    try {
      data = await get<MemoryData>(KEY)
    } catch {
      data = undefined
    }
    if (!data) {
      try {
        const snap = (await import('../fixtures/snapshot.json')).default as unknown as MemoryData
        data = structuredClone(snap)
      } catch {
        data = emptyData(defaultSourceRecords())
      }
    }
    // keep source catalog in sync with the code (new connectors, updated notes) while preserving local state
    const defaults = defaultSourceRecords()
    for (const d of defaults) {
      const cur = data.sources.find((s) => s.id === d.id)
      if (!cur) data.sources.push(d)
      else Object.assign(cur, { name: d.name, notes: d.notes, runsIn: d.runsIn, docsUrl: d.docsUrl, credentialEnv: d.credentialEnv, kind: d.kind, role: d.role })
    }
    data.user ??= emptyUserData()
    this.store = new MemoryStore(data)
  }

  private get d() {
    return this.store.data
  }

  private persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      set(KEY, this.d).catch(() => {})
    }, 250)
  }

  private deps() {
    return {
      store: this.store,
      http: new Http({ browser: true, perHostDelayMs: 300 }),
      runtime: 'browser' as const,
      weights: this.d.user.settings.weights,
    }
  }

  async meta(): Promise<DataMeta> {
    await this.ready
    return { mode: 'local', snapshotCollectedAt: this.d.meta.snapshotCollectedAt, origin: this.d.meta.origin, aiConfigured: false }
  }

  async listFeed(filters: FeedFilters, offset: number, limit: number, user: UserState) {
    await this.ready
    const all = filterProducts(this.d.products, filters, user)
    const items = all.slice(offset, offset + limit)
    return { items, nextOffset: offset + limit < all.length ? offset + limit : null, total: all.length }
  }

  async getProduct(slugOrId: string): Promise<ProductDetail | null> {
    await this.ready
    let product = this.d.products.find((p) => p.slug === slugOrId || p.id === slugOrId)
    if (!product) return null
    if (product.status === 'merged' && product.mergedInto) product = this.d.products.find((p) => p.id === product!.mergedInto) ?? product
    const id = product.id
    const relationships = this.d.relationships.filter((r) => r.productId === id)
    for (const r of relationships) {
      if (!r.relatedProductId) {
        const hit = this.d.products.find((p) => p.status === 'active' && p.name.toLowerCase() === r.relatedName.toLowerCase())
        if (hit) r.relatedProductId = hit.id
      }
    }
    const similar = this.d.products
      .filter((p) => p.id !== id && p.status === 'active' && p.category && p.category === product!.category)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 6)
    return {
      product,
      mentions: this.d.mentions.filter((m) => m.productId === id),
      observations: this.d.observations.filter((o) => o.productId === id),
      events: this.d.events.filter((e) => e.productId === id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
      relationships,
      similar,
      ads: this.d.ads.filter((a) => a.productId === id),
      report: await this.store.latestReport(id),
    }
  }

  async productsByIds(ids: string[]) {
    await this.ready
    const set = new Set(ids)
    return this.d.products.filter((p) => set.has(p.id))
  }

  async allProductsLite() {
    await this.ready
    return this.d.products.filter((p) => p.status === 'active')
  }

  async recentEvents(limit: number) {
    await this.ready
    const byId = new Map(this.d.products.map((p) => [p.id, p]))
    return [...this.d.events]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit)
      .flatMap((e) => {
        const p = byId.get(e.productId)
        return p ? [{ ...e, product: { id: p.id, slug: p.slug, name: p.name, logoUrl: p.logoUrl } }] : []
      })
  }

  async userState(): Promise<UserState> {
    await this.ready
    const u = this.d.user
    return { saved: [...u.saved], tracked: [...u.tracked], collections: [...u.collections], collectionProducts: [...u.collectionProducts] }
  }

  async setSaved(productId: string, saved: boolean, opts: { collectionId?: string | null; note?: string | null } = {}) {
    await this.ready
    const u = this.d.user
    u.saved = u.saved.filter((s) => s.productId !== productId)
    if (saved) u.saved.unshift({ productId, collectionId: opts.collectionId ?? null, note: opts.note ?? null, createdAt: new Date().toISOString() })
    else u.collectionProducts = u.collectionProducts.filter((c) => c.productId !== productId)
    this.persist()
  }

  async setTracked(productId: string, tracked: boolean, minSignificance?: number) {
    await this.ready
    const u = this.d.user
    u.tracked = u.tracked.filter((s) => s.productId !== productId)
    if (tracked) u.tracked.unshift({ productId, minSignificance: minSignificance ?? u.settings.defaultMinSignificance, createdAt: new Date().toISOString() })
    this.persist()
  }

  async createCollection(name: string) {
    await this.ready
    const c = { id: uuid(), name, createdAt: new Date().toISOString() }
    this.d.user.collections.push(c)
    this.persist()
    return c
  }

  async deleteCollection(id: string) {
    await this.ready
    const u = this.d.user
    u.collections = u.collections.filter((c) => c.id !== id)
    u.collectionProducts = u.collectionProducts.filter((c) => c.collectionId !== id)
    this.persist()
  }

  async addToCollection(collectionId: string, productId: string) {
    await this.ready
    const u = this.d.user
    if (!u.collectionProducts.some((c) => c.collectionId === collectionId && c.productId === productId)) u.collectionProducts.push({ collectionId, productId })
    if (!u.saved.some((s) => s.productId === productId)) u.saved.unshift({ productId, collectionId, note: null, createdAt: new Date().toISOString() })
    this.persist()
  }

  async removeFromCollection(collectionId: string, productId: string) {
    await this.ready
    this.d.user.collectionProducts = this.d.user.collectionProducts.filter((c) => !(c.collectionId === collectionId && c.productId === productId))
    this.persist()
  }

  async listNotes(productId: string): Promise<Note[]> {
    await this.ready
    return this.d.user.notes.filter((n) => n.productId === productId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async addNote(productId: string, body: string, kind: Note['kind']) {
    await this.ready
    const now = new Date().toISOString()
    this.d.user.notes.push({ id: uuid(), productId, body, kind, createdAt: now, updatedAt: now })
    this.persist()
  }

  async deleteNote(id: string) {
    await this.ready
    this.d.user.notes = this.d.user.notes.filter((n) => n.id !== id)
    this.persist()
  }

  async listOpportunities() {
    await this.ready
    return [...this.d.user.opportunities].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async saveOpportunity(o: Partial<OpportunityRow> & { title: string }) {
    await this.ready
    const now = new Date().toISOString()
    const list = this.d.user.opportunities
    const existing = o.id ? list.find((x) => x.id === o.id) : undefined
    if (existing) {
      Object.assign(existing, o, { updatedAt: now })
      this.persist()
      return existing
    }
    const row: OpportunityRow = {
      id: uuid(), title: o.title, description: o.description ?? '', productIds: o.productIds ?? [], targetAudience: o.targetAudience ?? '',
      monetization: o.monetization ?? '', distribution: o.distribution ?? '', competitors: o.competitors ?? '', feasibility: o.feasibility ?? '',
      mvpComplexity: o.mvpComplexity ?? '', notes: o.notes ?? '', status: o.status ?? 'idea', createdAt: now, updatedAt: now,
    }
    list.unshift(row)
    this.persist()
    return row
  }

  async deleteOpportunity(id: string) {
    await this.ready
    this.d.user.opportunities = this.d.user.opportunities.filter((o) => o.id !== id)
    this.persist()
  }

  async listUpdates(): Promise<UpdateItem[]> {
    await this.ready
    const events = new Map(this.d.events.map((e) => [e.id, e]))
    const products = new Map(this.d.products.map((p) => [p.id, p]))
    return this.d.notifications
      .filter((n) => n.userId === LOCAL_USER_ID)
      .flatMap((n) => {
        const e = events.get(n.eventId)
        const p = products.get(n.productId)
        if (!e || !p) return []
        return [{ id: n.id, event: e, product: { id: p.id, slug: p.slug, name: p.name, logoUrl: p.logoUrl, domain: p.domain }, read: !!n.readAt, createdAt: n.createdAt }]
      })
  }

  async markUpdatesRead(ids: string[]) {
    await this.ready
    const s = new Set(ids)
    for (const n of this.d.notifications) if (s.has(n.id)) n.readAt = new Date().toISOString()
    this.persist()
  }

  async listSources() {
    await this.ready
    return [...this.d.sources]
  }

  async updateSource(id: string, patch: { enabled?: boolean; refreshMinutes?: number }) {
    await this.ready
    await this.store.updateSource(id, patch)
    this.persist()
  }

  async runSource(id: string): Promise<IngestionJob> {
    await this.ready
    const conn = CONNECTORS.find((c) => c.id === id)
    if (conn && !conn.runsIn.includes('browser')) {
      throw new Error(`${conn.name} runs server-side only (cross-origin restrictions and robots.txt checks). Connect Supabase to run it on a schedule.`)
    }
    const job = await runSource(this.deps(), id, { trigger: 'manual', budget: 15, enrichNew: 0 })
    this.persist()
    return job
  }

  async addRssSource() {
    throw new Error('Custom RSS feeds are fetched server-side (most feeds block cross-origin requests). Connect Supabase to add sources.')
  }

  async listJobs(limit: number) {
    await this.ready
    return this.d.jobs.slice(0, limit)
  }

  async listMergeCandidates() {
    await this.ready
    const byId = new Map(this.d.products.map((p) => [p.id, p]))
    return this.d.mergeCandidates.filter((c) => c.status === 'open').map((c) => ({ ...c, a: byId.get(c.productA) ?? null, b: byId.get(c.productB) ?? null }))
  }

  async mergeProducts(survivorId: string, loserId: string, candidateId: string) {
    await this.ready
    const d = this.d
    const survivorAliases = new Set(d.aliases.filter((a) => a.productId === survivorId).map((a) => `${a.kind}:${a.value}`))
    d.aliases = d.aliases.filter((a) => a.productId !== loserId || !survivorAliases.has(`${a.kind}:${a.value}`))
    for (const a of d.aliases) if (a.productId === loserId) a.productId = survivorId
    for (const list of [d.mentions, d.observations, d.events, d.relationships, d.ads] as { productId: string }[][]) for (const x of list) if (x.productId === loserId) x.productId = survivorId
    for (const n of d.user.notes) if (n.productId === loserId) n.productId = survivorId
    for (const s of d.user.saved) if (s.productId === loserId) s.productId = survivorId
    for (const t of d.user.tracked) if (t.productId === loserId) t.productId = survivorId
    for (const o of d.user.opportunities) o.productIds = [...new Set(o.productIds.map((x) => (x === loserId ? survivorId : x)))]
    const loser = d.products.find((p) => p.id === loserId)
    if (loser) Object.assign(loser, { status: 'merged', mergedInto: survivorId })
    for (const c of d.mergeCandidates) if (c.id === candidateId || ([c.productA, c.productB].includes(survivorId) && [c.productA, c.productB].includes(loserId))) c.status = 'merged'
    await this.store.insertEvents([{ productId: survivorId, type: 'merged', title: 'Merged duplicate profile', detail: loser?.name ?? null, significance: 20, occurredAt: new Date().toISOString(), sourceId: null, mentionId: null, observationId: null, dedupeKey: `merge:${loserId}` }])
    await recomputeProduct(this.deps(), survivorId)
    this.persist()
  }

  async dismissMergeCandidate(id: string) {
    await this.ready
    const c = this.d.mergeCandidates.find((x) => x.id === id)
    if (c) c.status = 'dismissed'
    this.persist()
  }

  async addProduct(url: string) {
    await this.ready
    const r = await addProductByUrl(this.deps(), url)
    const p = await this.store.getProduct(r.productId)
    this.persist()
    const warnings = [...r.errors]
    if (r.created) warnings.push('Local mode cannot crawl websites (browser cross-origin limits). The profile was created from the URL only; connect Supabase for full enrichment.')
    return { slug: p!.slug, created: r.created, warnings }
  }

  async generateReport(productId: string) {
    await this.ready
    const r = await generateReport(this.deps(), productId, 'deep')
    this.persist()
    return r
  }

  async addManualAd(productId: string, ad: ManualAdInput) {
    await this.ready
    const now = new Date().toISOString()
    await this.store.upsertAds([{ productId, sourceId: 'manual', externalId: uuid(), ...ad, mediaType: ad.mediaUrl ? 'image' : 'unknown', lastObserved: now, firstObserved: ad.firstObserved ?? now, isActive: null, analysis: null, manual: true }])
    this.persist()
  }

  async analyzeAd() {
    throw new Error('AI creative analysis runs server-side and needs ANTHROPIC_API_KEY.')
  }

  async getSettings(): Promise<Settings> {
    await this.ready
    return structuredClone(this.d.user.settings)
  }

  async saveSettings(s: Settings) {
    await this.ready
    this.d.user.settings = structuredClone(s)
    for (const p of this.d.products) await recomputeProduct(this.deps(), p.id)
    this.persist()
  }

  async resetLocalData() {
    await del(KEY)
    this.ready = this.load()
    await this.ready
  }
}
