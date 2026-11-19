import type { Alias } from './types.ts'

/** Hosts where many unrelated products live under one registrable domain: identity = full host (+ path for path-based hosts). */
const SUBDOMAIN_HOSTS = [
  'vercel.app',
  'netlify.app',
  'github.io',
  'gitlab.io',
  'notion.site',
  'framer.website',
  'framer.ai',
  'lovable.app',
  'replit.app',
  'repl.co',
  'bubbleapps.io',
  'webflow.io',
  'pages.dev',
  'workers.dev',
  'herokuapp.com',
  'fly.dev',
  'onrender.com',
  'carrd.co',
  'super.site',
  'substack.com',
  'gumroad.com',
  'streamlit.app',
  'hf.space',
  'web.app',
  'firebaseapp.com',
  'blogspot.com',
  'wordpress.com',
  'medium.com',
]

/** Hosts whose first one/two path segments identify a product. */
const PATH_HOSTS: Record<string, number> = {
  'github.com': 2,
  'gitlab.com': 2,
  'huggingface.co': 2,
  'apps.apple.com': 4, // /us/app/name/id123 → keep id
  'play.google.com': 0, // handled via ?id=
  'chromewebstore.google.com': 3,
  'chrome.google.com': 4,
  'marketplace.visualstudio.com': 0,
  'npmjs.com': 2,
  'pypi.org': 2,
}

/** Aggregators / media that never become a product's domain. */
const AGGREGATOR_HOSTS = [
  'producthunt.com',
  'news.ycombinator.com',
  'ycombinator.com',
  'reddit.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'indiehackers.com',
  'starterstory.com',
  'trustmrr.com',
  'quietmoney.000ooo.ooo',
  '000ooo.ooo',
  'cashflowing.app',
  'acquire.com',
  'google.com',
  'bit.ly',
  't.co',
  'lnkd.in',
  'discord.gg',
  'discord.com',
  'loom.com',
  'docs.google.com',
  'drive.google.com',
]

const MULTI_PART_SUFFIXES = [
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au',
  'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'com.mx', 'com.ar', 'com.co', 'com.tr', 'com.cn', 'com.hk', 'com.sg', 'com.tw', 'com.my',
  'co.in', 'co.kr', 'co.nz', 'co.za', 'co.il', 'co.id', 'co.th',
]

const TRACKING_PARAMS = /^(utm_|ref$|ref_|fbclid$|gclid$|mc_|_hs|igshid$|si$|source$)/i

export function safeUrl(input: string | undefined | null): URL | null {
  if (!input) return null
  let s = input.trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.')) return null
    return u
  } catch {
    return null
  }
}

export function cleanHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '').replace(/^(www\d?|m)\./, '')
}

export function registrableDomain(host: string): string {
  const h = cleanHost(host)
  const parts = h.split('.')
  if (parts.length <= 2) return h
  const last2 = parts.slice(-2).join('.')
  if (MULTI_PART_SUFFIXES.includes(last2)) return parts.slice(-3).join('.')
  return last2
}

function hostMatches(host: string, list: string[]): string | null {
  for (const d of list) if (host === d || host.endsWith(`.${d}`)) return d
  return null
}

export function isAggregatorHost(host: string): boolean {
  return hostMatches(cleanHost(host), AGGREGATOR_HOSTS) !== null
}

export interface NormalizedUrl {
  url: string // canonical https URL without tracking params / fragments
  host: string // cleaned host
  domain: string | null // registrable domain identity (null when shared host / aggregator)
  hostPath: string | null // identity for shared hosts, e.g. github.com/owner/repo, foo.vercel.app
  isAggregator: boolean
}

export function normalizeUrl(input: string | undefined | null): NormalizedUrl | null {
  const u = safeUrl(input)
  if (!u) return null
  u.hash = ''
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k)
  u.protocol = 'https:'
  const host = cleanHost(u.hostname)
  const pathname = u.pathname.replace(/\/+$/, '')
  const url = `https://${host}${pathname}${u.search}`

  if (isAggregatorHost(host)) return { url, host, domain: null, hostPath: null, isAggregator: true }

  const sub = hostMatches(host, SUBDOMAIN_HOSTS)
  if (sub) {
    // the bare platform host itself is not a product identity
    if (host === sub) return { url, host, domain: null, hostPath: null, isAggregator: true }
    return { url, host, domain: null, hostPath: host, isAggregator: false }
  }

  if (host in PATH_HOSTS) {
    const segs = pathname.split('/').filter(Boolean)
    if (host === 'play.google.com') {
      const id = u.searchParams.get('id')
      return { url, host, domain: null, hostPath: id ? `${host}/${id.toLowerCase()}` : null, isAggregator: !id }
    }
    if (host === 'apps.apple.com') {
      const id = segs.find((s) => /^id\d+$/.test(s))
      return { url, host, domain: null, hostPath: id ? `${host}/${id}` : null, isAggregator: !id }
    }
    const n = PATH_HOSTS[host]
    if (n > 0 && segs.length >= n) {
      return { url, host, domain: null, hostPath: `${host}/${segs.slice(0, n).join('/').toLowerCase()}`, isAggregator: false }
    }
    return { url, host, domain: null, hostPath: null, isAggregator: true }
  }

  return { url, host, domain: registrableDomain(host), hostPath: null, isAggregator: false }
}

/** Normalized product name used for name aliases: lowercase, alnum only, strip common suffixes. */
export function normalizeName(name: string | undefined | null): string {
  if (!name) return ''
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(show hn|launch hn|ask hn)\s*:\s*/i, '')
    .replace(/\b(inc|llc|ltd|gmbh|corp|co|app|ai|hq|io)\b\.?/g, ' ')
    .replace(/\.(com|io|ai|app|co|so|dev|net|org)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

export function slugify(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'product'
  )
}

/** Derive identity aliases for a website URL. */
export function aliasesForUrl(input: string | undefined | null): Alias[] {
  const n = normalizeUrl(input)
  if (!n || n.isAggregator) return []
  if (n.domain) return [{ kind: 'domain', value: n.domain }]
  if (n.hostPath) {
    const out: Alias[] = [{ kind: 'host_path', value: n.hostPath }]
    if (n.hostPath.startsWith('github.com/')) out.push({ kind: 'github_repo', value: n.hostPath.slice('github.com/'.length) })
    return out
  }
  return []
}

export const STRONG_ALIAS_KINDS = new Set(['domain', 'host_path', 'ph_slug', 'github_repo', 'trustmrr_slug'])

export function dedupeAliases(aliases: Alias[]): Alias[] {
  const seen = new Set<string>()
  const out: Alias[] = []
  for (const a of aliases) {
    const v = a.value.trim().toLowerCase()
    if (!v) continue
    const k = `${a.kind}:${v}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ kind: a.kind, value: v })
  }
  return out
}

/** Title-case a bare domain label as a fallback name: "whatbrandonthinks.com" → "Whatbrandonthinks". */
export function nameFromDomain(domain: string): string {
  const label = domain.split('.')[0] ?? domain
  return label.charAt(0).toUpperCase() + label.slice(1)
}
