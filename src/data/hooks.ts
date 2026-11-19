import { reweight } from '@core/scoring.ts'
import type { OpportunityScore, ScoreWeights } from '@core/types.ts'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRepo } from './context'
import type { FeedFilters, ManualAdInput, Note, OpportunityRow, Settings, UserState } from './repository'

const EMPTY_USER: UserState = { saved: [], tracked: [], collections: [], collectionProducts: [] }

export function useMeta() {
  const repo = useRepo()
  return useQuery({ queryKey: ['meta'], queryFn: () => repo.meta(), staleTime: Infinity })
}

export function useUserState() {
  const repo = useRepo()
  const q = useQuery({ queryKey: ['user'], queryFn: () => repo.userState() })
  return { ...q, data: q.data ?? EMPTY_USER }
}

export function useFeed(filters: FeedFilters) {
  const repo = useRepo()
  const user = useUserState().data
  const needsUser = filters.savedOnly || filters.trackedOnly
  return useInfiniteQuery({
    queryKey: ['feed', filters, needsUser ? user : null],
    queryFn: ({ pageParam }) => repo.listFeed(filters, pageParam, 40, user),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useProduct(slugOrId: string | null) {
  const repo = useRepo()
  return useQuery({ queryKey: ['product', slugOrId], queryFn: () => repo.getProduct(slugOrId!), enabled: !!slugOrId })
}

export function useProductsByIds(ids: string[]) {
  const repo = useRepo()
  return useQuery({ queryKey: ['products', [...ids].sort()], queryFn: () => repo.productsByIds(ids), enabled: ids.length > 0, placeholderData: keepPreviousData })
}

export function useAllProducts() {
  const repo = useRepo()
  return useQuery({ queryKey: ['all-products'], queryFn: () => repo.allProductsLite(), staleTime: 60_000 })
}

export function useRecentEvents(limit = 60) {
  const repo = useRepo()
  return useQuery({ queryKey: ['recent-events', limit], queryFn: () => repo.recentEvents(limit) })
}

function useInvalidate() {
  const qc = useQueryClient()
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
}

export function useSaveMutation() {
  const repo = useRepo()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { productId: string; saved: boolean; collectionId?: string | null }) => repo.setSaved(v.productId, v.saved, { collectionId: v.collectionId }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['user'] })
      const prev = qc.getQueryData<UserState>(['user'])
      if (prev) {
        const saved = prev.saved.filter((s) => s.productId !== v.productId)
        if (v.saved) saved.unshift({ productId: v.productId, collectionId: v.collectionId ?? null, note: null, createdAt: new Date().toISOString() })
        qc.setQueryData<UserState>(['user'], { ...prev, saved })
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['user'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['user'] }),
  })
}

export function useTrackMutation() {
  const repo = useRepo()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { productId: string; tracked: boolean; minSignificance?: number }) => repo.setTracked(v.productId, v.tracked, v.minSignificance),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['user'] })
      const prev = qc.getQueryData<UserState>(['user'])
      if (prev) {
        const tracked = prev.tracked.filter((s) => s.productId !== v.productId)
        if (v.tracked) tracked.unshift({ productId: v.productId, minSignificance: v.minSignificance ?? 50, createdAt: new Date().toISOString() })
        qc.setQueryData<UserState>(['user'], { ...prev, tracked })
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['user'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['user'] }),
  })
}

export function useCollectionMutations() {
  const repo = useRepo()
  const inv = useInvalidate()
  return {
    create: useMutation({ mutationFn: (name: string) => repo.createCollection(name), onSettled: () => inv('user') }),
    remove: useMutation({ mutationFn: (id: string) => repo.deleteCollection(id), onSettled: () => inv('user') }),
    add: useMutation({ mutationFn: (v: { collectionId: string; productId: string }) => repo.addToCollection(v.collectionId, v.productId), onSettled: () => inv('user') }),
    removeProduct: useMutation({ mutationFn: (v: { collectionId: string; productId: string }) => repo.removeFromCollection(v.collectionId, v.productId), onSettled: () => inv('user') }),
  }
}

