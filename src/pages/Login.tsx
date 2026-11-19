import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { LogoMark } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex min-h-full items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-bg p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <LogoMark size={36} />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Sign in to Signal</h1>
            <p className="text-[13px] text-muted">Startup intelligence for your team</p>
          </div>
        </div>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!supabase) return
            setBusy(true)
            setMsg(null)
            const res =
              mode === 'magic'
                ? await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
                : await supabase.auth.signInWithPassword({ email, password })
            setBusy(false)
            if (res.error) setMsg({ ok: false, text: res.error.message })
            else if (mode === 'magic') setMsg({ ok: true, text: 'Check your email for a sign-in link.' })
          }}
        >
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email" className="mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {mode === 'password' ? (
            <div>
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" required autoComplete="current-password" className="mt-1" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          ) : null}
          {msg ? <p className={msg.ok ? 'text-xs text-positive' : 'text-xs text-negative'}>{msg.text}</p> : null}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {mode === 'magic' ? 'Send magic link' : 'Sign in'}
          </Button>
          <button type="button" className="w-full text-center text-xs text-muted hover:text-accent" onClick={() => setMode(mode === 'magic' ? 'password' : 'magic')}>
            {mode === 'magic' ? 'Use a password instead' : 'Email me a sign-in link instead'}
          </button>
        </form>
      </div>
    </div>
  )
}
