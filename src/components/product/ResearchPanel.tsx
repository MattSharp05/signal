import { Loader2, Maximize2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { EmptyState, Sheet, Tooltip } from '@/components/ui/overlay'
import { useProduct } from '@/data/hooks'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { ProductProfile, ProfileHeader } from './ProductProfile'

const KEY = 'signal.panelWidth'
const MIN = 380
const MAX = 860

function readWidth() {
  try {
    const v = Number(localStorage.getItem(KEY))
    return v >= MIN && v <= MAX ? v : 520
  } catch {
    return 520
  }
}

function PanelBody({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { data, isLoading } = useProduct(slug)
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-2xs font-semibold uppercase tracking-wider text-subtle">Research</span>
        <div className="flex items-center gap-0.5">
          {data ? (
            <Tooltip content="Open full profile">
              <Button asChild variant="ghost" size="icon-sm">
                <Link to={`/p/${data.product.slug}`} aria-label="Open full profile">
                  <Maximize2 />
                </Link>
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip content="Close (Esc)">
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close research panel">
              <X />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : data ? (
          <div className="space-y-4">
            <ProfileHeader d={data} onNavigateFull />
            <ProductProfile d={data} />
          </div>
        ) : (
          <EmptyState title="Product not found" />
        )}
      </div>
    </div>
  )
}

/** Right-side research panel: resizable on desktop, full-screen drawer on smaller screens. */
export function ResearchPanel({ slug, onClose }: { slug: string | null; onClose: () => void }) {
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [width, setWidth] = useState(readWidth)
  const dragging = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && slug && desktop) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slug, desktop, onClose])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const w = Math.min(MAX, Math.max(MIN, window.innerWidth - e.clientX))
    setWidth(w)
  }, [])
  const onPointerUp = useCallback(() => {
    dragging.current = false
    try {
      localStorage.setItem(KEY, String(width))
    } catch {
      /* ignore */
    }
  }, [width])

  if (!slug) return null
  if (!desktop) {
    return (
      <Sheet open onOpenChange={(o) => !o && onClose()} title="Product research">
        <PanelBody slug={slug} onClose={onClose} />
      </Sheet>
    )
  }
  return (
    <aside className="relative flex h-full shrink-0 border-l border-border bg-bg" style={{ width }} aria-label="Research panel">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize research panel"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setWidth((w) => Math.min(MAX, w + 24))
          if (e.key === 'ArrowRight') setWidth((w) => Math.max(MIN, w - 24))
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/20 focus-visible:bg-accent/30"
      />
      <div className="min-w-0 flex-1">
        <PanelBody slug={slug} onClose={onClose} />
      </div>
    </aside>
  )
}
