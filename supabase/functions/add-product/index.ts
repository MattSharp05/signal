// Manual submission: paste a URL → dedupe → crawl public site → enrich from connected sources → profile id.
import { Http } from '../_shared/core/http.ts'
import { addProductByUrl } from '../_shared/core/pipeline.ts'
import { SupabaseStore } from '../_shared/core/supabase-store.ts'
import { aiService, authorize, cors, env, json, serviceClient } from '../_shared/server.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const db = serviceClient()
    const who = await authorize(req, db)
    if (!who || who === 'cron') return json({ error: 'unauthorized' }, 401)
    const { url } = (await req.json()) as { url?: string }
    if (!url) return json({ error: 'url is required' }, 400)
    const store = new SupabaseStore(db)
    const res = await addProductByUrl({ store, http: new Http(), env, ai: aiService() }, url)
    const p = await store.getProduct(res.productId)
    return json({ productId: res.productId, slug: p?.slug, created: res.created, warnings: res.errors })
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }
})
