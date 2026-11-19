import { slugify } from './normalize.ts'
import { hashString, uuid } from './store.ts'
import type { NewProduct, NotificationRow, Store, Tracker } from './store.ts'
import type {
  Advertisement,
  Alias,
  IngestionJob,
  MergeCandidate,
  MetricObservation,
  Product,
  ProductEvent,
  ProductRelationship,
  ResearchReport,
  SourceMention,
  SourceRecord,
} from './types.ts'

export interface UserData {
  saved: { productId: string; collectionId: string | null; note: string | null; createdAt: string }[]
  tracked: { productId: string; minSignificance: number; createdAt: string }[]
  collections: { id: string; name: string; createdAt: string }[]
  collectionProducts: { collectionId: string; productId: string }[]
  notes: { id: string; productId: string; body: string; kind: 'observation' | 'conclusion' | 'opportunity'; createdAt: string; updatedAt: string }[]
  opportunities: OpportunityRow[]
  settings: { weights: { growth: number; monetization: number; distribution: number; feasibility: number }; digest: 'off' | 'daily' | 'weekly'; defaultMinSignificance: number }
}

export interface OpportunityRow {
  id: string
  title: string
  description: string
  productIds: string[]
  targetAudience: string
  monetization: string
  distribution: string
  competitors: string
  feasibility: string
  mvpComplexity: 'low' | 'medium' | 'high' | ''
  notes: string
  status: 'idea' | 'researching' | 'validating' | 'planned' | 'building' | 'archived'
  createdAt: string
  updatedAt: string
}

export interface MemoryData {
  version: 1
  meta: { createdAt: string; snapshotCollectedAt: string | null; origin: 'snapshot' | 'empty' }
  products: Product[]
  aliases: { productId: string; kind: Alias['kind']; value: string }[]
  mentions: SourceMention[]
  observations: MetricObservation[]
  events: ProductEvent[]
  relationships: ProductRelationship[]
  ads: Advertisement[]
  mergeCandidates: MergeCandidate[]
  reports: ResearchReport[]
  sources: SourceRecord[]
  jobs: IngestionJob[]
  notifications: NotificationRow[]
  user: UserData
}

export const LOCAL_USER_ID = 'local-user'

export function emptyUserData(): UserData {
  return {
    saved: [],
    tracked: [],
    collections: [],
    collectionProducts: [],
    notes: [],
    opportunities: [],
    settings: { weights: { growth: 30, monetization: 30, distribution: 25, feasibility: 15 }, digest: 'off', defaultMinSignificance: 50 },
  }
}

export function emptyData(sources: SourceRecord[] = []): MemoryData {
  return {
    version: 1,
    meta: { createdAt: new Date().toISOString(), snapshotCollectedAt: null, origin: 'empty' },
    products: [],
    aliases: [],
    mentions: [],
    observations: [],
    events: [],
    relationships: [],
    ads: [],
    mergeCandidates: [],
    reports: [],
    sources,
    jobs: [],
    notifications: [],
    user: emptyUserData(),
  }
}

export class MemoryStore implements Store {
  data: MemoryData
  constructor(data?: MemoryData) {
    this.data = data ?? emptyData()
  }

  private aliasKey(a: Alias) {
    return `${a.kind}:${a.value.toLowerCase()}`
  }

  async findProductsByAliases(aliases: Alias[]) {
    const keys = new Set(aliases.map((a) => this.aliasKey(a)))
    const out: { alias: Alias; productId: string }[] = []
    for (const a of this.data.aliases) {
      if (keys.has(`${a.kind}:${a.value}`)) {
        const p = this.data.products.find((x) => x.id === a.productId)
        const id = p?.status === 'merged' && p.mergedInto ? p.mergedInto : a.productId
        out.push({ alias: { kind: a.kind, value: a.value }, productId: id })
      }
    }
    return out
  }

  async getProduct(id: string) {
    return this.data.products.find((p) => p.id === id) ?? null
  }

  async getProductBySlug(slug: string) {
    return this.data.products.find((p) => p.slug === slug) ?? null
  }

  async createProduct(p: NewProduct): Promise<Product> {
    let slug = p.slug ?? slugify(p.name)
    if (this.data.products.some((x) => x.slug === slug)) slug = `${slug}-${hashString(uuid()).slice(0, 5)}`
    const product: Product = { ...p, id: uuid(), slug }
    this.data.products.push(product)
    return product
  }

  async updateProduct(id: string, patch: Partial<Product>) {
    const p = this.data.products.find((x) => x.id === id)
    if (p) Object.assign(p, patch)
  }

  async addAliases(productId: string, aliases: Alias[]) {
    for (const a of aliases) {
      const value = a.value.toLowerCase()
      const weak = a.kind === 'name' || a.kind === 'social'
      if (!this.data.aliases.some((x) => x.kind === a.kind && x.value === value && (!weak || x.productId === productId))) {
        this.data.aliases.push({ productId, kind: a.kind, value })
      }
    }
  }

  async listAliases(productId: string) {
    return this.data.aliases.filter((a) => a.productId === productId).map((a) => ({ kind: a.kind, value: a.value }))
  }

  async listProductsByCategory(category: string, limit: number) {
    return this.data.products.filter((p) => p.category === category && p.status === 'active').slice(0, limit)
  }

