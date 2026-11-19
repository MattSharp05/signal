import { shortSourceName } from '@core/connectors/index.ts'
import { EVIDENCE_DESCRIPTION, EVIDENCE_LABEL } from '@core/metrics.ts'
import type { EvidenceClass, Product, ProductStage } from '@core/types.ts'
import { BadgeCheck, CircleDashed, Info, Megaphone, Sparkles, Users } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/overlay'
import { cn } from '@/lib/utils'

export function ProductLogo({ product, size = 36 }: { product: Pick<Product, 'name' | 'logoUrl'>; size?: number }) {
  const [failed, setFailed] = useState(false)
  const letter = product.name.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '?'
  if (product.logoUrl && !failed) {
    return (
      <img
        src={product.logoUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-md border border-border bg-bg object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div className="flex shrink-0 items-center justify-center rounded-md border border-border bg-surface font-semibold text-muted" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {letter}
    </div>
  )
}

const EVIDENCE_STYLE: Record<EvidenceClass, { tone: 'positive' | 'accent' | 'neutral' | 'warning' | 'outline'; icon: React.ReactNode }> = {
  verified: { tone: 'positive', icon: <BadgeCheck /> },
  platform_metric: { tone: 'neutral', icon: <Users /> },
  founder_reported: { tone: 'accent', icon: <Megaphone /> },
  third_party_estimate: { tone: 'warning', icon: <CircleDashed /> },
  ai_estimate: { tone: 'warning', icon: <Sparkles /> },
  unknown: { tone: 'outline', icon: <Info /> },
}

/** Evidence class label — the core trust signal. */
export function ConfidenceIndicator({ evidence, compact, className }: { evidence: EvidenceClass; compact?: boolean; className?: string }) {
  const s = EVIDENCE_STYLE[evidence]
  return (
    <Tooltip content={<><b>{EVIDENCE_LABEL[evidence]}.</b> {EVIDENCE_DESCRIPTION[evidence]}</>}>
      <span className={cn('inline-flex', className)}>
        <Badge tone={s.tone} className={compact ? 'h-4 px-1' : ''}>
          {s.icon}
          {compact ? null : EVIDENCE_LABEL[evidence]}
        </Badge>
      </span>
    </Tooltip>
  )
}

export function EvidenceDot({ evidence }: { evidence: EvidenceClass }) {
  const color = { verified: 'bg-positive', platform_metric: 'bg-subtle', founder_reported: 'bg-accent', third_party_estimate: 'bg-warning', ai_estimate: 'bg-warning', unknown: 'bg-border-strong' }[evidence]
  return (
    <Tooltip content={`${EVIDENCE_LABEL[evidence]} — ${EVIDENCE_DESCRIPTION[evidence]}`}>
      <span className={cn('inline-block size-1.5 shrink-0 rounded-full', color)} aria-label={EVIDENCE_LABEL[evidence]} />
    </Tooltip>
  )
}

export function SourceBadge({ sourceId, className }: { sourceId: string; className?: string }) {
  return (
    <Badge tone="outline" className={cn('font-normal', className)}>
      {shortSourceName(sourceId)}
    </Badge>
  )
}

export function SourceBadges({ sourceIds, max = 3 }: { sourceIds: string[]; max?: number }) {
  const ids = sourceIds.filter((s) => s !== 'manual')
  const shown = ids.slice(0, max)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((s) => (
        <SourceBadge key={s} sourceId={s} />
      ))}
      {ids.length > max ? <span className="text-2xs text-muted">+{ids.length - max}</span> : null}
    </div>
  )
}

const STAGE: Record<ProductStage, { label: string; tone: 'accent' | 'positive' | 'neutral' | 'outline' }> = {
  new_launch: { label: 'New launch', tone: 'accent' },
  early_traction: { label: 'Early traction', tone: 'neutral' },
  established: { label: 'Established', tone: 'positive' },
  unknown: { label: 'Unproven', tone: 'outline' },
}

export function StageBadge({ stage }: { stage: ProductStage }) {
  const s = STAGE[stage]
  return (
    <Tooltip content={stage === 'unknown' ? 'No traction evidence collected yet' : undefined}>
      <span className="inline-flex">
        <Badge tone={s.tone}>{s.label}</Badge>
      </span>
    </Tooltip>
  )
}

export function DataOriginBadge({ origin }: { origin: Product['dataOrigin'] }) {
  if (origin === 'pipeline') return null
  return (
    <Tooltip content={origin === 'snapshot' ? 'Collected by the ingestion pipeline into a local snapshot (Local mode). Real data, not live.' : 'Development fixture — not real research data.'}>
      <span className="inline-flex">
        <Badge tone="outline" className="border-dashed">{origin === 'snapshot' ? 'Snapshot' : 'Fixture'}</Badge>
      </span>
    </Tooltip>
  )
}
