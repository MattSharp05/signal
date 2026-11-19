import type { AiService } from './ai-types.ts'
import { detectMetricChanges } from './changes.ts'
import { getConnector, shortSourceName } from './connectors/index.ts'
import { discoverRss } from './connectors/rss.ts'
import type { ConnectorContext, EnrichTarget } from './connectors/types.ts'
import { crawlWebsite } from './connectors/website.ts'
import { Http } from './http.ts'
import { normalizeUrl } from './normalize.ts'
import { buildRuleReport } from './report.ts'
import { mentionAliases, resolveMention } from './resolve.ts'
import { computeOpportunityScore, computeRelevance } from './scoring.ts'
import { hashString } from './store.ts'
import type { Store } from './store.ts'
import { computeStage, computeSummaryMetrics, derivedColumns } from './summarize.ts'
import type { IngestionJob, MetricObservation, Product, ProductEvent, RawMention, ScoreWeights } from './types.ts'

export interface PipelineDeps {
  store: Store
  http?: Http
  env?: (name: string) => string | undefined
  now?: () => Date
  log?: (msg: string) => void
  runtime?: 'server' | 'browser'
  ai?: AiService | null
  weights?: ScoreWeights
  dataOrigin?: Product['dataOrigin']
}

export interface IngestResult {
  productId: string
  created: boolean
  mentionNew: boolean
  mentionChanged: boolean
  observationsNew: number
  events: ProductEvent[]
}

const ENRICHERS = ['website', 'trustmrr', 'quietmoney', 'cashflowing', 'similarweb', 'meta_ads']

function d(deps: PipelineDeps) {
  return {
    store: deps.store,
    http: deps.http ?? new Http({ browser: deps.runtime === 'browser' }),
    env: deps.env ?? (() => undefined),
    now: deps.now ?? (() => new Date()),
    log: deps.log ?? (() => {}),
    runtime: deps.runtime ?? 'server',
    ai: deps.ai ?? null,
    weights: deps.weights,
    dataOrigin: deps.dataOrigin ?? 'pipeline',
  }
}

function contentHash(m: RawMention): string {
  return hashString(JSON.stringify([m.title, m.excerpt, m.identity, m.metrics.map((x) => [x.metric, x.value, x.periodLabel]), m.ads?.length ?? 0]))
}

function observationKey(sourceId: string, productId: string, x: RawMention['metrics'][number]): string {
  return [sourceId, productId, x.metric, x.evidence, x.periodStart ?? '', x.periodEnd ?? '', x.periodLabel ?? '', x.asOf?.slice(0, 10) ?? '', x.value].join('|')
}

/** Fill empty product fields from a mention (never overwrite curated values with weaker ones). Returns patch + whether pricing changed. */
function mergeIdentity(p: Product, m: RawMention): { patch: Partial<Product>; pricingChanged: string | null } {
  const id = m.identity
  const patch: Partial<Product> = {}
  const site = normalizeUrl(id.websiteUrl)
  if (!p.domain && site?.domain) patch.domain = site.domain
  if (!p.websiteUrl && site && !site.isAggregator) patch.websiteUrl = site.url
  // a product named after a Show HN title or a bare domain gets upgraded by better sources
  if (id.name && (m.sourceId === 'website' || m.sourceId === 'trustmrr') && p.name.toLowerCase() === (p.domain ?? '').split('.')[0]) patch.name = id.name
  if (!p.tagline && id.tagline) patch.tagline = id.tagline
  if (id.description && (!p.description || (m.sourceId === 'website' && p.description.length < 40))) patch.description = id.description
  if ((!p.category || p.category === 'Other') && id.category && id.category !== 'Other') patch.category = id.category
  if (!p.logoUrl && id.logoUrl) patch.logoUrl = id.logoUrl
  if (!p.companyName && id.company) patch.companyName = id.company
  if (!p.businessModel && id.businessModel) patch.businessModel = id.businessModel
  if (id.launchDate && (!p.launchDate || id.launchDate < p.launchDate)) patch.launchDate = id.launchDate
  const tags = [...new Set([...p.tags, ...(id.tags ?? [])])].slice(0, 12)
  if (tags.length !== p.tags.length) patch.tags = tags
  const platforms = [...new Set([...p.platforms.filter((x) => x !== 'Web' || !(id.platforms ?? []).includes('Open source')), ...(id.platforms ?? [])])]
  if (platforms.join() !== p.platforms.join()) patch.platforms = platforms
  let pricingChanged: string | null = null
  if (id.pricingSummary && id.pricingSummary !== p.pricingSummary) {
    if (p.pricingSummary) pricingChanged = `${p.pricingSummary} → ${id.pricingSummary}`
    patch.pricingSummary = id.pricingSummary
  }
  return { patch, pricingChanged }
}

