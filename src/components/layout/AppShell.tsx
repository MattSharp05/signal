import { Bookmark, Compass, Database, Folder, Lightbulb, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, TrendingUp } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { Logo, LogoMark } from '@/components/brand/Logo'
import { ResearchPanel } from '@/components/product/ResearchPanel'
import { Button } from '@/components/ui/button'
import { Sheet, Tooltip } from '@/components/ui/overlay'
import { useRepoContext } from '@/data/context'
import { useMeta, useUpdates, useUserState } from '@/data/hooks'
import { supabase } from '@/lib/supabase'
import { cn, formatDate } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Discover', icon: Compass, end: true },
  { to: '/watchlist', label: 'Watchlist', icon: Bookmark },
  { to: '/opportunities', label: 'Opportunities', icon: Lightbulb },
  { to: '/trends', label: 'Trends', icon: TrendingUp },
  { to: '/sources', label: 'Sources', icon: Database },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function NavItems({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const unread = useUpdates().data?.filter((u) => !u.read).length ?? 0
  const user = useUserState().data
  return (
    <>
      <nav className="space-y-0.5 px-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <Tooltip key={to} content={collapsed ? label : undefined} side="right">
            <NavLink
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors',
                  isActive ? 'bg-bg text-text shadow-[0_0_0_1px_var(--border)]' : 'text-muted hover:bg-surface hover:text-text',
                  collapsed && 'justify-center px-0',
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              {collapsed ? null : <span className="flex-1">{label}</span>}
              {!collapsed && label === 'Watchlist' && unread ? <span className="tnum rounded bg-accent px-1.5 text-2xs text-white">{unread}</span> : null}
            </NavLink>
          </Tooltip>
        ))}
      </nav>
      {!collapsed && user.collections.length ? (
        <div className="mt-6 px-2">
          <div className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-subtle">Collections</div>
          {user.collections.map((c) => (
            <NavLink
              key={c.id}
              to={`/watchlist?collection=${c.id}`}
              onClick={onNavigate}
              className="flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-surface hover:text-text"
            >
              <Folder className="size-3.5" />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="tnum text-2xs text-subtle">{user.collectionProducts.filter((x) => x.collectionId === c.id).length}</span>
            </NavLink>
          ))}
        </div>
      ) : null}
    </>
  )
}

function DataModeNote({ collapsed }: { collapsed: boolean }) {
  const meta = useMeta().data
  const { session } = useRepoContext()
  if (!meta || collapsed) return null
  return (
    <div className="mx-3 mb-3 space-y-2 text-2xs text-muted">
      {meta.mode === 'local' ? (
        <div className="rounded-md border border-dashed border-border-strong p-2 leading-snug">
          <div className="font-semibold text-text">Local mode</div>
          {meta.snapshotCollectedAt ? <>Real pipeline snapshot collected {formatDate(meta.snapshotCollectedAt)}. </> : null}
          Connect Supabase for scheduled ingestion.
        </div>
      ) : session ? (
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{session.user.email}</span>
          <Tooltip content="Sign out">
            <button className="rounded p-1 hover:bg-surface" onClick={() => supabase?.auth.signOut()} aria-label="Sign out">
              <LogOut className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      ) : null}
    </div>
  )
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('signal.sidebar') === 'collapsed'
    } catch {
      return false
    }
  })
  const [mobileNav, setMobileNav] = useState(false)
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const selected = location.pathname.startsWith('/p/') ? null : params.get('p')
  const close = useCallback(() => {
    const next = new URLSearchParams(params)
    next.delete('p')
    setParams(next, { replace: true })
  }, [params, setParams])
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('signal.sidebar', c ? 'open' : 'collapsed')
      } catch {
        /* ignore */
      }
      return !c
    })
  }

  return (
    <div className="flex h-full overflow-hidden">
      <aside className={cn('hidden shrink-0 flex-col border-r border-border bg-sidebar md:flex', collapsed ? 'w-14' : 'w-56')}>
        <div className={cn('flex h-12 items-center', collapsed ? 'justify-center' : 'justify-between px-4')}>
          {collapsed ? <LogoMark size={22} /> : <Logo size={20} />}
        </div>
        <div className="mt-2 flex-1 overflow-y-auto">
          <NavItems collapsed={collapsed} />
        </div>
        <DataModeNote collapsed={collapsed} />
        <div className={cn('border-t border-border p-2', collapsed && 'flex justify-center')}>
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>
      </aside>

      <Sheet open={mobileNav} onOpenChange={setMobileNav} title="Navigation" side="left">
        <div className="flex h-full flex-col bg-sidebar">
          <div className="flex h-12 items-center px-4">
            <Logo />
          </div>
          <div className="flex-1">
            <NavItems collapsed={false} onNavigate={() => setMobileNav(false)} />
          </div>
          <DataModeNote collapsed={false} />
        </div>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileNav(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <Logo size={18} />
        </div>
        <main className="min-h-0 flex-1 overflow-hidden">{children ?? <Outlet />}</main>
      </div>

      <ResearchPanel slug={selected} onClose={close} />
    </div>
  )
}
