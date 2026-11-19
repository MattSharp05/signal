import type { Product } from '@core/types.ts'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Activity, Loader2, Search, SearchX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AddProductDialog } from '@/components/feed/AddProductDialog'
import { FilterBar, SORTS } from '@/components/feed/FilterBar'
import { ProductCard } from '@/components/product/ProductCard'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/input'
import { EmptyState, Skeleton } from '@/components/ui/overlay'
import { useFeed, useRecentEvents, useSources } from '@/data/hooks'
import type { FeedFilters } from '@/data/repository'
import { timeAgo } from '@/lib/utils'

const FILTER_KEYS = ['q', 'category', 'platform', 'stage', 'quick', 'revenueMin', 'revenueMax', 'growthMin', 'businessModel', 'source', 'savedOnly', 'trackedOnly', 'maxAgeDays', 'evidence', 'sort'] as const
const NUMERIC = new Set(['revenueMin', 'revenueMax', 'growthMin', 'maxAgeDays'])
const BOOL = new Set(['savedOnly', 'trackedOnly'])

function readFilters(params: URLSearchParams): FeedFilters {
  const f: Record<string, unknown> = { sort: 'discovered' }
  for (const k of FILTER_KEYS) {
    const v = params.get(k)
    if (v === null || v === '') continue
    f[k] = NUMERIC.has(k) ? Number(v) : BOOL.has(k) ? v === '1' : v
  }
  return f as unknown as FeedFilters
}

function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border px-4 py-3.5">
      <div className="flex gap-3">
        <Skeleton className="size-10 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full max-w-md" />
          <div className="grid grid-cols-3 gap-3 pt-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        </div>
      </div>
    </div>
  )
}

function RecentStrip() {
  const { data } = useRecentEvents(40)
  const [, setParams] = useSearchParams()
  const significant = (data ?? []).filter((e) => e.type !== 'discovered' && e.significance >= 40).slice(0, 4)
  if (!significant.length) return null
  return (
    <div className="flex items-center gap-3 overflow-x-auto rounded-lg border border-border bg-sidebar px-3 py-2 text-xs">
      <span className="flex shrink-0 items-center gap-1.5 font-medium text-muted">
        <Activity className="size-3.5" /> Updates
      </span>
      {significant.map((e) => (
        <button
          key={e.id}
          className="shrink-0 truncate text-left hover:text-accent"
          onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set('p', e.product.slug); return n })}
        >
          <span className="font-medium">{e.product.name}</span> <span className="text-muted">· {e.title} · {timeAgo(e.occurredAt)}</span>
        </button>
      ))}
    </div>
  )
}

export default function Discover() {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => readFilters(params), [params])
  const [q, setQ] = useState(filters.q ?? '')
  const selected = params.get('p')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)
  const { sources } = useSources()

  const setFilters = useCallback(
    (f: FeedFilters) => {
      setParams(
        (prev) => {
          const n = new URLSearchParams()
          for (const k of FILTER_KEYS) {
            const v = (f as unknown as Record<string, unknown>)[k]
            if (v === undefined || v === null || v === '' || v === false || (k === 'sort' && v === 'discovered')) continue
            n.set(k, v === true ? '1' : String(v))
          }
          const p = prev.get('p')
          if (p) n.set('p', p)
          return n
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // debounce search into the URL
  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.q ?? '') !== q) setFilters({ ...filters, q: q || undefined })
    }, 200)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const feed = useFeed(filters)
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data])
  const total = feed.data?.pages[0]?.total ?? null

  const scrollRef = useRef<HTMLDivElement>(null)
  const initialOffset = useMemo(() => {
    try {
      return Number(sessionStorage.getItem('signal.feedScroll')) || 0
    } catch {
      return 0
    }
  }, [])
  const virtualizer = useVirtualizer({
    count: items.length + (feed.hasNextPage ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 196,
    overscan: 6,
    gap: 10,
    initialOffset,
    getItemKey: (i) => items[i]?.id ?? `loader-${i}`,
  })
  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1]
    if (last && last.index >= items.length - 1 && feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage()
  }, [virtualItems, items.length, feed])

  const onSelect = useCallback(
    (p: Product) =>
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev)
          n.set('p', p.slug)
          return n
        },
        { replace: false },
      ),
    [setParams],
  )
  const onToggleExpand = useCallback((p: Product) => {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(p.id)) n.delete(p.id)
      else n.add(p.id)
      return n
    })
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 space-y-3 border-b border-border px-4 pb-3 pt-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products, companies, domains, categories, business models…"
              className="h-9 w-full rounded-md border border-border bg-bg pl-8 pr-12 text-[13px] placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
              aria-label="Search"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-2xs text-subtle sm:block">/</kbd>
          </div>
          <div className="hidden sm:block">
            <AddProductDialog />
          </div>
          <div className="sm:hidden">
            <AddProductDialog compact />
          </div>
        </div>
        <FilterBar filters={filters} onChange={setFilters} sources={(sources.data ?? []).filter((s) => s.role !== 'enrichment' && s.status !== 'unsupported').map((s) => ({ id: s.id, name: s.name }))} />
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          try {
            sessionStorage.setItem('signal.feedScroll', String((e.target as HTMLDivElement).scrollTop))
          } catch {
            /* ignore */
          }
        }}
      >
        <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs text-muted">
              {feed.isLoading ? 'Loading…' : total !== null ? <><span className="tnum font-medium text-text">{total.toLocaleString()}</span> products</> : null}
              {feed.isFetching && !feed.isLoading ? <Loader2 className="ml-2 inline size-3 animate-spin" /> : null}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              Sort
              <NativeSelect value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as FeedFilters['sort'] })} className="h-7 text-xs">
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
          {!filters.q && !filters.category && !filters.quick ? (
            <div className="mb-3">
              <RecentStrip />
            </div>
          ) : null}

          {feed.isLoading ? (
            <div className="space-y-2.5">
              {Array.from({ length: 5 }, (_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : feed.isError ? (
            <EmptyState title="Could not load the feed">{(feed.error as Error).message}</EmptyState>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<SearchX />}
              title="No products match"
              action={
                <Button variant="secondary" size="sm" onClick={() => { setQ(''); setFilters({ sort: filters.sort }) }}>
                  Clear search and filters
                </Button>
              }
            >
              Try a broader search, or add the product by URL.
            </EmptyState>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualItems.map((v) => {
                const p = items[v.index]
                return (
                  <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}>
                    {p ? (
                      <ProductCard product={p} selected={selected === p.slug} expanded={expanded.has(p.id)} onSelect={onSelect} onToggleExpand={onToggleExpand} />
                    ) : (
                      <div className="flex justify-center py-6 text-muted">
                        <Loader2 className="size-4 animate-spin" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