/** Recompute derived product fields (summary metrics, stage, sources, scores). */
export async function recomputeProduct(deps: PipelineDeps, productId: string): Promise<Product | null> {
  const { store, now, weights } = d(deps)
  const p = await store.getProduct(productId)
  if (!p) return null
  const [obs, mentions] = await Promise.all([store.listObservations(productId), store.listMentions(productId)])
  const summary = computeSummaryMetrics(obs)
  const sourceIds = [...new Set(mentions.map((m) => m.sourceId))]
  const base = { ...p, sourceIds }
  const distNotes = mentions.filter((m) => m.sourceId === 'quietmoney' && m.excerpt?.startsWith('Acquisition')).map((m) => (m.excerpt ?? '').split('\n')[0].slice(0, 160))
  const scoreInput = { product: base, summary, distributionNotes: distNotes }
  const patch: Partial<Product> = {
    summaryMetrics: summary,
    sourceIds,
    sourceCount: sourceIds.length,
    stage: computeStage(base, summary, now()),
    opportunityScore: computeOpportunityScore(scoreInput, weights, now()),
    relevanceScore: computeRelevance(scoreInput, now()),
    ...derivedColumns(summary),
  }
  await store.updateProduct(productId, patch)
  return { ...p, ...patch }
}

/** Store one raw mention: resolve → mention → observations → change events → identity merge → recompute → notify. Idempotent. */
export async function ingestMention(deps: PipelineDeps, raw: RawMention, opts: { forceProductId?: string } = {}): Promise<IngestResult> {
  const { store, now, ai, log, dataOrigin } = d(deps)
  const t = now()
  let productId: string
  let created = false
  // A source document we have seen before stays attached to its product (no re-resolution → no orphan duplicates).
  const known = opts.forceProductId ? null : await store.mentionProductId(raw.sourceId, raw.externalId)
  if (opts.forceProductId || known) {
    productId = (opts.forceProductId ?? known)!
    // attach any new strong aliases (e.g. a newly learned domain) to the target product
    const aliases = mentionAliases(raw)
    const owned = await store.findProductsByAliases(aliases)
    await store.addAliases(productId, aliases.filter((a) => !owned.some((o) => o.alias.kind === a.kind && o.alias.value === a.value && o.productId !== productId)))
  } else {
    const r = await resolveMention(store, raw, t, dataOrigin)
    productId = r.productId
    created = r.created
  }

  const hash = contentHash(raw)
  const { mention, isNew, changed } = await store.upsertMention({
    sourceId: raw.sourceId,
    productId,
    externalId: raw.externalId,
    url: raw.url,
    title: raw.title ?? null,
    excerpt: raw.excerpt ?? null,
    author: raw.author ?? null,
    publishedAt: raw.publishedAt ?? null,
    discoveredAt: t.toISOString(),
    collectedAt: t.toISOString(),
    contentHash: hash,
  })
  if (!isNew && !changed) return { productId: mention.productId, created, mentionNew: false, mentionChanged: false, observationsNew: 0, events: [] }
  productId = mention.productId

  const product = (await store.getProduct(productId))!
  const prior = await store.listObservations(productId)
  const sourceHadMentions = isNew && (await store.listMentions(productId)).filter((m) => m.sourceId === raw.sourceId).length === 1

  let metrics = raw.metrics
  if (ai && raw.text && (raw.sourceId === 'website' || raw.sourceId === 'manual')) {
    try {
      const extra = await ai.extractFacts({ text: raw.text, url: raw.url, evidence: 'founder_reported', productName: product.name })
      metrics = [...metrics, ...extra.metrics.filter((x) => !metrics.some((y) => y.metric === x.metric && y.value === x.value))]
    } catch (e) {
      log(`ai extract failed: ${(e as Error).message}`)
    }
  }

  const obsRows: Omit<MetricObservation, 'id'>[] = metrics.map((x) => ({
    productId,
    mentionId: mention.id,
    sourceId: raw.sourceId,
    metric: x.metric,
    value: x.value,
    unit: x.unit,
    currency: x.currency ?? (x.unit === 'USD' ? 'USD' : null),
    periodStart: x.periodStart ?? null,
    periodEnd: x.periodEnd ?? null,
    periodLabel: x.periodLabel ?? null,
    asOf: x.asOf ?? null,
    evidence: x.evidence,
    confidence: x.confidence,
    sourceUrl: raw.url,
    quote: x.quote ?? null,
    note: x.note ?? null,
    attribution: x.attribution ?? null,
    publishedAt: raw.publishedAt ?? null,
    collectedAt: t.toISOString(),
    dedupeKey: observationKey(raw.sourceId, productId, x),
  }))
  const inserted = await store.insertObservations(obsRows)

  const src = (id: string) => shortSourceName(id)
  const events: Omit<ProductEvent, 'id'>[] = []
  if (created) {
    events.push({
      productId, type: 'discovered', title: `Discovered via ${src(raw.sourceId)}`, detail: raw.title ?? null, significance: 30,
      occurredAt: raw.publishedAt ?? t.toISOString(), sourceId: raw.sourceId, mentionId: mention.id, observationId: null, dedupeKey: `discovered:${productId}`,
    })
  } else if (sourceHadMentions) {
    events.push({
      productId, type: 'new_source', title: `New source: ${src(raw.sourceId)}`, detail: raw.title ?? null, significance: raw.sourceId === 'trustmrr' ? 65 : 40,
      occurredAt: raw.publishedAt ?? t.toISOString(), sourceId: raw.sourceId, mentionId: mention.id, observationId: null, dedupeKey: `source:${productId}:${raw.sourceId}`,
    })
  }
  if (['hn_show', 'producthunt_feed', 'producthunt_api'].includes(raw.sourceId) && isNew) {
    events.push({
      productId, type: 'launch', title: `Launched on ${src(raw.sourceId)}`, detail: raw.title ?? null, significance: 45,
      occurredAt: raw.publishedAt ?? t.toISOString(), sourceId: raw.sourceId, mentionId: mention.id, observationId: null, dedupeKey: `launch:${productId}:${raw.sourceId}:${raw.externalId}`,
    })
  }
  events.push(...detectMetricChanges(prior, inserted, src))

  const { patch, pricingChanged } = mergeIdentity(product, raw)
  if (pricingChanged) {
    events.push({
      productId, type: 'pricing_change', title: 'Pricing changed', detail: pricingChanged, significance: 60, occurredAt: t.toISOString(),
      sourceId: raw.sourceId, mentionId: mention.id, observationId: null, dedupeKey: `pricing:${productId}:${hashString(pricingChanged)}`,
    })
  }
  patch.lastUpdatedAt = t.toISOString()

  if (raw.relationships?.length) {
    const rels = []
    for (const r of raw.relationships) {
      const hits = r.domain ? await store.findProductsByAliases([{ kind: 'domain', value: r.domain }]) : []
      rels.push({ productId, relatedProductId: hits[0]?.productId ?? null, relatedName: r.name, relatedDomain: r.domain ?? null, kind: r.kind, reason: r.reason ?? null, sourceId: raw.sourceId })
    }
    await store.upsertRelationships(rels)
  }

  if (raw.ads?.length) {
    const res = await store.upsertAds(
      raw.ads.map((a) => ({
        productId, sourceId: raw.sourceId, externalId: a.externalId, platform: a.platform, advertiser: a.advertiser ?? null, headline: a.headline ?? null,
        body: a.body ?? null, mediaType: a.mediaType ?? null, mediaUrl: a.mediaUrl ?? null, landingUrl: a.landingUrl ?? null,
        firstObserved: a.firstObserved ?? t.toISOString(), lastObserved: a.lastObserved ?? t.toISOString(), isActive: a.isActive ?? null,
        originalUrl: a.originalUrl ?? null, analysis: null, manual: false,
      })),
    )
    for (const { ad, isNew: n } of res) {
      if (!n) continue
      events.push({
        productId, type: 'new_ad', title: `New ${ad.platform} ad observed`, detail: ad.headline ?? ad.body?.slice(0, 120) ?? null, significance: 55,
        occurredAt: ad.firstObserved ?? t.toISOString(), sourceId: raw.sourceId, mentionId: mention.id, observationId: null, dedupeKey: `ad:${ad.sourceId}:${ad.externalId}`,
      })
    }
  }

  const newEvents = await store.insertEvents(events)
  if (newEvents.some((e) => e.significance >= 50)) patch.lastSignificantAt = t.toISOString()
  await store.updateProduct(productId, patch)
  await recomputeProduct(deps, productId)
  await notify(store, newEvents)

  return { productId, created, mentionNew: isNew, mentionChanged: changed, observationsNew: inserted.length, events: newEvents }
}

