import type { AdAnalysis, Advertisement, EvidenceClass, MetricObservation, Product, ProductRelationship, RawMetric, ResearchReport, SourceMention } from './types.ts'

export interface EvidencePack {
  product: Product
  mentions: SourceMention[]
  observations: MetricObservation[]
  relationships: ProductRelationship[]
  ads: Advertisement[]
  /** extra page text (e.g. homepage) for context, already public */
  texts: { mentionId: string; text: string }[]
}

/** AI capabilities used by the pipeline. Implemented in ai.ts with the Anthropic SDK; absent when no key is configured. */
export interface AiService {
  model: string
  extractFacts(input: { text: string; url: string; evidence: EvidenceClass; productName: string }): Promise<{ metrics: RawMetric[]; tokens: number }>
  deepReport(pack: EvidencePack): Promise<{ content: ResearchReport['content']; tokens: number }>
  analyzeAd(ad: Advertisement): Promise<AdAnalysis | null>
}