  async upsertMention(m: Omit<SourceMention, 'id'>) {
    const existing = this.data.mentions.find((x) => x.sourceId === m.sourceId && x.externalId === m.externalId)
    if (existing) {
      const changed = existing.contentHash !== m.contentHash
      if (changed) Object.assign(existing, { ...m, id: existing.id, discoveredAt: existing.discoveredAt, productId: existing.productId })
      return { mention: existing, isNew: false, changed }
    }
    const mention: SourceMention = { ...m, id: uuid() }
    this.data.mentions.push(mention)
    return { mention, isNew: true, changed: true }
  }

  async mentionCollectedAt(sourceId: string, externalId: string) {
    return this.data.mentions.find((m) => m.sourceId === sourceId && m.externalId === externalId)?.collectedAt ?? null
  }

  async listMentions(productId: string) {
    return this.data.mentions.filter((m) => m.productId === productId)
  }

  async insertObservations(obs: Omit<MetricObservation, 'id'>[]) {
    const keys = new Set(this.data.observations.map((o) => o.dedupeKey))
    const inserted: MetricObservation[] = []
    for (const o of obs) {
      if (keys.has(o.dedupeKey)) continue
      keys.add(o.dedupeKey)
      const row = { ...o, id: uuid() }
      this.data.observations.push(row)
      inserted.push(row)
    }
    return inserted
  }

  async listObservations(productId: string) {
    return this.data.observations.filter((o) => o.productId === productId)
  }

  async insertEvents(events: Omit<ProductEvent, 'id'>[]) {
    const keys = new Set(this.data.events.map((e) => e.dedupeKey))
    const inserted: ProductEvent[] = []
    for (const e of events) {
      if (keys.has(e.dedupeKey)) continue
      keys.add(e.dedupeKey)
      const row = { ...e, id: uuid() }
      this.data.events.push(row)
      inserted.push(row)
    }
    return inserted
  }

  async listEvents(productId: string) {
    return this.data.events.filter((e) => e.productId === productId)
  }

  async upsertRelationships(rels: Omit<ProductRelationship, 'id'>[]) {
    for (const r of rels) {
      const ex = this.data.relationships.find(
        (x) => x.productId === r.productId && x.kind === r.kind && x.relatedName.toLowerCase() === r.relatedName.toLowerCase(),
      )
      if (ex) {
        if (!ex.relatedProductId && r.relatedProductId) ex.relatedProductId = r.relatedProductId
        if (!ex.relatedDomain && r.relatedDomain) ex.relatedDomain = r.relatedDomain
      } else this.data.relationships.push({ ...r, id: uuid() })
    }
  }

  async listRelationships(productId: string) {
    return this.data.relationships.filter((r) => r.productId === productId)
  }

  async upsertAds(ads: Omit<Advertisement, 'id'>[]) {
    const out: { ad: Advertisement; isNew: boolean }[] = []
    for (const a of ads) {
      const ex = this.data.ads.find((x) => x.sourceId === a.sourceId && x.externalId === a.externalId)
      if (ex) {
        Object.assign(ex, { lastObserved: a.lastObserved ?? ex.lastObserved, isActive: a.isActive ?? ex.isActive })
        out.push({ ad: ex, isNew: false })
      } else {
        const ad = { ...a, id: uuid() }
        this.data.ads.push(ad)
        out.push({ ad, isNew: true })
      }
    }
    return out
  }

  async addMergeCandidate(c: Omit<MergeCandidate, 'id' | 'createdAt' | 'status'>) {
    const exists = this.data.mergeCandidates.some(
      (x) => (x.productA === c.productA && x.productB === c.productB) || (x.productA === c.productB && x.productB === c.productA),
    )
    if (!exists) this.data.mergeCandidates.push({ ...c, id: uuid(), status: 'open', createdAt: new Date().toISOString() })
  }

  async saveReport(r: Omit<ResearchReport, 'id'>) {
    const row = { ...r, id: uuid() }
    this.data.reports.push(row)
    return row
  }

  async latestReport(productId: string) {
    const rs = this.data.reports.filter((r) => r.productId === productId)
    rs.sort((a, b) => (a.tier === b.tier ? b.createdAt.localeCompare(a.createdAt) : a.tier === 'deep' ? -1 : 1))
    return rs[0] ?? null
  }

  async getSource(id: string) {
    return this.data.sources.find((s) => s.id === id) ?? null
  }

  async updateSource(id: string, patch: Partial<SourceRecord>) {
    const s = this.data.sources.find((x) => x.id === id)
    if (s) Object.assign(s, patch)
  }

  async createJob(job: Omit<IngestionJob, 'id'>) {
    const row = { ...job, id: uuid() }
    this.data.jobs.unshift(row)
    this.data.jobs = this.data.jobs.slice(0, 200)
    return row
  }

  async updateJob(id: string, patch: Partial<IngestionJob>) {
    const j = this.data.jobs.find((x) => x.id === id)
    if (j) Object.assign(j, patch)
  }

  async listTrackers(productId: string): Promise<Tracker[]> {
    return this.data.user.tracked
      .filter((t) => t.productId === productId)
      .map((t) => ({ userId: LOCAL_USER_ID, minSignificance: t.minSignificance }))
  }

  async insertNotifications(rows: Omit<NotificationRow, 'id' | 'createdAt' | 'readAt'>[]) {
    let n = 0
    for (const r of rows) {
      if (this.data.notifications.some((x) => x.userId === r.userId && x.eventId === r.eventId)) continue
      this.data.notifications.unshift({ ...r, id: uuid(), createdAt: new Date().toISOString(), readAt: null })
      n++
    }
    return n
  }
}
