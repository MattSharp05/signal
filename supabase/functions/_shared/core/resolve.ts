import { STRONG_ALIAS_KINDS, aliasesForUrl, dedupeAliases, nameFromDomain, normalizeName, normalizeUrl } from './normalize.ts'
import type { Store } from './store.ts'
import type { Alias, Product, RawMention } from './types.ts'

export interface Resolution {
  productId: string
  created: boolean
  matchedBy: Alias | null
  mergeCandidates: { otherId: string; reason: string; score: number }[]
  aliases: Alias[]
}

export function mentionAliases(m: RawMention): Alias[] {
  const name = normalizeName(m.identity.name)
  return dedupeAliases([
    ...m.identity.aliases,
    ...aliasesForUrl(m.identity.websiteUrl),
    ...(name.length >= 3 ? [{ kind: 'name' as const, value: name }] : []),
  ])
}

const STRONG_ORDER: Alias['kind'][] = ['domain', 'host_path', 'github_repo', 'trustmrr_slug', 'ph_slug']

/**
 * Deterministic entity resolution.
 * 1. Any strong alias (domain, host path, GitHub repo, TrustMRR slug, PH slug) → attach.
 *    If strong aliases point to different products → attach to the highest-priority match and flag a merge candidate.
 * 2. Name-only match → create a NEW product and flag a merge candidate (never auto-merge on name).
 *    Same name with different known domains → separate businesses, no candidate.
 * 3. Otherwise create.
 */
export async function resolveMention(store: Store, m: RawMention, now: Date, dataOrigin: Product['dataOrigin'] = 'pipeline'): Promise<Resolution> {
  const aliases = mentionAliases(m)
  const nameAlias = aliases.find((a) => a.kind === 'name')
  const hits = await store.findProductsByAliases(aliases)
  const strongHits = hits
    .filter((h) => STRONG_ALIAS_KINDS.has(h.alias.kind))
    .sort((a, b) => STRONG_ORDER.indexOf(a.alias.kind) - STRONG_ORDER.indexOf(b.alias.kind))
  const mergeCandidates: Resolution['mergeCandidates'] = []

  if (strongHits.length) {
    const winner = strongHits[0]
    const others = [...new Set(strongHits.map((h) => h.productId))].filter((id) => id !== winner.productId)
    for (const o of others) {
      const via = strongHits.find((h) => h.productId === o)!.alias
      mergeCandidates.push({ otherId: o, reason: `Same ${via.kind.replace('_', ' ')} "${via.value}" as matched product`, score: 0.9 })
      await store.addMergeCandidate({ productA: winner.productId, productB: o, reason: mergeCandidates.at(-1)!.reason, score: 0.9 })
    }
    // Only add strong aliases not already owned by another product.
    const owned = new Set(hits.map((h) => `${h.alias.kind}:${h.alias.value}`))
    await store.addAliases(winner.productId, aliases.filter((a) => !STRONG_ALIAS_KINDS.has(a.kind) || !owned.has(`${a.kind}:${a.value}`)))
    return { productId: winner.productId, created: false, matchedBy: winner.alias, mergeCandidates, aliases }
  }

  // No strong match → create.
  const site = normalizeUrl(m.identity.websiteUrl)
  const domain = site?.domain ?? null
  const name = m.identity.name?.trim() || (domain ? nameFromDomain(domain) : null) || m.title?.slice(0, 60) || 'Untitled product'
  const p = await store.createProduct({
    name,
    domain,
    websiteUrl: site && !site.isAggregator ? site.url : null,
    companyId: null,
    companyName: m.identity.company ?? null,
    tagline: m.identity.tagline ?? null,
    description: m.identity.description ?? m.identity.tagline ?? null,
    category: m.identity.category ?? null,
    tags: m.identity.tags ?? [],
    platforms: m.identity.platforms ?? [],
    businessModel: m.identity.businessModel ?? null,
    pricingSummary: m.identity.pricingSummary ?? null,
    launchDate: m.identity.launchDate ?? null,
    logoUrl: m.identity.logoUrl ?? null,
    stage: 'unknown',
    status: 'active',
    mergedInto: null,
    relevanceScore: 0,
    monthlyRevenue: null,
    revenueEvidence: null,
    growthPct: null,
    evidenceLevel: null,
    opportunityScore: null,
    summaryMetrics: {},
    sourceIds: [],
    sourceCount: 0,
    firstDiscoveredAt: now.toISOString(),
    lastUpdatedAt: now.toISOString(),
    lastSignificantAt: null,
    dataOrigin,
  })
  await store.addAliases(p.id, aliases)

  if (nameAlias) {
    for (const h of hits.filter((x) => x.alias.kind === 'name' && x.productId !== p.id)) {
      const other = await store.getProduct(h.productId)
      if (!other || other.status !== 'active') continue
      if (other.domain && domain && other.domain !== domain) continue // different businesses sharing a name
      // conflicting strong identifiers of the same kind (e.g. two different GitHub repos) → different entities
      const otherAliases = await store.listAliases(other.id)
      const conflicting = aliases.some(
        (a) => STRONG_ALIAS_KINDS.has(a.kind) && otherAliases.some((o) => o.kind === a.kind && o.value !== a.value),
      )
      if (conflicting) continue
      mergeCandidates.push({ otherId: other.id, reason: `Same normalized name "${nameAlias.value}"; one side has no website domain`, score: 0.6 })
    }
  }
  for (const c of mergeCandidates) await store.addMergeCandidate({ productA: c.otherId, productB: p.id, reason: c.reason, score: c.score })
  return { productId: p.id, created: true, matchedBy: null, mergeCandidates, aliases }
}