export function useNotes(productId: string) {
  const repo = useRepo()
  const inv = useInvalidate()
  const q = useQuery({ queryKey: ['notes', productId], queryFn: () => repo.listNotes(productId) })
  const add = useMutation({ mutationFn: (v: { body: string; kind: Note['kind'] }) => repo.addNote(productId, v.body, v.kind), onSettled: () => inv('notes') })
  const remove = useMutation({ mutationFn: (id: string) => repo.deleteNote(id), onSettled: () => inv('notes') })
  return { ...q, add, remove }
}

export function useOpportunities() {
  const repo = useRepo()
  const inv = useInvalidate()
  const q = useQuery({ queryKey: ['opportunities'], queryFn: () => repo.listOpportunities() })
  const save = useMutation({ mutationFn: (o: Partial<OpportunityRow> & { title: string }) => repo.saveOpportunity(o), onSettled: () => inv('opportunities') })
  const remove = useMutation({ mutationFn: (id: string) => repo.deleteOpportunity(id), onSettled: () => inv('opportunities') })
  return { ...q, save, remove }
}

export function useUpdates() {
  const repo = useRepo()
  const inv = useInvalidate()
  const q = useQuery({ queryKey: ['updates'], queryFn: () => repo.listUpdates() })
  const markRead = useMutation({ mutationFn: (ids: string[]) => repo.markUpdatesRead(ids), onSettled: () => inv('updates') })
  return { ...q, markRead }
}

export function useSources() {
  const repo = useRepo()
  const inv = useInvalidate()
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => repo.listSources() })
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => repo.listJobs(40) })
  const merge = useQuery({ queryKey: ['merge-candidates'], queryFn: () => repo.listMergeCandidates() })
  const update = useMutation({ mutationFn: (v: { id: string; enabled?: boolean; refreshMinutes?: number }) => repo.updateSource(v.id, v), onSettled: () => inv('sources') })
  const run = useMutation({ mutationFn: (id: string) => repo.runSource(id), onSettled: () => inv('sources', 'jobs', 'feed', 'all-products', 'recent-events', 'updates', 'merge-candidates') })
  const addRss = useMutation({ mutationFn: (v: { url: string; name: string }) => repo.addRssSource(v.url, v.name), onSettled: () => inv('sources') })
  const doMerge = useMutation({ mutationFn: (v: { survivor: string; loser: string; id: string }) => repo.mergeProducts(v.survivor, v.loser, v.id), onSettled: () => inv('merge-candidates', 'feed', 'product', 'all-products') })
  const dismiss = useMutation({ mutationFn: (id: string) => repo.dismissMergeCandidate(id), onSettled: () => inv('merge-candidates') })
  return { sources, jobs, merge, update, run, addRss, doMerge, dismiss }
}

export function useAddProduct() {
  const repo = useRepo()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (url: string) => repo.addProduct(url), onSettled: () => inv('feed', 'all-products', 'product', 'sources') })
}

export function useReportMutation(productId: string) {
  const repo = useRepo()
  const inv = useInvalidate()
  return useMutation({ mutationFn: () => repo.generateReport(productId), onSettled: () => inv('product') })
}

export function useAdMutations(productId: string) {
  const repo = useRepo()
  const inv = useInvalidate()
  return {
    add: useMutation({ mutationFn: (ad: ManualAdInput) => repo.addManualAd(productId, ad), onSettled: () => inv('product') }),
    analyze: useMutation({ mutationFn: (adId: string) => repo.analyzeAd(adId), onSettled: () => inv('product') }),
  }
}

export function useSettings() {
  const repo = useRepo()
  const inv = useInvalidate()
  const q = useQuery({ queryKey: ['settings'], queryFn: () => repo.getSettings(), staleTime: Infinity })
  const save = useMutation({ mutationFn: (s: Settings) => repo.saveSettings(s), onSettled: () => inv('settings', 'feed', 'product', 'all-products') })
  return { ...q, save }
}

/** Opportunity score with the current user's weights applied. */
export function useWeightedScore(score: OpportunityScore | null): OpportunityScore | null {
  const { data } = useSettings()
  if (!score) return null
  return data ? reweight(score, data.weights as ScoreWeights) : score
}
