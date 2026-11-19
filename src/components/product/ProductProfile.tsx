import { shortSourceName } from '@core/connectors/index.ts'
import { EVIDENCE_LABEL, METRIC_META, formatMetricValue } from '@core/metrics.ts'
import type { Advertisement, ProductEvent } from '@core/types.ts'
import {
  Activity, BadgeDollarSign, ExternalLink, Flag, Lightbulb, Loader2, Megaphone, Plus, Rocket, Sparkles, Tag, Trash2, TrendingUp, Users,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTrigger, EmptyState, Tooltip } from '@/components/ui/overlay'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAdMutations, useMeta, useNotes, useOpportunities } from '@/data/hooks'
import type { ManualAdInput, Note, ProductDetail } from '@/data/repository'
import { cn, formatDate, hostOf, timeAgo } from '@/lib/utils'
import { SaveButton, TrackingButton } from './actions'
import { ConfidenceIndicator, DataOriginBadge, ProductLogo, StageBadge } from './atoms'
import { ProductReport, Section } from './report'

export function ProfileHeader({ d, onNavigateFull }: { d: ProductDetail; onNavigateFull?: boolean }) {
  const p = d.product
  return (
    <div className="flex items-start gap-3">
      <ProductLogo product={p} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold leading-tight tracking-tight">
            {onNavigateFull ? (
              <Link to={`/p/${p.slug}`} className="hover:underline">
                {p.name}
              </Link>
            ) : (
              p.name
            )}
          </h1>
          <StageBadge stage={p.stage} />
          <DataOriginBadge origin={p.dataOrigin} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
          {p.websiteUrl ? (
            <a href={p.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
              {hostOf(p.websiteUrl)} <ExternalLink className="size-3" />
            </a>
          ) : (
            <span className="text-subtle">No website identified</span>
          )}
          {p.category ? <span>· {p.category}</span> : null}
          <span>· updated {timeAgo(p.lastUpdatedAt)}</span>
        </div>
        <div className="-ml-1.5 mt-2 flex flex-wrap items-center gap-0.5">
          <SaveButton productId={p.id} withLabel />
          <TrackingButton productId={p.id} withLabel />
          <AddToOpportunity productId={p.id} name={p.name} />
        </div>
      </div>
    </div>
  )
}

function AddToOpportunity({ productId, name }: { productId: string; name: string }) {
  const { data, save } = useOpportunities()
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState('new')
  const navigate = useNavigate()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Lightbulb /> Opportunity
        </Button>
      </DialogTrigger>
      <DialogContent title="Use as inspiration" description="Link this product to an opportunity you might build.">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (choice === 'new') await save.mutateAsync({ title: `Inspired by ${name}`, productIds: [productId] })
            else {
              const o = data?.find((x) => x.id === choice)
              if (o) await save.mutateAsync({ ...o, productIds: [...new Set([...o.productIds, productId])] })
            }
            setOpen(false)
            navigate('/opportunities')
          }}
        >
          <NativeSelect value={choice} onChange={(e) => setChoice(e.target.value)} className="w-full">
            <option value="new">+ New opportunity</option>
            {data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </NativeSelect>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={save.isPending}>
              Link product
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const EVENT_ICON: Record<ProductEvent['type'], React.ReactNode> = {
  discovered: <Flag />, new_source: <Plus />, metric_change: <TrendingUp />, revenue_milestone: <BadgeDollarSign />, traffic_change: <Users />,
  pricing_change: <Tag />, launch: <Rocket />, new_ad: <Megaphone />, announcement: <Activity />, merged: <Activity />,
}

export function ActivityTimeline({ events }: { events: ProductEvent[] }) {
  if (!events.length) return <EmptyState icon={<Activity />} title="No activity yet" />
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className={cn('absolute -left-[29px] top-0 flex size-[18px] items-center justify-center rounded-full border bg-bg [&_svg]:size-2.5', e.significance >= 60 ? 'border-accent text-accent' : 'border-border text-muted')}>
            {EVENT_ICON[e.type]}
          </span>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-medium">{e.title}</p>
            <time className="shrink-0 text-2xs text-subtle">{formatDate(e.occurredAt)}</time>
          </div>
          {e.detail ? <p className="mt-0.5 text-xs text-muted">{e.detail}</p> : null}
        </li>
      ))}
    </ol>
  )
}

