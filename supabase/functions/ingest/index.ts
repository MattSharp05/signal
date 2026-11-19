// Scheduled + on-demand ingestion. Called by pg_cron every 15 minutes (CRON_SECRET) or by a signed-in user ("Run now").
import { Http } from '../_shared/core/http.ts'
import { enrichProduct, generateReport, runSource } from '../_shared/core/pipeline.ts'
import { SupabaseStore } from '../_shared/core/supabase-store.ts'
import { aiService, authorize, cors, env, json, serviceClient, syncSources } from '../_shared/server.ts'

const TIME_BUDGET_MS = 120_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const started = Date.now()
  try {
    const db = serviceClient()
    const who = await authorize(req, db)
    if (!who) return json({ error: 'unauthorized' }, 401)
    const body = (await req.json().catch(() => ({}))) as { mode?: 'due' | 'source'; sourceId?: string; budget?: number }
    const store = new SupabaseStore(db)
    await syncSources(store)
    const ai = aiService()
    const deps = { store, http: new Http(), env, ai, log: (m: string) => console.log(m) }

    const results = []
    if (body.mode === 'source' && body.sourceId) {
      results.push(await runSource(deps, body.sourceId, { trigger: who === 'cron' ? 'schedule' : 'manual', budget: body.budget }))
    } else {
      const sources = (await store.listSources()).filter((s) => s.enabled && s.status === 'operational' && (s.role !== 'enrichment'))
      const now = Date.now()
      const due = sources.filter((s) => !s.lastRunAt || now - new Date(s.lastRunAt).getTime() >= s.refreshMinutes * 60_000)
      for (const s of due) {
        if (Date.now() - started > TIME_BUDGET_MS) break
        results.push(await runSource(deps, s.id, { trigger: 'schedule' }))
      }
      // Enrichment backlog: products discovered without enrichment yet (bounded).
      const { data: backlog } = await db
        .from('products').select('id').eq('status', 'active').not('domain', 'is', null).lte('source_count', 1)
        .order('relevance_score', { ascending: false }).limit(5)
      for (const p of backlog ?? []) {
        if (Date.now() - started > TIME_BUDGET_MS) break
        await enrichProduct(deps, p.id)
      }
      // Tiered AI research: deep reports only for promising products, bounded per run (cost control).
      if (ai) {
        const n = Number(env('AI_DEEP_PER_RUN') ?? 5)
        const { data: promising } = await db.from('products').select('id').eq('status', 'active').gte('relevance_score', 60).order('relevance_score', { ascending: false }).limit(n * 3)
        let made = 0
        for (const p of promising ?? []) {
          if (made >= n || Date.now() - started > TIME_BUDGET_MS) break
          const { data: has } = await db.from('research_reports').select('id').eq('product_id', p.id).eq('generator', 'ai').limit(1)
          if (has?.length) continue
          try {
            await generateReport(deps, p.id, 'deep')
            made++
          } catch (e) {
            console.error('deep report failed', p.id, (e as Error).message)
          }
        }
      }
    }
    return json({ ok: true, ms: Date.now() - started, jobs: results.map((j) => ({ source: j.sourceId, status: j.status, created: j.productsCreated, mentions: j.mentionsNew, error: j.error })) })
  } catch (e) {
    console.error(e)
    return json({ error: (e as Error).message }, 500)
  }
})
