// Anthropic-backed AI service. Only constructed server-side when ANTHROPIC_API_KEY is set.
import Anthropic from '@anthropic-ai/sdk'
import type { AiService, EvidencePack } from './ai-types.ts'
import { METRIC_META, parseCompactNumber } from './metrics.ts'
import type { AdAnalysis, Advertisement, EvidenceClass, MetricType, RawMetric, ResearchReport } from './types.ts'

const METRICS = Object.keys(METRIC_META) as MetricType[]

const nullableString = { type: ['string', 'null'] }

const FACTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['metric', 'value', 'period_label', 'quote'],
        properties: {
          metric: { type: 'string', enum: METRICS },
          value: { type: 'number' },
          period_label: nullableString,
          quote: { type: 'string', description: 'Exact verbatim substring of the source text containing the figure.' },
        },
      },
    },
  },
}

const factList = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'evidence_ids'], properties: { text: { type: 'string' }, evidence_ids: { type: 'array', items: { type: 'string' } } } } }
const strList = { type: 'array', items: { type: 'string' } }

const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['what_it_does', 'who_it_serves', 'how_it_makes_money', 'facts', 'demand_evidence', 'revenue_claims', 'acquisition_channels', 'competitors', 'interpretation', 'speculation', 'technical_complexity', 'opportunities', 'caveats'],
  properties: {
    what_it_does: nullableString,
    who_it_serves: nullableString,
    how_it_makes_money: nullableString,
    facts: factList,
    demand_evidence: factList,
    revenue_claims: factList,
    acquisition_channels: factList,
    competitors: strList,
    interpretation: strList,
    speculation: strList,
    technical_complexity: nullableString,
    opportunities: strList,
    caveats: strList,
  },
}

const AD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hook', 'audience', 'emotional_appeal', 'value_proposition', 'call_to_action', 'format', 'angle'],
  properties: Object.fromEntries(['hook', 'audience', 'emotional_appeal', 'value_proposition', 'call_to_action', 'format', 'angle'].map((k) => [k, { type: 'string' }])),
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** A fact survives only if its quote appears verbatim in the source and contains a number matching the value. */
export function groundFacts(text: string, facts: { metric: MetricType; value: number; period_label: string | null; quote: string }[], evidence: EvidenceClass): RawMetric[] {
  const hay = norm(text)
  const out: RawMetric[] = []
  for (const f of facts) {
    if (!f.quote || !hay.includes(norm(f.quote))) continue
    const nums = (f.quote.match(/-?\$?\d[\d,.]*\s?[kKmMbB]?\b/g) ?? []).map((n) => parseCompactNumber(n.replace(/\s/g, ''))).filter((n): n is number => n !== null)
    if (!nums.some((n) => Math.abs(n - f.value) <= Math.max(1, Math.abs(f.value) * 0.01))) continue
    out.push({
      metric: f.metric,
      value: f.value,
      unit: METRIC_META[f.metric].unit,
      currency: METRIC_META[f.metric].unit === 'USD' ? 'USD' : undefined,
      periodLabel: f.period_label ?? undefined,
      evidence,
      confidence: 'low',
      quote: f.quote,
      note: 'Extracted by AI; quote verified against the source text.',
    })
  }
  return out
}

/** Minimal surface of the Anthropic client we use (injectable for tests). */
export interface MessagesClient {
  beta: { messages: { create: (body: Record<string, unknown>) => Promise<{ content: { type: string; text?: string }[]; stop_reason: string | null; usage: { input_tokens: number; output_tokens: number } }> } }
}