async function notify(store: Store, events: ProductEvent[]) {
  for (const e of events) {
    if (e.type === 'discovered') continue
    const trackers = await store.listTrackers(e.productId)
    const rows = trackers.filter((t) => e.significance >= t.minSignificance).map((t) => ({ userId: t.userId, productId: e.productId, eventId: e.id }))
    if (rows.length) await store.insertNotifications(rows)
  }
}

function contextFor(deps: ReturnType<typeof d>, sourceId: string, cfg: Record<string, unknown>, cursor: Record<string, unknown>, budget: number, logs: string[]): ConnectorContext {
  return {
    http: deps.http,
    cursor,
    config: cfg,
    budget,
    env: deps.env,
    now: deps.now(),
    log: (m) => {
      logs.push(m)
      deps.log(`[${sourceId}] ${m}`)
    },
    lastCollected: (ext) => deps.store.mentionCollectedAt(sourceId, ext),
    runtime: deps.runtime,
  }
}

/** Run enrichment connectors for a product (website, TrustMRR, QuietMoney, Cashflowing, …). */
export async function enrichProduct(
  deps: PipelineDeps,
  productId: string,
  opts: { sources?: string[]; skip?: string[]; logs?: string[] } = {},
): Promise<{ mentions: number; errors: string[] }> {
  const x = d(deps)
  const p = await x.store.getProduct(productId)
  if (!p) return { mentions: 0, errors: ['product not found'] }
  const target: EnrichTarget = { productId, name: p.name, domain: p.domain, websiteUrl: p.websiteUrl }
  const errors: string[] = []
  let count = 0
  const logs = opts.logs ?? []
  for (const id of opts.sources ?? ENRICHERS) {
    if (opts.skip?.includes(id)) continue
    const conn = getConnector(id)
    const src = await x.store.getSource(id)
    if (!conn?.enrich || !src?.enabled) continue
    if (!conn.runsIn.includes(x.runtime)) continue
    if ((conn.requiresCredentials ?? []).some((k) => !x.env(k))) continue
    if (!target.domain && id !== 'website' && id !== 'meta_ads') continue
    try {
      const ms = await conn.enrich(contextFor(x, id, src.config, src.cursor, 5, logs), target)
      for (const m of ms) {
        await ingestMention(deps, m, { forceProductId: productId })
        count++
      }
      await x.store.updateSource(id, { lastRunAt: x.now().toISOString(), lastSuccessAt: x.now().toISOString(), lastError: null, mentionsCollected: (src.mentionsCollected ?? 0) + ms.length })
      // the website may reveal the domain; refresh target
      const fresh = await x.store.getProduct(productId)
      if (fresh) Object.assign(target, { domain: fresh.domain, websiteUrl: fresh.websiteUrl })
    } catch (e) {
      const msg = `${id}: ${(e as Error).message}`
      errors.push(msg)
      logs.push(msg)
      await x.store.updateSource(id, { lastRunAt: x.now().toISOString(), lastError: msg })
    }
  }
  return { mentions: count, errors }
}

