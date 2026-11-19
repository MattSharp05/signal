import { Bell, Bookmark, CheckCheck, Folder, Inbox, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { ProductLogo } from '@/components/product/atoms'
import { ProductRow } from '@/components/product/ProductRow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/overlay'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCollectionMutations, useProductsByIds, useUpdates, useUserState } from '@/data/hooks'
import { cn, timeAgo } from '@/lib/utils'

function Updates() {
  const { data, markRead } = useUpdates()
  const [, setParams] = useSearchParams()
  const unread = (data ?? []).filter((u) => !u.read)
  if (!data?.length)
    return (
      <EmptyState icon={<Inbox />} title="No updates yet">
        Track a product to be notified about significant changes: revenue milestones, traffic swings, pricing changes, new ads and new source mentions. Insignificant changes are filtered by your threshold.
      </EmptyState>
    )
  return (
    <div>
      <div className="flex items-center justify-between px-3 pb-2">
        <span className="text-xs text-muted">{unread.length} unread</span>
        {unread.length ? (
          <Button variant="ghost" size="sm" onClick={() => markRead.mutate(unread.map((u) => u.id))}>
            <CheckCheck /> Mark all read
          </Button>
        ) : null}
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {data.map((u) => (
          <li
            key={u.id}
            className={cn('flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-sidebar', !u.read && 'bg-accent-soft/40')}
            onClick={() => {
              setParams((p) => { const n = new URLSearchParams(p); n.set('p', u.product.slug); return n })
              if (!u.read) markRead.mutate([u.id])
            }}
          >
            <ProductLogo product={u.product} size={28} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[13px]">
                  <span className="font-semibold">{u.product.name}</span> · {u.event.title}
                </p>
                <span className="shrink-0 text-2xs text-subtle">{timeAgo(u.event.occurredAt)}</span>
              </div>
              {u.event.detail ? <p className="text-xs text-muted">{u.event.detail}</p> : null}
            </div>
            <Badge tone={u.event.significance >= 75 ? 'accent' : 'neutral'} className="shrink-0">{u.event.significance}</Badge>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Watchlist() {
  const user = useUserState().data
  const [params, setParams] = useSearchParams()
  const collection = params.get('collection')
  const tab = params.get('tab') ?? (collection ? 'saved' : 'updates')
  const savedIds = collection ? user.collectionProducts.filter((c) => c.collectionId === collection).map((c) => c.productId) : user.saved.map((s) => s.productId)
  const saved = useProductsByIds(savedIds)
  const tracked = useProductsByIds(user.tracked.map((t) => t.productId))
  const cols = useCollectionMutations()
  const activeCollection = user.collections.find((c) => c.id === collection)
  const unread = useUpdates().data?.filter((u) => !u.read).length ?? 0

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Watchlist" description="Saved products to revisit, tracked products under active monitoring, and the updates they produce." />
      <div className="mx-auto max-w-4xl px-4 py-4 sm:px-8">
        <Tabs value={tab} onValueChange={(v) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', v); if (v !== 'saved') n.delete('collection'); return n })}>
          <TabsList>
            <TabsTrigger value="updates">Updates {unread ? <Badge tone="accent" className="ml-1 h-4 px-1">{unread}</Badge> : null}</TabsTrigger>
            <TabsTrigger value="tracked">Tracked <span className="ml-1 text-subtle">{user.tracked.length}</span></TabsTrigger>
            <TabsTrigger value="saved">Saved <span className="ml-1 text-subtle">{user.saved.length}</span></TabsTrigger>
          </TabsList>
          <TabsContent value="updates">
            <Updates />
          </TabsContent>
          <TabsContent value="tracked">
            {tracked.data?.length ? (
              <div className="divide-y divide-border rounded-lg border border-border">
                {tracked.data.map((p) => {
                  const t = user.tracked.find((x) => x.productId === p.id)
                  return <ProductRow key={p.id} product={p} right={<span className="hidden shrink-0 text-2xs text-subtle sm:block">threshold {t?.minSignificance}</span>} />
                })}
              </div>
            ) : (
              <EmptyState icon={<Bell />} title="Nothing tracked">Tracking monitors a product's sources for revenue updates, traffic changes, pricing changes, new ads, launches and new mentions.</EmptyState>
            )}
          </TabsContent>
          <TabsContent value="saved">
            {user.collections.length ? (
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <button className={cn('h-7 rounded-md border px-2.5 text-xs', !collection ? 'border-text bg-text text-white' : 'border-border text-muted')} onClick={() => setParams({ tab: 'saved' })}>
                  All saved
                </button>
                {user.collections.map((c) => (
                  <button key={c.id} className={cn('inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs', collection === c.id ? 'border-text bg-text text-white' : 'border-border text-muted')} onClick={() => setParams({ tab: 'saved', collection: c.id })}>
                    <Folder className="size-3" /> {c.name}
                  </button>
                ))}
                {activeCollection ? (
                  <Button variant="ghost" size="sm" className="ml-auto text-negative" onClick={() => { cols.remove.mutate(activeCollection.id); setParams({ tab: 'saved' }) }}>
                    <Trash2 /> Delete collection
                  </Button>
                ) : null}
              </div>
            ) : null}
            {saved.data?.length && savedIds.length ? (
              <div className="divide-y divide-border rounded-lg border border-border">
                {saved.data.map((p) => (
                  <ProductRow key={p.id} product={p} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<Bookmark />} title={activeCollection ? 'This collection is empty' : 'Nothing saved'}>
                Use the bookmark on any product card to save it and organize it into collections.
              </EmptyState>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
