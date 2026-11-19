import type { Product } from '@core/types.ts'
import { Lightbulb, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ProductLogo } from '@/components/product/atoms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, Sheet } from '@/components/ui/overlay'
import { useAllProducts, useOpportunities } from '@/data/hooks'
import type { OpportunityRow } from '@/data/repository'
import { cn, timeAgo } from '@/lib/utils'

const STATUSES: { value: OpportunityRow['status']; label: string }[] = [
  { value: 'idea', label: 'Idea' },
  { value: 'researching', label: 'Researching' },
  { value: 'validating', label: 'Validating' },
  { value: 'planned', label: 'Planned' },
  { value: 'building', label: 'Building' },
  { value: 'archived', label: 'Archived' },
]

function ProductPicker({ value, onChange, products }: { value: string[]; onChange: (ids: string[]) => void; products: Product[] }) {
  const [q, setQ] = useState('')
  const by = new Map(products.map((p) => [p.id, p]))
  const matches = q ? products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) && !value.includes(p.id)).slice(0, 6) : []
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {value.map((id) => (
          <Badge key={id} tone="neutral" className="h-6 gap-1 pr-1 text-xs font-normal">
            {by.get(id)?.name ?? 'Unknown'}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label="Remove">
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input placeholder="Search products to link…" value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.length ? (
        <ul className="rounded-md border border-border">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] hover:bg-surface" onClick={() => { onChange([...value, p.id]); setQ('') }}>
                <ProductLogo product={p} size={20} /> {p.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Editor({ initial, onClose }: { initial: Partial<OpportunityRow>; onClose: () => void }) {
  const { save, remove } = useOpportunities()
  const products = useAllProducts().data ?? []
  const [o, setO] = useState<Partial<OpportunityRow>>({ status: 'idea', productIds: [], mvpComplexity: '', ...initial })
  const field = (k: keyof OpportunityRow, label: string, rows = 2, placeholder = '') => (
    <div>
      <Label>{label}</Label>
      <Textarea className="mt-1" rows={rows} placeholder={placeholder} value={(o[k] as string) ?? ''} onChange={(e) => setO({ ...o, [k]: e.target.value })} />
    </div>
  )
  return (
    <form
      className="flex h-full flex-col"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!o.title?.trim()) return
        await save.mutateAsync({ ...o, title: o.title.trim() })
        onClose()
      }}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
        <span className="text-[13px] font-semibold">{o.id ? 'Edit opportunity' : 'New opportunity'}</span>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <div>
          <Label>Title</Label>
          <Input className="mt-1" required value={o.title ?? ''} onChange={(e) => setO({ ...o, title: e.target.value })} placeholder="e.g. Group-chat analysis for sports teams" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Status</Label>
            <NativeSelect className="mt-1 w-full" value={o.status} onChange={(e) => setO({ ...o, status: e.target.value as OpportunityRow['status'] })}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label>MVP complexity</Label>
            <NativeSelect className="mt-1 w-full" value={o.mvpComplexity} onChange={(e) => setO({ ...o, mvpComplexity: e.target.value as OpportunityRow['mvpComplexity'] })}>
              <option value="">Not assessed</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </NativeSelect>
          </div>
        </div>
        {field('description', 'Description', 3)}
        <div>
          <Label>Inspiration products</Label>
          <div className="mt-1">
            <ProductPicker value={o.productIds ?? []} onChange={(ids) => setO({ ...o, productIds: ids })} products={products} />
          </div>
        </div>
        {field('targetAudience', 'Target audience')}
        {field('monetization', 'Monetization hypothesis')}
        {field('distribution', 'Distribution strategy')}
        {field('competitors', 'Competitors')}
        {field('feasibility', 'Technical feasibility')}
        {field('notes', 'Research notes', 4)}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
        {o.id ? (
          <Button type="button" variant="danger" size="sm" onClick={async () => { await remove.mutateAsync(o.id!); onClose() }}>
            <Trash2 /> Delete
          </Button>
        ) : <span />}
        <Button type="submit" variant="primary" disabled={save.isPending}>Save</Button>
      </div>
    </form>
  )
}

export default function Opportunities() {
  const { data, isLoading } = useOpportunities()
  const products = useAllProducts().data ?? []
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const [editing, setEditing] = useState<Partial<OpportunityRow> | null>(null)
  const [statusFilter, setStatusFilter] = useState<OpportunityRow['status'] | 'all'>('all')
  const list = (data ?? []).filter((o) => (statusFilter === 'all' ? o.status !== 'archived' : o.status === statusFilter))

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Opportunities"
        description="Ideas your team could build, each inspired by one or more discovered products. A product is evidence; an opportunity is a hypothesis."
        actions={<Button variant="primary" onClick={() => setEditing({})}><Plus /> New opportunity</Button>}
      />
      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-8">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {[{ value: 'all' as const, label: 'Active' }, ...STATUSES].map((s) => {
            const n = s.value === 'all' ? (data ?? []).filter((o) => o.status !== 'archived').length : (data ?? []).filter((o) => o.status === s.value).length
            return (
              <button key={s.value} onClick={() => setStatusFilter(s.value)} className={cn('h-7 rounded-md border px-2.5 text-xs font-medium', statusFilter === s.value ? 'border-text bg-text text-white' : 'border-border text-muted hover:text-text')}>
                {s.label} <span className="ml-0.5 opacity-60">{n}</span>
              </button>
            )
          })}
        </div>
        {isLoading ? null : list.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {list.map((o) => (
              <button key={o.id} onClick={() => setEditing(o)} className="rounded-lg border border-border p-4 text-left transition-colors hover:border-border-strong">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[14px] font-semibold leading-snug">{o.title}</h3>
                  <Badge tone={o.status === 'building' ? 'positive' : o.status === 'idea' ? 'neutral' : 'accent'} className="shrink-0">{STATUSES.find((s) => s.value === o.status)?.label}</Badge>
                </div>
                {o.description ? <p className="mt-1 line-clamp-2 text-[13px] text-muted">{o.description}</p> : null}
                <dl className="mt-3 grid grid-cols-[96px_1fr] gap-x-2 gap-y-0.5 text-xs">
                  {o.targetAudience ? <><dt className="text-muted">Audience</dt><dd className="truncate">{o.targetAudience}</dd></> : null}
                  {o.monetization ? <><dt className="text-muted">Monetization</dt><dd className="truncate">{o.monetization}</dd></> : null}
                  {o.mvpComplexity ? <><dt className="text-muted">MVP</dt><dd className="capitalize">{o.mvpComplexity} complexity</dd></> : null}
                </dl>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex -space-x-1.5">
                    {o.productIds.slice(0, 5).map((id) => {
                      const p = byId.get(id)
                      return p ? <span key={id} className="rounded-md ring-2 ring-bg"><ProductLogo product={p} size={22} /></span> : null
                    })}
                    {o.productIds.length === 0 ? <span className="text-2xs text-subtle">No inspiration products</span> : null}
                  </div>
                  <span className="text-2xs text-subtle">updated {timeAgo(o.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon={<Lightbulb />} title="No opportunities yet" action={<Button variant="primary" size="sm" onClick={() => setEditing({})}><Plus /> New opportunity</Button>}>
            Create one here, or use “Opportunity” on any product profile to start from its evidence.
          </EmptyState>
        )}
      </div>
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Opportunity">
        {editing ? <Editor initial={editing} onClose={() => setEditing(null)} /> : null}
      </Sheet>
    </div>
  )
}
