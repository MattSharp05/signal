// On-demand research: deep report (AI if configured, otherwise rule-based) or ad creative analysis.
import { generateReport } from '../_shared/core/pipeline.ts'
import { fromRow, SupabaseStore } from '../_shared/core/supabase-store.ts'
import type { Advertisement } from '../_shared/core/types.ts'
import { aiService, authorize, cors, env, json, serviceClient } from '../_shared/server.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const db = serviceClient()
    const who = await authorize(req, db)
    if (!who) return json({ error: 'unauthorized' }, 401)
    const body = (await req.json()) as { productId?: string; adId?: string }
    const ai = aiService()
    if (body.adId) {
      if (!ai) return json({ error: 'AI is not configured (ANTHROPIC_API_KEY)' }, 400)
      const { data } = await db.from('advertisements').select('*').eq('id', body.adId).single()
      const analysis = await ai.analyzeAd(fromRow<Advertisement>(data))
      await db.from('advertisements').update({ analysis }).eq('id', body.adId)
      return json({ analysis })
    }
    if (!body.productId) return json({ error: 'productId is required' }, 400)
    const report = await generateReport({ store: new SupabaseStore(db), env, ai }, body.productId, 'deep')
    return json({ report })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
