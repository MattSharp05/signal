import { CATEGORIES } from '@core/categorize.ts'
import { SlidersHorizontal, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label, NativeSelect } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import type { FeedFilters, FeedSort } from '@/data/repository'
import { cn } from '@/lib/utils'

export const SORTS: { value: FeedSort; label: string }[] = [
  { value: 'discovered', label: 'Recently discovered' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'trending', label: 'Trending' },
  { value: 'revenue', label: 'Highest reported revenue' },
  { value: 'growth', label: 'Fastest growth' },
  { value: 'sources', label: 'Most sources' },
  { value: 'launched', label: 'Recently launched' },
]

const QUICK: { value: NonNullable<FeedFilters['quick']>; label: string }[] = [
  { value: 'new', label: 'New launches' },
  { value: 'trending', label: 'Trending' },
  { value: 'revenue', label: 'Has revenue' },
]

const CHIP_CATEGORIES = ['Consumer AI', 'AI Utility', 'Developer Tools', 'Productivity', 'Marketing', 'Relationships & Social', 'Education', 'Design & Creative', 'Video & Audio', 'Finance']

const PLATFORMS = ['Web', 'iOS', 'Android', 'Browser extension', 'macOS', 'API', 'CLI', 'Open source']

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-7 shrink-0 rounded-md border px-2.5 text-xs font-medium transition-colors',
        active ? 'border-text bg-text text-white' : 'border-border bg-bg text-muted hover:border-border-strong hover:text-text',
      )}
    >
      {children}
    </button>
  )
}

export function advancedCount(f: FeedFilters): number {
  return [f.platform, f.stage, f.revenueMin, f.revenueMax, f.growthMin, f.businessModel, f.source, f.savedOnly, f.trackedOnly, f.maxAgeDays, f.evidence, f.category && !CHIP_CATEGORIES.includes(f.category) ? f.category : null].filter(
    (v) => v !== undefined && v !== null && v !== false && v !== '',
  ).length
}

export function FilterBar({ filters, onChange, sources }: { filters: FeedFilters; onChange: (f: FeedFilters) => void; sources: { id: string; name: string }[] }) {
  const set = (patch: Partial<FeedFilters>) => onChange({ ...filters, ...patch })
  const n = advancedCount(filters)
  return (
    <div className="flex items-center gap-2">
      <div className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 py-0.5">
        {QUICK.map((q) => (
          <Chip key={q.value} active={filters.quick === q.value} onClick={() => set({ quick: filters.quick === q.value ? null : q.value })}>
            {q.label}
          </Chip>
        ))}
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        {CHIP_CATEGORIES.map((c) => (
          <Chip key={c} active={filters.category === c} onClick={() => set({ category: filters.category === c ? undefined : c })}>
            {c}
          </Chip>
        ))}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" className="shrink-0">
            <SlidersHorizontal /> Filters {n ? <Badge tone="accent" className="h-4 px-1">{n}</Badge> : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(92vw,420px)]">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <div className="col-span-2 sm:col-span-1">
              <Label>Category</Label>
              <NativeSelect className="mt-1 w-full" value={filters.category ?? ''} onChange={(e) => set({ category: e.target.value || undefined })}>
                <option value="">Any</option>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label>Platform</Label>
              <NativeSelect className="mt-1 w-full" value={filters.platform ?? ''} onChange={(e) => set({ platform: e.target.value || undefined })}>
                <option value="">Any</option>
                {PLATFORMS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label>Stage</Label>
              <NativeSelect className="mt-1 w-full" value={filters.stage ?? ''} onChange={(e) => set({ stage: (e.target.value || undefined) as FeedFilters['stage'] })}>
                <option value="">Any</option>
                <option value="new_launch">New launch</option>
                <option value="early_traction">Early traction</option>
                <option value="established">Established</option>
                <option value="unknown">Unproven</option>
              </NativeSelect>
            </div>
            <div>
              <Label>Discovered via</Label>
              <NativeSelect className="mt-1 w-full" value={filters.source ?? ''} onChange={(e) => set({ source: e.target.value || undefined })}>
                <option value="">Any source</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="col-span-2">
              <Label>Monthly revenue (USD, any evidence class)</Label>
              <div className="mt-1 flex items-center gap-2">
                <Input type="number" min={0} placeholder="Min" value={filters.revenueMin ?? ''} onChange={(e) => set({ revenueMin: e.target.value ? Number(e.target.value) : undefined })} />
                <span className="text-muted">–</span>
                <Input type="number" min={0} placeholder="Max" value={filters.revenueMax ?? ''} onChange={(e) => set({ revenueMax: e.target.value ? Number(e.target.value) : undefined })} />
              </div>
            </div>
            <div>
              <Label>Min growth %</Label>
              <Input className="mt-1" type="number" placeholder="e.g. 10" value={filters.growthMin ?? ''} onChange={(e) => set({ growthMin: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
            <div>
              <Label>Monetization</Label>
              <NativeSelect className="mt-1 w-full" value={filters.businessModel ?? ''} onChange={(e) => set({ businessModel: e.target.value || undefined })}>
                <option value="">Any</option>
                {['Subscription', 'Freemium', 'One-time purchase', 'Usage-based', 'Marketplace', 'Open source'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label>Product age</Label>
              <NativeSelect className="mt-1 w-full" value={filters.maxAgeDays ?? ''} onChange={(e) => set({ maxAgeDays: e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">Any</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last year</option>
              </NativeSelect>
            </div>
            <div>
              <Label>Evidence</Label>
              <NativeSelect className="mt-1 w-full" value={filters.evidence ?? ''} onChange={(e) => set({ evidence: (e.target.value || undefined) as FeedFilters['evidence'] })}>
                <option value="">Any</option>
                <option value="any_metric">Has business metrics</option>
                <option value="founder_or_better">Founder-reported or verified</option>
                <option value="verified">Verified only</option>
              </NativeSelect>
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={!!filters.savedOnly} onChange={(e) => set({ savedOnly: e.target.checked || undefined })} /> Saved only
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={!!filters.trackedOnly} onChange={(e) => set({ trackedOnly: e.target.checked || undefined })} /> Tracked only
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => onChange({ sort: filters.sort, q: filters.q })}>
              <X /> Clear filters
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
