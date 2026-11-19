// Daily/weekly digest: summarizes unread significant notifications per user. In-app always; email only if RESEND_API_KEY is set.
import { authorize, cors, env, json, serviceClient } from '../_shared/server.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = serviceClient()
  if ((await authorize(req, db)) !== 'cron') return json({ error: 'unauthorized' }, 401)
  const { data: prefs } = await db.from('notification_preferences').select('*').neq('digest', 'off')
  const day = new Date().getUTCDay()
  let sent = 0
  for (const p of prefs ?? []) {
    if (p.digest === 'weekly' && day !== 1) continue
    const since = new Date(Date.now() - (p.digest === 'weekly' ? 7 : 1) * 86400_000).toISOString()
    const { data: rows } = await db
      .from('notifications').select('id, created_at, product_events(title, detail, significance), products(name, slug)')
      .eq('user_id', p.user_id).is('read_at', null).gte('created_at', since).order('created_at', { ascending: false }).limit(50)
    if (!rows?.length) continue
    const key = env('RESEND_API_KEY')
    const from = env('DIGEST_FROM_EMAIL')
    if (p.email && key && from) {
      const { data: user } = await db.auth.admin.getUserById(p.user_id)
      const to = user.user?.email
      if (to) {
        // deno-lint-ignore no-explicit-any
        const lines = rows.map((r: any) => `• ${r.products?.name}: ${r.product_events?.title}${r.product_events?.detail ? ` — ${r.product_events.detail}` : ''}`)
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to, subject: `Signal digest: ${rows.length} update${rows.length > 1 ? 's' : ''}`, text: lines.join('\n') }),
        })
        if (res.ok) sent++
      }
    }
  }
  return json({ ok: true, emailed: sent })
})
