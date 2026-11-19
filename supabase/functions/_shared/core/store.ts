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

export interface Tracker {
  userId: string
  minSignificance: number
}

export interface NotificationRow {
  id: string
  userId: string
  productId: string
  eventId: string
  createdAt: string
  readAt: string | null
}

export type NewProduct = Omit<Product, 'id' | 'slug'> & { slug?: string }

/** Persistence port used by the pipeline. Implemented by MemoryStore (tests/CLI/browser) and SupabaseStore (Edge Functions). */
export interface Store {
  // products
  findProductsByAliases(aliases: Alias[]): Promise<{ alias: Alias; productId: string }[]>
  getProduct(id: string): Promise<Product | null>
  getProductBySlug(slug: string): Promise<Product | null>
  createProduct(p: NewProduct): Promise<Product>
  updateProduct(id: string, patch: Partial<Product>): Promise<void>
  addAliases(productId: string, aliases: Alias[]): Promise<void>
  listAliases(productId: string): Promise<Alias[]>
  listProductsByCategory(category: string, limit: number): Promise<Product[]>

  // evidence
  upsertMention(m: Omit<SourceMention, 'id'>): Promise<{ mention: SourceMention; isNew: boolean; changed: boolean }>
  listMentions(productId: string): Promise<SourceMention[]>
  mentionCollectedAt(sourceId: string, externalId: string): Promise<string | null>
  /** product a source document is already attached to (stable across runs, even if identity data changed) */
  mentionProductId(sourceId: string, externalId: string): Promise<string | null>
  insertObservations(obs: Omit<MetricObservation, 'id'>[]): Promise<MetricObservation[]>
  listObservations(productId: string): Promise<MetricObservation[]>
  insertEvents(events: Omit<ProductEvent, 'id'>[]): Promise<ProductEvent[]>
  listEvents(productId: string): Promise<ProductEvent[]>
  upsertRelationships(rels: Omit<ProductRelationship, 'id'>[]): Promise<void>
  listRelationships(productId: string): Promise<ProductRelationship[]>
  upsertAds(ads: Omit<Advertisement, 'id'>[]): Promise<{ ad: Advertisement; isNew: boolean }[]>
  addMergeCandidate(c: Omit<MergeCandidate, 'id' | 'createdAt' | 'status'>): Promise<void>
  saveReport(r: Omit<ResearchReport, 'id'>): Promise<ResearchReport>
  latestReport(productId: string): Promise<ResearchReport | null>

  // sources & jobs
  getSource(id: string): Promise<SourceRecord | null>
  updateSource(id: string, patch: Partial<SourceRecord>): Promise<void>
  createJob(job: Omit<IngestionJob, 'id'>): Promise<IngestionJob>
  updateJob(id: string, patch: Partial<IngestionJob>): Promise<void>

  // monitoring
  listTrackers(productId: string): Promise<Tracker[]>
  insertNotifications(rows: Omit<NotificationRow, 'id' | 'createdAt' | 'readAt'>[]): Promise<number>
}

/** Small deterministic string hash (cyrb53) for content hashes. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // fallback (non-secure contexts)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
