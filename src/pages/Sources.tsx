import type { SourceRecord } from '@core/types.ts'
import { AlertCircle, CheckCircle2, ExternalLink, GitMerge, KeyRound, Loader2, Play, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ProductLogo } from '@/components/product/atoms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTrigger, EmptyState, Switch, Tooltip } from '@/components/ui/overlay'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMeta, useSources } from '@/data/hooks'
import type { MergeCandidateView } from '@/data/repository'
import { cn, formatDate, timeAgo } from '@/lib/utils'

const STATUS: Record<SourceRecord['status'], { label: string; tone: 'positive' | 'warning' | 'neutral' | 'outline' | 'negative' }> = {
  operational: { label: 'Operational', tone: 'positive' },
  requires_credentials: { label: 'Needs credentials', tone: 'warning' },
  manual: { label: 'Manual only', tone: 'neutral' },
  unsupported: { label: 'Unsupported', tone: 'outline' },
  licensed: { label: 'Licensed · not configured', tone: 'outline' },
  error: { label: 'Error', tone: 'negative' },
}

const FREQ = [
  [15, '15 min'], [60, 'Hourly'], [120, '2 hours'], [360, '6 hours'], [720, '12 hours'], [1440, 'Daily'], [10080, 'Weekly'],
] as const

function SourceRow({ s, mode }: { s: SourceRecord; mode: 'local' | 'supabase' }) {
  const { update, run } = useSources()
  const [msg, setMsg] = useState<string | null>(null)
  const runnable = s.role !== 'enrichment' && s.status === 'operational' && s.id !== 'manual'
  const browserBlocked = mode === 'local' && !s.runsIn.includes('browser')
  const configurable = !['unsupported', 'licensed', 'manual'].includes(s.status) && s.id !== 'manual'
  const running = run.isPending && run.variables === s.id
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">{s.name}</span>
            <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
            <Badge tone="outline" className="font-normal uppercase">{s.kind.replace('_', ' ')}</Badge>
            <Badge tone="outline" className="font-normal capitalize">{s.role}</Badge>
            {s.custom ? <Badge tone="accent">Custom</Badge> : null}
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">{s.notes}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-subtle">
            {s.homepage ? (
              <a href={s.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
                {s.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')} <ExternalLink className="size-2.5" />
              </a>
            ) : null}
            {s.credentialEnv.length ? (
              <span className="inline-flex items-center gap-1">
                <KeyRound className="size-3" /> {s.credentialEnv.join(', ')} ·{' '}
                {s.credentialsPresent === true ? <span className="text-positive">configured</span> : s.credentialsPresent === false ? <span className="text-warning">missing</span> : 'set as Supabase function secrets'}
              </span>
            ) : null}
            <span>Last success: {s.lastSuccessAt ? timeAgo(s.lastSuccessAt) : 'never'}</span>
            {s.lastRunAt ? <span>Last run: {timeAgo(s.lastRunAt)}</span> : null}
            <span className="tnum">{s.productsDiscovered} products · {s.mentionsCollected} mentions</span>
          </div>
          {s.lastError ? (
            <p className="mt-1.5 flex items-start gap-1 text-xs text-negative">
              <AlertCircle className="mt-0.5 size-3 shrink-0" /> {s.lastError}
            </p>
          ) : null}
          {msg ? <p className="mt-1.5 text-xs text-muted">{msg}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {configurable ? (
            <>
              <NativeSelect className="h-7 text-xs" value={s.refreshMinutes} onChange={(e) => update.mutate({ id: s.id, refreshMinutes: Number(e.target.value) })} aria-label="Refresh frequency">
                {FREQ.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </NativeSelect>
              <Tooltip content={s.enabled ? 'Enabled' : 'Disabled'}>
                <span className="inline-flex">
                  <Switch checked={s.enabled} disabled={s.status === 'requires_credentials'} onCheckedChange={(v) => update.mutate({ id: s.id, enabled: v })} aria-label="Enable source" />
                </span>
              </Tooltip>
            </>
          ) : null}
          {runnable ? (
            <Tooltip content={browserBlocked ? 'Runs server-side only (cross-origin restrictions). Connect Supabase.' : 'Run discovery now'}>
              <span className="inline-flex">
                <Button
                  size="sm"
                  disabled={browserBlocked || running || !s.enabled}
                  onClick={async () => {
                    setMsg(null)
                    try {
                      const j = await run.mutateAsync(s.id)
                      setMsg(`${j.status === 'error' ? 'Failed' : 'Done'}: ${j.productsCreated} new products, ${j.mentionsNew} new mentions, ${j.observationsNew} observations${j.error ? ` — ${j.error}` : ''}`)
                    } catch (e) {
                      setMsg((e as Error).message)
                    }
                  }}
                >
                  {running ? <Loader2 className="animate-spin" /> : <Play />} Run now
                </Button>
              </span>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function AddSource() {
  const { addRss } = useSources()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary"><Plus /> Add source</Button>
      </DialogTrigger>
      <DialogContent
        title="Add an RSS or Atom feed"
        description="Feed items become product discoveries only when they link to a product website. Adding a source does not mean arbitrary websites can be scraped — for API or licensed sources, add a connector in code."
      >
        <form
          className="space-y-2.5"
          onSubmit={async (e) => {
            e.preventDefault()
            await addRss.mutateAsync({ url, name: name || url })
            setOpen(false)
          }}
        >
          <Input placeholder="Name (e.g. BetaList)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input required type="url" placeholder="https://example.com/feed.xml" value={url} onChange={(e) => setUrl(e.target.value)} />
          {addRss.isError ? <p className="text-xs text-negative">{(addRss.error as Error).message}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={addRss.isPending}>Add feed</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MergeRow({ c }: { c: MergeCandidateView }) {
  const { doMerge, dismiss } = useSources()
  if (!c.a || !c.b) return null
  const side = (p: NonNullable<MergeCandidateView['a']>) => (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ProductLogo product={p} size={28} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium">{p.name}</div>
        <div className="truncate text-2xs text-muted">{p.domain ?? 'no domain'} · {p.sourceIds.join(', ')}</div>
      </div>
    </div>
  )
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-3">
        {side(c.a)}
        <GitMerge className="size-4 shrink-0 text-subtle" />
        {side(c.b)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{c.reason} · score {c.score.toFixed(2)}</p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(c.id)}><X /> Not the same</Button>
          <Button size="sm" onClick={() => doMerge.mutate({ survivor: c.a!.id, loser: c.b!.id, id: c.id })}>Merge into {c.a.name}</Button>
        </div>
      </div>
    </li>
  )
}

export default function Sources() {
  const { sources, jobs, merge } = useSources()
  const meta = useMeta().data
  const list = sources.data ?? []
  const groups = [
    { title: 'Operational', items: list.filter((s) => s.status === 'operational' || s.status === 'error') },
    { title: 'Needs credentials', items: list.filter((s) => s.status === 'requires_credentials') },
    { title: 'Manual, licensed or unsupported', items: list.filter((s) => ['manual', 'unsupported', 'licensed'].includes(s.status)) },
  ]
  const openMerges = merge.data?.length ?? 0
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Sources"
        description="Every connector, what it can legitimately collect, and its health. Status reflects what actually works — a source is never shown as operational when it is not."
        actions={meta?.mode === 'supabase' ? <AddSource /> : null}
      />
      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-8">
        {meta?.mode === 'local' ? (
          <p className="mb-4 rounded-lg border border-dashed border-border-strong bg-sidebar p-3 text-xs text-muted">
            Local mode: Hacker News and GitHub can run from your browser. Other connectors need the server (cross-origin limits, robots.txt checks and a proper User-Agent). The snapshot you see was collected server-side with the same pipeline. Scheduled runs need Supabase.
          </p>
        ) : null}
        <Tabs defaultValue="sources">
          <TabsList>
            <TabsTrigger value="sources">Connectors</TabsTrigger>
            <TabsTrigger value="jobs">Ingestion log</TabsTrigger>
            <TabsTrigger value="review">Review queue {openMerges ? <Badge tone="warning" className="ml-1 h-4 px-1">{openMerges}</Badge> : null}</TabsTrigger>
          </TabsList>
          <TabsContent value="sources" className="space-y-5">
            {groups.map((g) =>
              g.items.length ? (
                <section key={g.title}>
                  <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-subtle">{g.title}</h2>
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {g.items.map((s) => (
                      <SourceRow key={s.id} s={s} mode={meta?.mode ?? 'local'} />
                    ))}
                  </div>
                </section>
              ) : null,
            )}
          </TabsContent>
          <TabsContent value="jobs">
            {jobs.data?.length ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-sidebar text-left text-2xs uppercase tracking-wide text-subtle">
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Started</th>
                      <th className="px-3 py-2 text-right font-medium">Fetched</th>
                      <th className="px-3 py-2 text-right font-medium">New mentions</th>
                      <th className="px-3 py-2 text-right font-medium">New products</th>
                      <th className="px-3 py-2 text-right font-medium">Observations</th>
                      <th className="px-3 py-2 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.data.map((j) => (
                      <tr key={j.id} className="border-t border-border align-top">
                        <td className="px-3 py-2 font-medium">{list.find((s) => s.id === j.sourceId)?.name ?? j.sourceId}</td>
                        <td className="px-3 py-2">
                          <span className={cn('inline-flex items-center gap-1', j.status === 'success' ? 'text-positive' : j.status === 'error' ? 'text-negative' : 'text-warning')}>
                            {j.status === 'success' ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />} {j.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted">{formatDate(j.startedAt)} · {timeAgo(j.startedAt)} · {j.trigger}</td>
                        <td className="tnum px-3 py-2 text-right">{j.itemsFetched}</td>
                        <td className="tnum px-3 py-2 text-right">{j.mentionsNew}</td>
                        <td className="tnum px-3 py-2 text-right">{j.productsCreated}</td>
                        <td className="tnum px-3 py-2 text-right">{j.observationsNew}</td>
                        <td className="max-w-xs px-3 py-2 text-muted">
                          {j.error ? <span className="text-negative">{j.error}</span> : null}
                          {j.log.length ? (
                            <details>
                              <summary className="cursor-pointer text-subtle">{j.log.length} log lines</summary>
                              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-2xs">{j.log.join('\n')}</pre>
                            </details>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No ingestion runs yet" />
            )}
          </TabsContent>
          <TabsContent value="review">
            <p className="mb-3 text-xs text-muted">
              Possible duplicates found by entity resolution. Products are never merged automatically on name similarity. Merging moves all evidence, events and your saved items to the surviving profile and is recorded in its activity.
            </p>
            {merge.data?.length ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {merge.data.map((c) => (
                  <MergeRow key={c.id} c={c} />
                ))}
              </ul>
            ) : (
              <EmptyState icon={<GitMerge />} title="Nothing to review" />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
