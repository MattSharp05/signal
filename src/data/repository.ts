import type { OpportunityRow } from '@core/memory-store.ts'
import type {
  Advertisement, IngestionJob, MergeCandidate, MetricObservation, Product, ProductEvent, ProductRelationship, ProductStage, ResearchReport,
  ScoreWeights, SourceMention, SourceRecord,
} from '@core/types.ts'

export type { OpportunityRow }

export type FeedSort = 'discovered' | 'updated' | 'trending' | 'revenue' | 'growth' | 'sources' | 'launched'

export interface FeedFilters {
  q?: string
  category?: string
  platform?: string
  stage?: ProductStage
  quick?: 'new' | 'trending' | 'revenue' | null
  hasRevenue?: boolean
  revenueMin?: number
  revenueMax?: number
  growthMin?: number
  businessModel?: string
  source?: string
  savedOnly?: boolean
  trackedOnly?: boolean
  maxAgeDays?: number
  evidence?: 'verified' | 'founder_or_better' | 'any_metric'
  sort: FeedSort
}

export interface FeedPage {
  items: Product[]
  nextOffset: number | null
  total: number | null
}

export interface ProductDetail {
  product: Product
  mentions: SourceMention[]
  observations: MetricObservation[]
  events: ProductEvent[]
  relationships: ProductRelationship[]
  similar: Product[]
  ads: Advertisement[]
  report: ResearchReport | null
}

export interface SavedEntry {
  productId: string
  collectionId: string | null
  note: string | null
  createdAt: string
}
export interface TrackedEntry {
  productId: string
  minSignificance: number
  createdAt: string
}
export interface Collection {
  id: string
  name: string
  createdAt: string
}
export interface UserState {
  saved: SavedEntry[]
  tracked: TrackedEntry[]
  collections: Collection[]
  collectionProducts: { collectionId: string; productId: string }[]
}

export interface Note {
  id: string
  productId: string
  body: string
  kind: 'observation' | 'conclusion' | 'opportunity'
  createdAt: string
  updatedAt: string
}

export interface UpdateItem {
  id: string
  event: ProductEvent
  product: Pick<Product, 'id' | 'slug' | 'name' | 'logoUrl' | 'domain'>
  read: boolean
  createdAt: string
}

export interface Settings {
  weights: ScoreWeights
  digest: 'off' | 'daily' | 'weekly'
  defaultMinSignificance: number
}

export interface MergeCandidateView extends MergeCandidate {
  a: Product | null
  b: Product | null
}

export interface DataMeta {
  mode: 'local' | 'supabase'
  snapshotCollectedAt: string | null
  origin: 'snapshot' | 'empty' | 'live'
  aiConfigured: boolean | null
}

export type ManualAdInput = Pick<Advertisement, 'platform' | 'advertiser' | 'headline' | 'body' | 'landingUrl' | 'originalUrl' | 'mediaUrl' | 'firstObserved'>

/** Single data-access port for the UI. Implemented by LocalRepository (browser) and SupabaseRepository. */
export interface Repository {
  meta(): Promise<DataMeta>
  listFeed(filters: FeedFilters, offset: number, limit: number, user: UserState): Promise<FeedPage>
  getProduct(slugOrId: string): Promise<ProductDetail | null>
  productsByIds(ids: string[]): Promise<Product[]>
  allProductsLite(): Promise<Product[]>
  recentEvents(limit: number): Promise<(ProductEvent & { product: Pick<Product, 'id' | 'slug' | 'name' | 'logoUrl'> })[]>

  userState(): Promise<UserState>
  setSaved(productId: string, saved: boolean, opts?: { collectionId?: string | null; note?: string | null }): Promise<void>
  setTracked(productId: string, tracked: boolean, minSignificance?: number): Promise<void>
  createCollection(name: string): Promise<Collection>
  deleteCollection(id: string): Promise<void>
  addToCollection(collectionId: string, productId: string): Promise<void>
  removeFromCollection(collectionId: string, productId: string): Promise<void>

  listNotes(productId: string): Promise<Note[]>
  addNote(productId: string, body: string, kind: Note['kind']): Promise<void>
  deleteNote(id: string): Promise<void>

  listOpportunities(): Promise<OpportunityRow[]>
  saveOpportunity(o: Partial<OpportunityRow> & { title: string }): Promise<OpportunityRow>
  deleteOpportunity(id: string): Promise<void>

  listUpdates(): Promise<UpdateItem[]>
  markUpdatesRead(ids: string[]): Promise<void>

  listSources(): Promise<SourceRecord[]>
  updateSource(id: string, patch: { enabled?: boolean; refreshMinutes?: number }): Promise<void>
  runSource(id: string): Promise<IngestionJob>
  addRssSource(url: string, name: string): Promise<void>
  listJobs(limit: number): Promise<IngestionJob[]>
  listMergeCandidates(): Promise<MergeCandidateView[]>
  mergeProducts(survivorId: string, loserId: string, candidateId: string): Promise<void>
  dismissMergeCandidate(id: string): Promise<void>

  addProduct(url: string): Promise<{ slug: string; created: boolean; warnings: string[] }>
  generateReport(productId: string): Promise<ResearchReport>
  addManualAd(productId: string, ad: ManualAdInput): Promise<void>
  analyzeAd(adId: string): Promise<void>

  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
  resetLocalData?(): Promise<void>
}
