// Node CLI for the ingestion pipeline (same code as the Edge Functions).
//
//   NODE_USE_ENV_PROXY=1 npx tsx scripts/ingest.ts --sources hn_show,trustmrr --budget 20 --out src/fixtures/snapshot.json
//   npx tsx scripts/ingest.ts --store supabase --sources due          (uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
//   npx tsx scripts/ingest.ts --add https://www.whatbrandonthinks.com/  (manual submission)
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createAiService } from '../supabase/functions/_shared/core/ai.ts'
import { defaultSourceRecords } from '../supabase/functions/_shared/core/connectors/index.ts'
import { Http } from '../supabase/functions/_shared/core/http.ts'
import { MemoryStore, emptyData, type MemoryData } from '../supabase/functions/_shared/core/memory-store.ts'
import { addProductByUrl, enrichProduct, generateReport, recomputeProduct, runSource, type PipelineDeps } from '../supabase/functions/_shared/core/pipeline.ts'
import type { Store } from '../supabase/functions/_shared/core/store.ts'
import { SupabaseStore } from '../supabase/functions/_shared/core/supabase-store.ts'

const args = process.argv.slice(2)
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const multi = (name: string) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []))

const env = (k: string) => process.env[k] || undefined
const storeKind = opt('store', 'memory')
const out = opt('out', 'src/fixtures/snapshot.json')!
const budget = Number(opt('budget', '20'))
const enrichAll = args.includes('--enrich-all')

async function main() {
  let store: Store
  let mem: MemoryStore | null = null
  if (storeKind === 'supabase') {
    const url = env('SUPABASE_URL')
    const key = env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --store supabase')
    const s = new SupabaseStore(createClient(url, key, { auth: { persistSession: false } }))
    await s.upsertSources(defaultSourceRecords(env))
    store = s
  } else {
    const resume = args.includes('--resume') && existsSync(out)
    const data: MemoryData = resume ? JSON.parse(readFileSync(out, 'utf8')) : emptyData(defaultSourceRecords(env))
    mem = new MemoryStore(data)
    store = mem
  }

  const ai = env('ANTHROPIC_API_KEY') ? createAiService({ apiKey: env('ANTHROPIC_API_KEY'), model: env('AI_MODEL') }) : null
  const deps: PipelineDeps = {
    store, env, ai, http: new Http({ perHostDelayMs: 800 }), runtime: 'server',
    log: (m) => console.log(m), dataOrigin: storeKind === 'memory' ? 'snapshot' : 'pipeline',
  }

  const sourceArg = opt('sources', '')!
  const ids = sourceArg === 'due' ? defaultSourceRecords(env).filter((s) => s.enabled && s.role !== 'enrichment').map((s) => s.id) : sourceArg.split(',').filter(Boolean)
  for (const id of ids) {
    console.log(`\n=== ${id}`)
    const job = await runSource(deps, id, { budget, enrichNew: Number(opt('enrich', '8')) })
    console.log(`→ ${job.status}: fetched ${job.itemsFetched}, new mentions ${job.mentionsNew}, products +${job.productsCreated}, observations +${job.observationsNew}, events +${job.eventsNew}${job.error ? `, error: ${job.error}` : ''}`)
  }
  for (const url of multi('add')) {
    console.log(`\n=== add ${url}`)
    const r = await addProductByUrl(deps, url)
    console.log(`→ product ${r.productId} created=${r.created}${r.errors.length ? ` warnings: ${r.errors.join('; ')}` : ''}`)
  }
  if (enrichAll && mem) {
    const pending = mem.data.products.filter((p) => p.domain && !p.sourceIds.includes('website'))
    console.log(`\n=== enriching ${pending.length} products`)
    for (const p of pending.slice(0, Number(opt('enrich-limit', '40')))) {
      const r = await enrichProduct(deps, p.id)
      console.log(`  ${p.name}: +${r.mentions}${r.errors.length ? ` (${r.errors.join('; ')})` : ''}`)
    }
  }
  if (mem && args.includes('--recompute')) {
    for (const p of mem.data.products) await recomputeProduct(deps, p.id)
    mem.data.reports = []
  }
  if (mem) {
    // rule-based lite reports for everything (no cost); AI deep reports only if configured
    for (const p of mem.data.products) await generateReport(deps, p.id, ai && p.relevanceScore >= 60 ? 'deep' : 'lite')
    mem.data.meta = { createdAt: mem.data.meta.createdAt, snapshotCollectedAt: new Date().toISOString(), origin: 'snapshot' }
    mem.data.jobs = mem.data.jobs.slice(0, 50)
    writeFileSync(out, JSON.stringify(mem.data))
    const d = mem.data
    console.log(`\nSnapshot → ${out}: ${d.products.length} products, ${d.mentions.length} mentions, ${d.observations.length} observations, ${d.events.length} events, ${d.mergeCandidates.length} merge candidates`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
