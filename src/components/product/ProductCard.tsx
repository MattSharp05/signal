import type { Product } from '@core/types.ts'
import { ChevronDown, ExternalLink, Loader2, PanelRightOpen } from 'lucide-react'
import { memo } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/overlay'
import { useProduct } from '@/data/hooks'
import { cn, timeAgo } from '@/lib/utils'
import { SaveButton, TrackingButton } from './actions'
import { DataOriginBadge, ProductLogo, SourceBadges, StageBadge } from './atoms'
import { ProductMetrics } from './metrics'
import { ProductReport } from './report'

interface Props {
  product: Product
  selected: boolean
  expanded: boolean
  onSelect: (p: Product) => void
  onToggleExpand: (p: Product) => void
}

function ExpandedBody({ slug }: { slug: string }) {
  const { data, isLoading } = useProduct(slug)
  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 py-6 text-[13px] text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading report…
      </div>
    )
  }
  return (
    <div className="animate-in">
      <ProductReport d={data} compact />
      <div className="mt-4 border-t border-border pt-3">
        <Link to={`/p/${data.product.slug}`} className="text-[13px] font-medium text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
          Open full profile →
        </Link>
      </div>
    </div>
  )
}

export const ProductCard = memo(function ProductCard({ product: p, selected, expanded, onSelect, onToggleExpand }: Props) {
  const otherSources = p.sourceIds.filter((s) => s !== 'manual' && s !== 'website').length
  return (
    <article
      className={cn(
        'group relative cursor-pointer rounded-lg border bg-bg px-4 py-3.5 transition-colors',
        selected ? 'border-accent/60 ring-1 ring-accent/20' : 'border-border hover:border-border-strong',
      )}
      onClick={() => onSelect(p)}
      aria-selected={selected}
    >
      <div className="flex gap-3">
        <ProductLogo product={p} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="truncate text-[15px] font-semibold leading-tight">{p.name}</h2>
                {p.domain ? <span className="truncate text-xs text-subtle">{p.domain}</span> : null}
              </div>
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{p.tagline ?? p.description ?? 'No description collected yet.'}</p>
            </div>
            <div className="-mr-1.5 -mt-1 flex shrink-0 items-center opacity-80 group-hover:opacity-100">
              <SaveButton productId={p.id} />
              <TrackingButton productId={p.id} />
              {p.websiteUrl ? (
                <Tooltip content="Open website">
                  <Button asChild variant="ghost" size="icon-sm">
                    <a href={p.websiteUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="Open website">
                      <ExternalLink />
                    </a>
                  </Button>
                </Tooltip>
              ) : null}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
            <StageBadge stage={p.stage} />
            {p.category ? <span>{p.category}</span> : null}
            {p.platforms.length ? <span className="text-subtle">· {p.platforms.slice(0, 2).join(', ')}</span> : null}
            <DataOriginBadge origin={p.dataOrigin} />
          </div>

          <ProductMetrics summary={p.summaryMetrics} className="mt-3" />

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <SourceBadges sourceIds={p.sourceIds} />
              {otherSources > 1 ? <span className="hidden text-2xs text-subtle sm:inline">{otherSources} sources</span> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="mr-1 hidden text-2xs text-subtle sm:inline">{timeAgo(p.lastUpdatedAt)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleExpand(p)
                }}
                aria-expanded={expanded}
              >
                <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
                {expanded ? 'Collapse' : 'Expand'}
              </Button>
              <Tooltip content="Open in research panel">
                <Button variant="ghost" size="icon-sm" className="hidden h-6 w-6 lg:inline-flex" onClick={(e) => { e.stopPropagation(); onSelect(p) }} aria-label="Open in research panel">
                  <PanelRightOpen />
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
      {expanded ? (
        <div className="mt-4 border-t border-border pt-4" onClick={(e) => e.stopPropagation()}>
          <ExpandedBody slug={p.slug} />
        </div>
      ) : null}
    </article>
  )
})
