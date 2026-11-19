// Deno-only helpers for Edge Functions.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createAiService } from './core/ai.ts'
import type { AiService } from './core/ai-types.ts'
import { defaultSourceRecords } from './core/connectors/index.ts'
import { SupabaseStore } from './core/supabase-store.ts'

export const env = (k: string) => Deno.env.get(k) ?? undefined

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
}

export function serviceClient(): SupabaseClient {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

/** Returns 'cron' for the scheduler secret, a user id for a valid user JWT, or null. */
export async function authorize(req: Request, db: SupabaseClient): Promise<'cron' | { userId: string } | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const cron = env('CRON_SECRET')
  if (cron && token === cron) return 'cron'
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  return { userId: data.user.id }
}

export function aiService(): AiService | null {
  const key = env('ANTHROPIC_API_KEY')
  if (!key) return null
  return createAiService({ apiKey: key, model: env('AI_MODEL') })
}

/** Make sure every registered connector has a sources row; refresh credential presence (never values). */
export async function syncSources(store: SupabaseStore) {
  const defaults = defaultSourceRecords(env)
  await store.upsertSources(defaults)
  for (const d of defaults) {
    if (!d.credentialEnv.length) continue
    const present = d.credentialEnv.every((k) => !!env(k))
    const cur = await store.getSource(d.id)
    if (!cur) continue
    const patch: Record<string, unknown> = { credentialsPresent: present }
    if (!present && cur.status !== 'unsupported' && cur.status !== 'licensed') patch.status = 'requires_credentials'
    if (present && cur.status === 'requires_credentials') patch.status = 'operational'
    await store.updateSource(d.id, patch)
  }
}
