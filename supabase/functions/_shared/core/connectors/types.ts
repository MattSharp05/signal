import type { Http } from '../http.ts'
import type { RawMention, SourceKind, SourceRole, SourceStatus } from '../types.ts'

export interface ConnectorContext {
  http: Http
  /** persisted, connector-defined incremental state */
  cursor: Record<string, unknown>
  config: Record<string, unknown>
  /** max items (pages/requests) this run may fetch */
  budget: number
  env: (name: string) => string | undefined
  now: Date
  log: (msg: string) => void
  /** when this source last collected an external id (for incremental sitemap crawling) */
  lastCollected: (externalId: string) => Promise<string | null>
  runtime: 'server' | 'browser'
}

export interface DiscoveryBatch {
  mentions: RawMention[]
  cursor: Record<string, unknown>
  fetched: number
}

export interface EnrichTarget {
  productId: string
  name: string
  domain: string | null
  websiteUrl: string | null
}

export interface ConnectorDefinition {
  id: string
  name: string
  kind: SourceKind
  role: SourceRole
  homepage: string
  docsUrl?: string
  notes: string
  /** default status when credentials are present / connector implemented */
  defaultStatus: SourceStatus
  requiresCredentials?: string[]
  runsIn: ('server' | 'browser')[]
  defaultRefreshMinutes: number
  defaultEnabled: boolean
  defaultConfig?: Record<string, unknown>
  /** Tag shown on cards */
  shortName: string
  discover?: (ctx: ConnectorContext) => Promise<DiscoveryBatch>
  enrich?: (ctx: ConnectorContext, target: EnrichTarget) => Promise<RawMention[]>
}
