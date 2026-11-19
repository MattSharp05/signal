import { Bell, BellRing, Bookmark, BookmarkCheck, FolderPlus, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from '@/components/ui/overlay'
import { useCollectionMutations, useSaveMutation, useSettings, useTrackMutation, useUserState } from '@/data/hooks'
import { cn } from '@/lib/utils'

export function SaveButton({ productId, withLabel }: { productId: string; withLabel?: boolean }) {
  const user = useUserState().data
  const save = useSaveMutation()
  const cols = useCollectionMutations()
  const [newName, setNewName] = useState('')
  const isSaved = user.saved.some((s) => s.productId === productId)
  const inCols = new Set(user.collectionProducts.filter((c) => c.productId === productId).map((c) => c.collectionId))
  const Icon = isSaved ? BookmarkCheck : Bookmark
  return (
    <DropdownMenu>
      <Tooltip content={isSaved ? 'Saved — manage collections' : 'Save to revisit later'}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={withLabel ? 'sm' : 'icon-sm'} className={cn(isSaved && 'text-accent hover:text-accent')} onClick={(e) => e.stopPropagation()} aria-label={isSaved ? 'Saved' : 'Save'}>
            <Icon />
            {withLabel ? (isSaved ? 'Saved' : 'Save') : null}
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()} className="w-56">
        <DropdownMenuItem onSelect={() => save.mutate({ productId, saved: !isSaved })}>
          <Icon /> {isSaved ? 'Remove from saved' : 'Save'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Collections</DropdownMenuLabel>
        {user.collections.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onSelect={(e) => {
              e.preventDefault()
              if (inCols.has(c.id)) cols.removeProduct.mutate({ collectionId: c.id, productId })
              else cols.add.mutate({ collectionId: c.id, productId })
            }}
          >
            <FolderPlus /> <span className="flex-1 truncate">{c.name}</span>
            {inCols.has(c.id) ? <span className="text-2xs text-accent">Added</span> : null}
          </DropdownMenuItem>
        ))}
        <form
          className="flex items-center gap-1 p-1"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!newName.trim()) return
            const c = await cols.create.mutateAsync(newName.trim())
            cols.add.mutate({ collectionId: c.id, productId })
            setNewName('')
          }}
        >
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="New collection" className="h-7 text-xs" />
          <Button type="submit" size="icon-sm" variant="ghost" aria-label="Create collection">
            <Plus />
          </Button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TrackingButton({ productId, withLabel }: { productId: string; withLabel?: boolean }) {
  const user = useUserState().data
  const settings = useSettings().data
  const track = useTrackMutation()
  const entry = user.tracked.find((t) => t.productId === productId)
  const Icon = entry ? BellRing : Bell
  return (
    <DropdownMenu>
      <Tooltip content={entry ? `Tracking — notifies on changes with significance ≥ ${entry.minSignificance}` : 'Track: monitor sources for revenue, traffic, pricing, ads and new mentions'}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={withLabel ? 'sm' : 'icon-sm'} className={cn(entry && 'text-accent hover:text-accent')} onClick={(e) => e.stopPropagation()} aria-label={entry ? 'Tracking' : 'Track'}>
            <Icon />
            {withLabel ? (entry ? 'Tracking' : 'Track') : null}
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()} className="w-60">
        <DropdownMenuLabel>Notify me about</DropdownMenuLabel>
        {[
          { v: 30, label: 'All changes and new mentions' },
          { v: 50, label: 'Significant changes (default)' },
          { v: 75, label: 'Major changes only' },
        ].map((o) => (
          <DropdownMenuItem key={o.v} onSelect={() => track.mutate({ productId, tracked: true, minSignificance: o.v })}>
            <span className={cn('size-1.5 rounded-full', entry?.minSignificance === o.v ? 'bg-accent' : 'bg-transparent')} />
            {o.label}
          </DropdownMenuItem>
        ))}
        {entry ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => track.mutate({ productId, tracked: false })}>Stop tracking</DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => track.mutate({ productId, tracked: true, minSignificance: settings?.defaultMinSignificance ?? 50 })}>
              <BellRing /> Track with defaults
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
