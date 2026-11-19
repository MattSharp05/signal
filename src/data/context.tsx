import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { LocalRepository } from './local-repository'
import type { Repository } from './repository'
import { SupabaseRepository } from './supabase-repository'

interface Ctx {
  repo: Repository
  mode: 'local' | 'supabase'
  session: Session | null
  authReady: boolean
}

const RepoContext = createContext<Ctx | null>(null)

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const repo = useMemo<Repository>(() => (supabase ? new SupabaseRepository(supabase) : new LocalRepository()), [])
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return <RepoContext.Provider value={{ repo, mode: supabase ? 'supabase' : 'local', session, authReady }}>{children}</RepoContext.Provider>
}

export function useRepoContext() {
  const c = useContext(RepoContext)
  if (!c) throw new Error('RepositoryProvider missing')
  return c
}

export const useRepo = () => useRepoContext().repo