/** Run one discovery source end-to-end, recording an ingestion job. */
export async function runSource(
  deps: PipelineDeps,
  sourceId: string,
  opts: { trigger?: IngestionJob['trigger']; budget?: number; enrichNew?: number } = {},
): Promise<IngestionJob> {
  const x = d(deps)
  const src = await x.store.getSource(sourceId)
  if (!src) throw new Error(`Unknown source ${sourceId}`)
  const logs: string[] = []
  const job = await x.store.createJob({
    sourceId, status: 'running', trigger: opts.trigger ?? 'manual', startedAt: x.now().toISOString(), finishedAt: null,
    itemsFetched: 0, mentionsNew: 0, productsCreated: 0, productsUpdated: 0, observationsNew: 0, eventsNew: 0, error: null, log: [],
  })
  const counts = { itemsFetched: 0, mentionsNew: 0, productsCreated: 0, productsUpdated: 0, observationsNew: 0, eventsNew: 0 }
  const created: string[] = []
  const itemErrors: string[] = []
  try {
    const conn = getConnector(sourceId)
    const ctx = contextFor(x, sourceId, src.config, src.cursor, opts.budget ?? 25, logs)
    let batch
    if (src.custom || sourceId.startsWith('rss_')) batch = await discoverRss(ctx, sourceId)
    else {
      if (!conn?.discover) throw new Error(`${src.name} has no discovery connector`)
      if (!conn.runsIn.includes(x.runtime)) throw new Error(`${src.name} runs on the server only`)
      const missing = (conn.requiresCredentials ?? []).filter((k) => !x.env(k))
      if (missing.length) throw new Error(`Missing credentials: ${missing.join(', ')}`)
      batch = await conn.discover(ctx)
    }
    counts.itemsFetched = batch.fetched
    const updated = new Set<string>()
    for (const m of batch.mentions) {
      try {
        const r = await ingestMention(deps, m)
        if (r.mentionNew) counts.mentionsNew++
        if (r.created) {
          counts.productsCreated++
          created.push(r.productId)
        } else if (r.mentionChanged) updated.add(r.productId)
        counts.observationsNew += r.observationsNew
        counts.eventsNew += r.events.length
      } catch (e) {
        itemErrors.push(`${m.externalId}: ${(e as Error).message}`)
      }
    }
    counts.productsUpdated = updated.size

    // Enrichment fan-out for new products (bounded).
    const enrichN = opts.enrichNew ?? 5
    for (const pid of created.slice(0, enrichN)) {
      const r = await enrichProduct(deps, pid, { skip: [sourceId], logs })
      for (const e of r.errors) logs.push(`enrich ${pid.slice(0, 8)} ${e}`)
    }
    if (created.length > enrichN) logs.push(`${created.length - enrichN} new products queued for later enrichment`)

    const status: IngestionJob['status'] = itemErrors.length ? 'partial' : 'success'
    await x.store.updateSource(sourceId, {
      cursor: batch.cursor, lastRunAt: x.now().toISOString(), lastSuccessAt: x.now().toISOString(), lastError: itemErrors[0] ?? null,
      productsDiscovered: src.productsDiscovered + counts.productsCreated, mentionsCollected: src.mentionsCollected + counts.mentionsNew,
    })
    const final = { ...counts, status, finishedAt: x.now().toISOString(), log: [...logs, ...itemErrors].slice(-100), error: itemErrors.length ? `${itemErrors.length} item(s) failed` : null }
    await x.store.updateJob(job.id, final)
    return { ...job, ...final }
  } catch (e) {
    const msg = (e as Error).message
    await x.store.updateSource(sourceId, { lastRunAt: x.now().toISOString(), lastError: msg })
    const final = { ...counts, status: 'error' as const, finishedAt: x.now().toISOString(), error: msg, log: [...logs, msg].slice(-100) }
    await x.store.updateJob(job.id, final)
    return { ...job, ...final }
  }
}