export function createAiService(opts: { apiKey?: string; model?: string; client?: MessagesClient }): AiService {
  const model = opts.model || 'claude-opus-5-5'
  const client: MessagesClient = opts.client ?? (new Anthropic({ apiKey: opts.apiKey }) as unknown as MessagesClient)

  async function call<T>(system: string, user: string, schema: Record<string, unknown>, effort: 'low' | 'medium' | 'high', maxTokens: number): Promise<{ data: T; tokens: number }> {
    const res = await client.beta.messages.create({
      model,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    })
    if (res.stop_reason === 'refusal') throw new Error('Model declined the request')
    if (res.stop_reason === 'max_tokens') throw new Error('Model output was truncated (max_tokens)')
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    return { data: JSON.parse(text) as T, tokens: res.usage.input_tokens + res.usage.output_tokens }
  }

  return {
    model,
    async extractFacts({ text, url, evidence, productName }) {
      const src = text.slice(0, 30000)
      const { data, tokens } = await call<{ facts: { metric: MetricType; value: number; period_label: string | null; quote: string }[] }>(
        'You extract business metrics from public web pages for a research database. Only extract figures that are explicitly stated in the text. Never estimate, infer, convert or compute values. Distinguish MRR, ARR, run rate, total revenue and one-time sales exactly as stated. If nothing qualifies, return an empty list.',
        `Product: ${productName}\nSource URL: ${url}\n\nExtract every explicitly stated metric (revenue, MRR, ARR, customers, users, accounts, downloads, visits). For each, give the exact verbatim quote from the text that contains the number.\n\n<source_text>\n${src}\n</source_text>`,
        FACTS_SCHEMA,
        'low',
        4000,
      )
      return { metrics: groundFacts(src, data.facts ?? [], evidence), tokens }
    },
    async deepReport(pack: EvidencePack) {
      const evidence = {
        product: { name: pack.product.name, domain: pack.product.domain, description: pack.product.description, category: pack.product.category, business_model: pack.product.businessModel, pricing: pack.product.pricingSummary, platforms: pack.product.platforms },
        mentions: pack.mentions.map((m) => ({ id: m.id, source: m.sourceId, url: m.url, title: m.title, excerpt: m.excerpt, published: m.publishedAt })),
        observations: pack.observations.map((o) => ({ id: o.id, metric: o.metric, value: o.value, unit: o.unit, period: o.periodLabel, as_of: o.asOf, evidence: o.evidence, source: o.sourceId, attribution: o.attribution, note: o.note })),
        related: pack.relationships.map((r) => r.relatedName),
      }
      const { data, tokens } = await call<Record<string, unknown>>(
        [
          'You are a startup research analyst. Write a grounded research report from the supplied evidence only.',
          'Rules: every item in facts, demand_evidence, revenue_claims and acquisition_channels must cite one or more evidence ids (mention or observation ids) that directly support it.',
          'Keep the evidence class explicit: say "verified", "founder-reported" or "third-party estimate". Never present estimates as verified. Checkout-page visits are not purchases. Traffic estimates are not analytics. Ad longevity is not proof of profitability.',
          'Put your own reading in interpretation, and anything not directly supported in speculation. Do not invent numbers, dates, customers or funding.',
          'opportunities: concrete ideas a small product team could build or position against, each tied to the evidence. technical_complexity: one short paragraph on build complexity.',
        ].join('\n'),
        `<evidence>\n${JSON.stringify(evidence)}\n</evidence>`,
        REPORT_SCHEMA,
        'medium',
        16000,
      )
      const known = new Set([...pack.mentions.map((m) => m.id), ...pack.observations.map((o) => o.id)])
      const facts = (k: string) =>
        ((data[k] as { text: string; evidence_ids: string[] }[]) ?? [])
          .map((f) => ({ text: f.text, evidenceIds: f.evidence_ids.filter((id) => known.has(id)) }))
          .filter((f) => f.evidenceIds.length > 0) // ungrounded "facts" are dropped
      const content: ResearchReport['content'] = {
        whatItDoes: (data.what_it_does as string) ?? null,
        whoItServes: (data.who_it_serves as string) ?? null,
        howItMakesMoney: (data.how_it_makes_money as string) ?? null,
        facts: facts('facts'),
        demandEvidence: facts('demand_evidence'),
        revenueClaims: facts('revenue_claims'),
        acquisitionChannels: facts('acquisition_channels'),
        competitors: (data.competitors as string[]) ?? [],
        interpretation: (data.interpretation as string[]) ?? [],
        speculation: (data.speculation as string[]) ?? [],
        technicalComplexity: (data.technical_complexity as string) ?? null,
        opportunities: (data.opportunities as string[]) ?? [],
        caveats: (data.caveats as string[]) ?? [],
      }
      return { content, tokens }
    },
    async analyzeAd(ad: Advertisement): Promise<AdAnalysis | null> {
      const text = [ad.headline, ad.body].filter(Boolean).join('\n')
      if (!text) return null
      const { data } = await call<Record<string, string>>(
        'You analyze advertising creatives for marketing research. Describe only what the ad text shows. Do not speculate about spend or performance.',
        `Platform: ${ad.platform}\nAdvertiser: ${ad.advertiser ?? 'unknown'}\nLanding: ${ad.landingUrl ?? 'unknown'}\n\n<ad_text>\n${text}\n</ad_text>\n\nFormat should be one of: UGC testimonial, Product demonstration, Founder-led video, Before/after comparison, Educational explainer, Problem/solution, Static offer, Other.`,
        AD_SCHEMA,
        'low',
        2000,
      )
      return {
        hook: data.hook, audience: data.audience, emotionalAppeal: data.emotional_appeal, valueProposition: data.value_proposition,
        callToAction: data.call_to_action, format: data.format, angle: data.angle, generator: 'ai', model,
      }
    },
  }
}
