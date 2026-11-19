import { METRIC_META, formatMetricValue } from '@core/metrics.ts'
import { TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ProductRow } from '@/components/product/ProductRow'
import { ConfidenceIndicator } from '@/components/product/atoms'
import { EmptyState, Skeleton } from '@/components/ui/overlay'
import { useAllProducts, useRecentEvents } from '@/data/hooks'
import { computeTrends } from '@/data/trends'

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex h-5 items-end gap-[2px]" aria-label={`Weekly discoveries: ${values.join(', ')}`}>
      {values.map((v, i) => (
        <div key={i} className="w-1.5 rounded-[1px] bg-accent/70" style={{ height: `${Math.max(2, (v / max) * 20)}px`, opacity: i === values.length - 1 ? 1 : 0.55 }} />
      ))}
    </div>
  )
}

function Panel({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {note ? <p className="text-2xs text-subtle">{note}</p> : null}
      </div>
      {children}
    </section>
  )
}

export default function Trends() {
  const { data: products, isLoading } = useAllProducts()
  const { data: events } = useRecentEvents(500)
  const t = useMemo(() => (products ? computeTrends(products, events ?? []) : null), [products, events])

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Trends" description="Aggregates across every product in the database. Ranked lists, not forecasts. Counts reflect what the connected sources covered, not the whole market." />
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-8">
        {isLoading || !t ? (
          <Skeleton className="h-64" />
        ) : t.totalProducts === 0 ? (
          <EmptyState icon={<TrendingUp />} title="No data yet">Trends appear once sources have discovered products.</EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Products tracked', t.totalProducts],
                ['With revenue figures', t.withRevenue],
                ['Categories', t.categories.length],
                ['Significant events (30d)', t.recentSignificant],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border px-4 py-3">
                  <div className="text-2xs text-muted">{k}</div>
                  <div className="tnum text-xl font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel title="Launch activity by category" note="Products discovered or launched per week, last 8 weeks">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-2xs uppercase tracking-wide text-subtle">
                      <th className="px-4 py-2 font-medium">Category</th>
                      <th className="px-2 py-2 text-right font-medium">7d</th>
                      <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">Prev 7d</th>
                      <th className="px-2 py-2 text-right font-medium">Total</th>
                      <th className="px-4 py-2 font-medium">Weekly</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.categories.slice(0, 12).map((c) => (
                      <tr key={c.category} className="border-t border-border">
                        <td className="px-4 py-1.5">{c.category}</td>
                        <td className="tnum px-2 py-1.5 text-right font-medium">{c.last7}</td>
                        <td className="tnum hidden px-2 py-1.5 text-right text-muted sm:table-cell">{c.prev7}</td>
                        <td className="tnum px-2 py-1.5 text-right text-muted">{c.total}</td>
                        <td className="px-4 py-1.5"><Spark values={c.weekly} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
              <div className="space-y-4">
                <Panel title="Most common business models" note="From pricing pages and source descriptions">
                  <ul className="divide-y divide-border">
                    {t.businessModels.length ? t.businessModels.slice(0, 6).map(([m, n]) => (
                      <li key={m} className="flex items-center gap-3 px-4 py-1.5 text-[13px]">
                        <span className="flex-1">{m}</span>
                        <div className="h-1.5 w-24 rounded-full bg-surface"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${(n / t.businessModels[0][1]) * 100}%` }} /></div>
                        <span className="tnum w-8 text-right text-muted">{n}</span>
                      </li>
                    )) : <li className="px-4 py-3 text-[13px] text-subtle">Not enough pricing data yet.</li>}
                  </ul>
                </Panel>
                <Panel title="Consumer AI niches" note="Products tagged Consumer AI, by category">
                  <ul className="divide-y divide-border">
                    {t.consumerAiNiches.length ? t.consumerAiNiches.slice(0, 6).map(([c, n]) => (
                      <li key={c} className="flex justify-between px-4 py-1.5 text-[13px]"><span>{c}</span><span className="tnum text-muted">{n}</span></li>
                    )) : <li className="px-4 py-3 text-[13px] text-subtle">None yet.</li>}
                  </ul>
                </Panel>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel title="Gaining traction" note="Highest reported growth (MRR, revenue or traffic) — evidence class shown">
                {t.gaining.length ? (
                  <div className="divide-y divide-border">
                    {t.gaining.map((p) => {
                      const g = p.summaryMetrics.mrr_growth_pct ?? p.summaryMetrics.revenue_growth_pct ?? p.summaryMetrics.traffic_growth_pct
                      return (
                        <ProductRow key={p.id} product={p} showMetrics={false} right={g ? (
                          <div className="shrink-0 text-right">
                            <div className="tnum text-[13px] font-semibold text-positive">{formatMetricValue(g.metric, g.value)}</div>
                            <div className="text-2xs text-subtle">{METRIC_META[g.metric].short}</div>
                          </div>
                        ) : null} />
                      )
                    })}
                  </div>
                ) : <p className="px-4 py-3 text-[13px] text-subtle">No growth figures collected yet.</p>}
              </Panel>
              <Panel title="Highest reported revenue" note="Monthly-equivalent; mixes evidence classes, which are labeled">
                {t.revenueLeaders.length ? (
                  <div className="divide-y divide-border">
                    {t.revenueLeaders.map((p) => (
                      <ProductRow key={p.id} product={p} showMetrics={false} right={
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="tnum text-[13px] font-semibold">{formatMetricValue('mrr', p.monthlyRevenue!)}/mo</span>
                          {p.revenueEvidence ? <ConfidenceIndicator evidence={p.revenueEvidence} compact /> : null}
                        </div>
                      } />
                    ))}
                  </div>
                ) : <p className="px-4 py-3 text-[13px] text-subtle">No revenue figures collected yet.</p>}
              </Panel>
            </div>
            <p className="text-2xs text-subtle">Advertising-angle trends will appear once ad-library connectors are configured and creatives have been analyzed.</p>
          </>
        )}
      </div>
    </div>
  )
}