function SourcesEvidence({ d }: { d: ProductDetail }) {
  const byMention = new Map<string, typeof d.observations>()
  for (const o of d.observations) if (o.mentionId) byMention.set(o.mentionId, [...(byMention.get(o.mentionId) ?? []), o])
  const mentions = [...d.mentions].sort((a, b) => (b.publishedAt ?? b.collectedAt).localeCompare(a.publishedAt ?? a.collectedAt))
  return (
    <div className="space-y-3">
      {mentions.map((m) => {
        const obs = byMention.get(m.id) ?? []
        return (
          <div key={m.id} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="font-semibold">{shortSourceName(m.sourceId)}</span>
                  <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-accent hover:underline">
                    <span className="truncate">{m.title ?? hostOf(m.url)}</span> <ExternalLink className="size-3 shrink-0" />
                  </a>
                </div>
                <div className="mt-0.5 text-2xs text-subtle">
                  Published {m.publishedAt ? formatDate(m.publishedAt) : 'date unknown'} · discovered {formatDate(m.discoveredAt)} · collected {formatDate(m.collectedAt)}
                  {m.author ? ` · by ${m.author}` : ''}
                </div>
              </div>
            </div>
            {m.excerpt ? <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted">{m.excerpt.slice(0, 600)}</p> : null}
            {obs.length ? (
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-2xs uppercase tracking-wide text-subtle">
                    <th className="py-1 font-medium">Metric</th>
                    <th className="py-1 font-medium">Value</th>
                    <th className="hidden py-1 font-medium sm:table-cell">Period</th>
                    <th className="py-1 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {obs.map((o) => (
                    <tr key={o.id} className="border-t border-border align-top">
                      <td className="py-1.5 pr-2">
                        {METRIC_META[o.metric].label}
                        {o.quote ? <div className="mt-0.5 text-2xs text-subtle">“{o.quote.slice(0, 140)}”</div> : null}
                      </td>
                      <td className="tnum py-1.5 pr-2 font-medium">{formatMetricValue(o.metric, o.value)}</td>
                      <td className="hidden py-1.5 pr-2 text-muted sm:table-cell">{o.periodLabel ?? '—'}</td>
                      <td className="py-1.5">
                        <ConfidenceIndicator evidence={o.evidence} />
                        <div className="mt-0.5 text-2xs capitalize text-subtle">{o.confidence} confidence</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-2xs text-subtle">No metrics extracted from this source.</p>
            )}
          </div>
        )
      })}
      <p className="text-2xs text-subtle">
        Evidence classes: {Object.values(EVIDENCE_LABEL).join(' · ')}. Observations are never overwritten or averaged.
      </p>
    </div>
  )
}

export function AdCreativeCard({ ad, onAnalyze, analyzing }: { ad: Advertisement; onAnalyze?: () => void; analyzing?: boolean }) {
  const days = ad.firstObserved && ad.lastObserved ? Math.max(1, Math.round((new Date(ad.lastObserved).getTime() - new Date(ad.firstObserved).getTime()) / 86400_000)) : null
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border">
      <div className="flex aspect-[4/3] items-center justify-center bg-surface">
        {ad.mediaUrl ? <img src={ad.mediaUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <Megaphone className="size-6 text-subtle" />}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3 text-xs">
        <div className="flex items-center gap-1.5">
          <Badge tone="neutral" className="capitalize">{ad.platform}</Badge>
          {ad.isActive != null ? <Badge tone={ad.isActive ? 'positive' : 'outline'}>{ad.isActive ? 'Active' : 'Inactive'}</Badge> : null}
          {ad.manual ? <Badge tone="outline">Manual reference</Badge> : null}
        </div>
        {ad.advertiser ? <div className="text-muted">{ad.advertiser}</div> : null}
        {ad.headline ? <div className="text-[13px] font-medium">{ad.headline}</div> : null}
        {ad.body ? <p className="line-clamp-4 text-muted">{ad.body}</p> : null}
        <div className="mt-auto space-y-0.5 pt-1 text-2xs text-subtle">
          <div>First observed {formatDate(ad.firstObserved)} · last {formatDate(ad.lastObserved)}</div>
          {days ? (
            <Tooltip content="Ad longevity is a research signal only. It is not evidence of profitability.">
              <span className="underline decoration-dotted">Observed for {days} day{days > 1 ? 's' : ''}</span>
            </Tooltip>
          ) : null}
          {ad.landingUrl ? <div className="truncate">Landing: {hostOf(ad.landingUrl)}</div> : null}
        </div>
        {ad.analysis ? (
          <dl className="mt-1 grid grid-cols-[70px_1fr] gap-x-2 gap-y-0.5 rounded bg-surface p-2 text-2xs">
            {(
              [
                ['Hook', ad.analysis.hook], ['Audience', ad.analysis.audience], ['Appeal', ad.analysis.emotionalAppeal], ['Value prop', ad.analysis.valueProposition],
                ['CTA', ad.analysis.callToAction], ['Format', ad.analysis.format], ['Angle', ad.analysis.angle],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="flex items-center gap-2 pt-1">
          {ad.originalUrl ? (
            <a href={ad.originalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              Original <ExternalLink className="size-3" />
            </a>
          ) : null}
          {onAnalyze && !ad.analysis ? (
            <button className="inline-flex items-center gap-1 text-muted hover:text-accent" onClick={onAnalyze} disabled={analyzing}>
              {analyzing ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />} Analyze creative
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function AdvertisingTab({ d }: { d: ProductDetail }) {
  const { add, analyze } = useAdMutations(d.product.id)
  const meta = useMeta().data
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<ManualAdInput>({ platform: 'meta', advertiser: d.product.name, headline: '', body: '', landingUrl: d.product.websiteUrl, originalUrl: '', mediaUrl: '', firstObserved: null })
  const ads = [...d.ads].sort((a, b) => (b.firstObserved ?? '').localeCompare(a.firstObserved ?? ''))
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted">
          Creatives come from ad-library connectors (Meta Ad Library API needs a token) or manual references. Spend, ROAS and profitability are never inferred.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus /> Add reference
            </Button>
          </DialogTrigger>
          <DialogContent title="Add ad reference" description="Bookmark an ad you found in a public ad library. Only paste text you are permitted to store.">
            <form
              className="space-y-2.5"
              onSubmit={async (e) => {
                e.preventDefault()
                await add.mutateAsync({ ...form, originalUrl: form.originalUrl || null, mediaUrl: form.mediaUrl || null, firstObserved: form.firstObserved || null })
                setOpen(false)
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Platform</Label>
                  <NativeSelect className="w-full" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as ManualAdInput['platform'] })}>
                    <option value="meta">Meta</option>
                    <option value="tiktok">TikTok</option>
                    <option value="google">Google</option>
                    <option value="other">Other</option>
                  </NativeSelect>
                </div>
                <div>
                  <Label>First seen</Label>
                  <Input type="date" value={form.firstObserved?.slice(0, 10) ?? ''} onChange={(e) => setForm({ ...form, firstObserved: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </div>
              </div>
              <div>
                <Label>Ad library link</Label>
                <Input required type="url" placeholder="https://www.facebook.com/ads/library/?id=…" value={form.originalUrl ?? ''} onChange={(e) => setForm({ ...form, originalUrl: e.target.value })} />
              </div>
              <div>
                <Label>Headline</Label>
                <Input value={form.headline ?? ''} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
              </div>
              <div>
                <Label>Ad copy</Label>
                <Textarea rows={3} value={form.body ?? ''} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </div>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" disabled={add.isPending}>Save reference</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {ads.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ads.map((a) => (
            <AdCreativeCard key={a.id} ad={a} onAnalyze={meta?.mode === 'supabase' ? () => analyze.mutate(a.id) : undefined} analyzing={analyze.isPending && analyze.variables === a.id} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Megaphone />} title="No ad creatives on record">
          No connected ad library has returned creatives for this product. Add a reference manually, or configure the Meta Ad Library connector on the Sources page.
        </EmptyState>
      )}
      {analyze.isError ? <p className="text-xs text-negative">{(analyze.error as Error).message}</p> : null}
    </div>
  )
}

function CompetitorsTab({ d }: { d: ProductDetail }) {
  return (
    <div className="space-y-5">
      <Section title="Named by sources">
        {d.relationships.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {d.relationships.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                <div className="min-w-0">
                  <span className="font-medium">{r.relatedName}</span>
                  {r.reason ? <div className="text-2xs text-subtle">{r.reason}</div> : null}
                </div>
                {r.relatedProductId ? (
                  <Link to={`/p/${r.relatedProductId}`} className="shrink-0 text-xs text-accent hover:underline">
                    Profile →
                  </Link>
                ) : (
                  <span className="shrink-0 text-2xs text-subtle">Not in database</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-subtle">No source has named competitors or alternatives yet.</p>
        )}
      </Section>
      <Section title={`Same category${d.product.category ? ` · ${d.product.category}` : ''}`}>
        {d.similar.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {d.similar.map((s) => (
              <li key={s.id}>
                <Link to={`/p/${s.slug}`} className="flex items-center gap-3 px-3 py-2 hover:bg-surface">
                  <ProductLogo product={s} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{s.name}</div>
                    <div className="truncate text-2xs text-muted">{s.tagline}</div>
                  </div>
                  <StageBadge stage={s.stage} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-subtle">No similar products found.</p>
        )}
        <p className="text-2xs text-subtle">Category similarity is a heuristic grouping, not a confirmed competitive relationship.</p>
      </Section>
    </div>
  )
}

function NotesTab({ productId }: { productId: string }) {
  const { data, add, remove } = useNotes(productId)
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<Note['kind']>('observation')
  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!body.trim()) return
          await add.mutateAsync({ body: body.trim(), kind })
          setBody('')
        }}
      >
        <Textarea rows={3} placeholder="Add a research note, conclusion or opportunity…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex items-center justify-between">
          <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as Note['kind'])}>
            <option value="observation">Observation</option>
            <option value="conclusion">Conclusion</option>
            <option value="opportunity">Opportunity</option>
          </NativeSelect>
          <Button type="submit" variant="primary" size="sm" disabled={!body.trim() || add.isPending}>
            Add note
          </Button>
        </div>
      </form>
      {data?.length ? (
        <ul className="space-y-2">
          {data.map((n) => (
            <li key={n.id} className="group rounded-lg border border-border p-3">
              <div className="mb-1 flex items-center justify-between">
                <Badge tone={n.kind === 'opportunity' ? 'accent' : n.kind === 'conclusion' ? 'positive' : 'neutral'} className="capitalize">{n.kind}</Badge>
                <div className="flex items-center gap-1">
                  <span className="text-2xs text-subtle">{timeAgo(n.createdAt)}</span>
                  <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100" onClick={() => remove.mutate(n.id)} aria-label="Delete note">
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-[13px]">{n.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-subtle">No notes yet. Notes are private to you.</p>
      )}
    </div>
  )
}

export function ProductProfile({ d, defaultTab = 'overview' }: { d: ProductDetail; defaultTab?: string }) {
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="sources">Sources &amp; Evidence <span className="ml-1 text-subtle">{d.mentions.length}</span></TabsTrigger>
        <TabsTrigger value="ads">Advertising {d.ads.length ? <span className="ml-1 text-subtle">{d.ads.length}</span> : null}</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="competitors">Competitors</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <ProductReport d={d} />
      </TabsContent>
      <TabsContent value="sources">
        <SourcesEvidence d={d} />
      </TabsContent>
      <TabsContent value="ads">
        <AdvertisingTab d={d} />
      </TabsContent>
      <TabsContent value="activity">
        <ActivityTimeline events={d.events} />
      </TabsContent>
      <TabsContent value="competitors">
        <CompetitorsTab d={d} />
      </TabsContent>
      <TabsContent value="notes">
        <NotesTab productId={d.product.id} />
      </TabsContent>
    </Tabs>
  )
}