/** Manual submission: normalize → dedupe → crawl website → enrich → profile. */
export async function addProductByUrl(deps: PipelineDeps, input: string): Promise<{ productId: string; created: boolean; errors: string[] }> {
  const x = d(deps)
  const n = normalizeUrl(input)
  if (!n) throw new Error('Please enter a valid http(s) URL')
  if (n.isAggregator) throw new Error(`${n.host} is a directory or social site, not a product website. Paste the product's own URL.`)
  const aliases = n.domain ? [{ kind: 'domain' as const, value: n.domain }] : n.hostPath ? [{ kind: 'host_path' as const, value: n.hostPath }] : []
  const existing = (await x.store.findProductsByAliases(aliases))[0]
  const errors: string[] = []
  let productId: string
  let created = false
  let site: RawMention | null = null
  try {
    site = x.runtime === 'server' ? await crawlWebsite(contextFor(x, 'website', {}, {}, 3, []), n.url) : null
  } catch (e) {
    errors.push(`website: ${(e as Error).message}`)
  }
  // The manual mention records the submission itself; figures come from the website mention below (no double counting).
  const raw: RawMention = {
    sourceId: 'manual', externalId: n.domain ?? n.hostPath ?? n.url, url: n.url, title: site?.title ?? n.host,
    excerpt: 'Added manually by URL', identity: site ? { ...site.identity } : { websiteUrl: n.url, aliases }, metrics: [],
  }
  if (existing) {
    productId = existing.productId
    await ingestMention(deps, raw, { forceProductId: productId })
  } else {
    const r = await ingestMention(deps, raw)
    productId = r.productId
    created = r.created
  }
  if (site) {
    // also keep it as a website-source mention so the website connector owns refreshes
    await ingestMention(deps, site, { forceProductId: productId })
  }
  const e = await enrichProduct(deps, productId, { skip: ['website'] })
  errors.push(...e.errors)
  await recomputeProduct(deps, productId)
  return { productId, created, errors }
}

/** Build and store a research report: AI when configured, otherwise rule-based. */
export async function generateReport(deps: PipelineDeps, productId: string, tier: 'lite' | 'deep' = 'deep') {
  const x = d(deps)
  const product = await x.store.getProduct(productId)
  if (!product) throw new Error('Product not found')
  const [mentions, observations, relationships] = await Promise.all([
    x.store.listMentions(productId),
    x.store.listObservations(productId),
    x.store.listRelationships(productId),
  ])
  const pack = { product, mentions, observations, relationships, ads: [], texts: [] }
  if (x.ai && tier === 'deep') {
    const { content, tokens } = await x.ai.deepReport(pack)
    return x.store.saveReport({ productId, tier, generator: 'ai', model: x.ai.model, createdAt: x.now().toISOString(), content, costTokens: tokens })
  }
  return x.store.saveReport({ productId, tier, generator: 'rules', model: null, createdAt: x.now().toISOString(), content: buildRuleReport(pack), costTokens: null })
}
