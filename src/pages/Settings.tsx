import { DEFAULT_WEIGHTS, type ScoreWeights } from '@core/types.ts'
import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Label, NativeSelect } from '@/components/ui/input'
import { useRepo } from '@/data/context'
import { useMeta, useSettings } from '@/data/hooks'
import type { Settings as S } from '@/data/repository'

const LABELS: Record<keyof ScoreWeights, string> = { growth: 'Growth evidence', monetization: 'Monetization evidence', distribution: 'Distribution potential', feasibility: 'Build feasibility' }

export default function Settings() {
  const { data, save } = useSettings()
  const meta = useMeta().data
  const repo = useRepo()
  const [s, setS] = useState<S | null>(null)
  useEffect(() => {
    if (data) setS(structuredClone(data))
  }, [data])
  if (!s) return null
  const total = Object.values(s.weights).reduce((a, b) => a + b, 0)
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Settings" />
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-6 sm:px-8">
        <section className="space-y-3">
          <div>
            <h2 className="text-[14px] font-semibold">Opportunity score weights</h2>
            <p className="text-[13px] text-muted">Configurable heuristics, not objective market measurements. Weights are normalized; components with no evidence are excluded and lower the coverage.</p>
          </div>
          {(Object.keys(LABELS) as (keyof ScoreWeights)[]).map((k) => (
            <div key={k} className="grid grid-cols-[180px_1fr_48px] items-center gap-3">
              <Label className="text-[13px] text-text">{LABELS[k]}</Label>
              <input type="range" min={0} max={60} step={5} value={s.weights[k]} onChange={(e) => setS({ ...s, weights: { ...s.weights, [k]: Number(e.target.value) } })} className="accent-[var(--accent)]" />
              <span className="tnum text-right text-[13px]">{total ? Math.round((s.weights[k] / total) * 100) : 0}%</span>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setS({ ...s, weights: { ...DEFAULT_WEIGHTS } })}>Reset to 30 / 30 / 25 / 15</Button>
        </section>
        <section className="space-y-3">
          <h2 className="text-[14px] font-semibold">Notifications</h2>
          <div className="grid grid-cols-[180px_1fr] items-center gap-3">
            <Label className="text-[13px] text-text">Default tracking threshold</Label>
            <NativeSelect value={s.defaultMinSignificance} onChange={(e) => setS({ ...s, defaultMinSignificance: Number(e.target.value) })}>
              <option value={30}>All changes and new mentions</option>
              <option value={50}>Significant changes</option>
              <option value={75}>Major changes only</option>
            </NativeSelect>
            <Label className="text-[13px] text-text">Digest</Label>
            <NativeSelect value={s.digest} onChange={(e) => setS({ ...s, digest: e.target.value as S['digest'] })}>
              <option value="off">Off (in-app updates only)</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Mondays)</option>
            </NativeSelect>
          </div>
          <p className="text-xs text-muted">Email delivery requires an email provider (RESEND_API_KEY) on the server. Without one, digests appear in-app.</p>
        </section>
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => save.mutate(s)} disabled={save.isPending}>{save.isSuccess ? 'Saved' : 'Save settings'}</Button>
        </div>
        <section className="space-y-2 border-t border-border pt-6">
          <h2 className="text-[14px] font-semibold">Data</h2>
          {meta?.mode === 'local' ? (
            <>
              <p className="text-[13px] text-muted">
                Local mode: data lives in this browser (IndexedDB), seeded from a real pipeline snapshot. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to use the shared database with scheduled ingestion.
              </p>
              <Button variant="danger" size="sm" onClick={async () => { await repo.resetLocalData?.(); window.location.reload() }}>Reset local data</Button>
            </>
          ) : (
            <p className="text-[13px] text-muted">Connected to Supabase. Research data is shared across your team; saved items, tracking, notes and opportunities are private to your account.</p>
          )}
        </section>
      </div>
    </div>
  )
}
