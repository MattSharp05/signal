import type { SourceRecord } from '../types.ts'
import { cashflowing } from './cashflowing.ts'
import { metaAds, reddit, similarweb } from './credentialed.ts'
import { githubRising } from './github.ts'
import { hnShow } from './hn.ts'
import { productHuntApi, productHuntFeed } from './producthunt.ts'
import { quietMoney } from './quietmoney.ts'
import { trustMrr } from './trustmrr.ts'
import type { ConnectorDefinition } from './types.ts'
import { website } from './website.ts'

export * from './types.ts'

/** Implemented connectors. Adding a source = one file + one line here. */
export const CONNECTORS: ConnectorDefinition[] = [
  hnShow,
  productHuntFeed,
  productHuntApi,
  githubRising,
  trustMrr,
  quietMoney,
  cashflowing,
  website,
  reddit,
  metaAds,
  similarweb,
]

export function getConnector(id: string): ConnectorDefinition | undefined {
  return CONNECTORS.find((c) => c.id === id)
}

/** Researched sources that cannot (yet) be automated legitimately. Shown on the Sources page with the reason. */
export const CATALOG_ONLY: Omit<SourceRecord, 'lastRunAt' | 'lastSuccessAt' | 'lastError' | 'productsDiscovered' | 'mentionsCollected' | 'cursor' | 'credentialsPresent'>[] = [
  {
    id: 'starter_story', name: 'Starter Story', kind: 'manual', role: 'both', status: 'manual', enabled: false, refreshMinutes: 0,
    homepage: 'https://www.starterstory.com/', docsUrl: null, credentialEnv: [], runsIn: [], config: {}, custom: false,
    notes: 'No API or RSS feed; interviews are largely behind a paid membership. Paste an article URL into Add Product to attach it manually (only public metadata is read).',
  },
  {
    id: 'indie_hackers', name: 'Indie Hackers', kind: 'manual', role: 'both', status: 'unsupported', enabled: false, refreshMinutes: 0,
    homepage: 'https://www.indiehackers.com/', docsUrl: null, credentialEnv: [], runsIn: [], config: {}, custom: false,
    notes: 'No public API; feed returns 403 and robots.txt disallows AI/automated crawlers. Not collected automatically.',
  },
  {
    id: 'acquire', name: 'Acquire.com', kind: 'manual', role: 'both', status: 'unsupported', enabled: false, refreshMinutes: 0,
    homepage: 'https://acquire.com/', docsUrl: null, credentialEnv: [], runsIn: [], config: {}, custom: false,
    notes: 'Listing financials are gated behind buyer accounts/NDAs. No public API.',
  },
  {
    id: 'exploding_topics', name: 'Exploding Topics', kind: 'licensed', role: 'discovery', status: 'licensed', enabled: false, refreshMinutes: 1440,
    homepage: 'https://explodingtopics.com/', docsUrl: 'https://explodingtopics.com/api', credentialEnv: ['EXPLODING_TOPICS_API_KEY'], runsIn: ['server'], config: {}, custom: false,
    notes: 'Paid API on Business plans (recurring cost). Not implemented until licensed.',
  },
  {
    id: 'google_trends', name: 'Google Trends', kind: 'api', role: 'enrichment', status: 'unsupported', enabled: false, refreshMinutes: 0,
    homepage: 'https://trends.google.com/trends/', docsUrl: 'https://developers.google.com/search/apis/trends', credentialEnv: [], runsIn: [], config: {}, custom: false,
    notes: 'Official Trends API is in limited alpha (application required). Unofficial scraping violates the terms, so it is not used.',
  },
  {
    id: 'tiktok_creative', name: 'TikTok Creative Center / Commercial Content API', kind: 'api', role: 'enrichment', status: 'unsupported', enabled: false, refreshMinutes: 0,
    homepage: 'https://ads.tiktok.com/business/creativecenter/', docsUrl: 'https://developers.tiktok.com/products/commercial-content-api', credentialEnv: ['TIKTOK_CCA_TOKEN'], runsIn: [], config: {}, custom: false,
    notes: 'Creative Center has no public API. The Commercial Content API (EU ads) requires an approved application.',
  },
  {
    id: 'google_ads_transparency', name: 'Google Ads Transparency Center', kind: 'licensed', role: 'enrichment', status: 'unsupported', enabled: false, refreshMinutes: 0,
    homepage: 'https://adstransparency.google.com/', docsUrl: 'https://console.cloud.google.com/marketplace/product/bigquery-public-data/google-ads-transparency-center', credentialEnv: ['GCP_SERVICE_ACCOUNT_JSON'], runsIn: [], config: {}, custom: false,
    notes: 'No API; the legitimate route is the BigQuery public dataset (per-query cost). Designed, not implemented.',
  },
  {
    id: 'manual', name: 'Manual submission', kind: 'manual', role: 'both', status: 'operational', enabled: true, refreshMinutes: 0,
    homepage: '', docsUrl: null, credentialEnv: [], runsIn: ['server'], config: {}, custom: false,
    notes: 'Products added by pasting a URL (Add Product).',
  },
]

export function defaultSourceRecords(env: (k: string) => string | undefined = () => undefined): SourceRecord[] {
  const base = {
    lastRunAt: null, lastSuccessAt: null, lastError: null, productsDiscovered: 0, mentionsCollected: 0, cursor: {}, custom: false,
  }
  const implemented: SourceRecord[] = CONNECTORS.map((c) => {
    const creds = c.requiresCredentials ?? []
    const present = creds.length ? creds.every((k) => !!env(k)) : null
    return {
      ...base,
      id: c.id,
      name: c.name,
      kind: c.kind,
      role: c.role,
      status: creds.length && !present ? 'requires_credentials' : c.defaultStatus === 'requires_credentials' ? 'operational' : c.defaultStatus,
      enabled: c.defaultEnabled && (!creds.length || !!present),
      refreshMinutes: c.defaultRefreshMinutes,
      homepage: c.homepage,
      docsUrl: c.docsUrl ?? null,
      notes: c.notes,
      credentialEnv: creds,
      credentialsPresent: present,
      runsIn: c.runsIn,
      config: c.defaultConfig ?? {},
    }
  })
  const catalog: SourceRecord[] = CATALOG_ONLY.map((c) => ({ ...base, ...c, credentialsPresent: null }))
  return [...implemented, ...catalog]
}

export function shortSourceName(id: string, sources?: SourceRecord[]): string {
  return getConnector(id)?.shortName ?? sources?.find((s) => s.id === id)?.name ?? id
}
