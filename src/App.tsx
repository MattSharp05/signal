import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { TooltipProvider } from '@/components/ui/overlay'
import { RepositoryProvider, useRepoContext } from '@/data/context'
import Discover from '@/pages/Discover'

const Watchlist = lazy(() => import('@/pages/Watchlist'))
const Opportunities = lazy(() => import('@/pages/Opportunities'))
const Trends = lazy(() => import('@/pages/Trends'))
const Sources = lazy(() => import('@/pages/Sources'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const ProductPage = lazy(() => import('@/pages/ProductPage'))
const Login = lazy(() => import('@/pages/Login'))

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } } })

const Fallback = () => (
  <div className="flex h-full items-center justify-center text-muted">
    <Loader2 className="size-4 animate-spin" />
  </div>
)

const s = (el: React.ReactNode) => <Suspense fallback={<Fallback />}>{el}</Suspense>

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Discover /> },
      { path: '/watchlist', element: s(<Watchlist />) },
      { path: '/opportunities', element: s(<Opportunities />) },
      { path: '/trends', element: s(<Trends />) },
      { path: '/sources', element: s(<Sources />) },
      { path: '/settings', element: s(<SettingsPage />) },
      { path: '/p/:slug', element: s(<ProductPage />) },
      { path: '*', element: <Discover /> },
    ],
  },
])

function Gate() {
  const { mode, session, authReady } = useRepoContext()
  if (!authReady) return <Fallback />
  if (mode === 'supabase' && !session) return s(<Login />)
  return <RouterProvider router={router} />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RepositoryProvider>
        <TooltipProvider delayDuration={250}>
          <Gate />
        </TooltipProvider>
      </RepositoryProvider>
    </QueryClientProvider>
  )
}
