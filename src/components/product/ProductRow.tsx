import type { Product } from '@core/types.ts'
import { useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { SaveButton, TrackingButton } from './actions'
import { ProductLogo, StageBadge } from './atoms'
import { ProductMetrics } from './metrics'

/** Dense list row used on Watchlist, Trends and Opportunities. */
export function ProductRow({ product: p, right, className, showMetrics = true }: { product: Product; right?: React.ReactNode; className?: string; showMetrics?: boolean }) {
  const [params, setParams] = useSearchParams()
  const selected = params.get('p') === p.slug
  return (
    <div
      className={cn('flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-sidebar', selected && 'bg-accent-soft/60', className)}
      onClick={() => setParams((prev) => { const n = new URLSearchParams(prev); n.set('p', p.slug); return n })}
    >
      <ProductLogo product={p} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold">{p.name}</span>
          <StageBadge stage={p.stage} />
        </div>
        <div className="truncate text-xs text-muted">{p.tagline ?? p.description ?? p.domain}</div>
      </div>
      {showMetrics ? <ProductMetrics summary={p.summaryMetrics} className="hidden w-64 shrink-0 lg:grid" /> : null}
      {right}
      <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
        <SaveButton productId={p.id} />
        <TrackingButton productId={p.id} />
      </div>
    </div>
  )
}
