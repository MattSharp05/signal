// Polite, robots-aware HTTP client shared by all connectors.

export const USER_AGENT = 'SignalBot/1.0 (+https://github.com/mattsharp05/signal; startup research; respects robots.txt)'

export class FetchError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public url: string,
    public code: 'http' | 'timeout' | 'network' | 'robots_disallowed' | 'blocked_url' | 'too_large' = 'http',
  ) {
    super(message)
  }
}

export interface HttpOptions {
  /** fetch implementation (injectable for tests) */
  fetch?: typeof fetch
  /** min delay between requests to the same host, ms */
  perHostDelayMs?: number
  timeoutMs?: number
  maxBytes?: number
  retries?: number
  /** skip robots.txt (only for official APIs, never for public pages) */
  respectRobots?: boolean
  /** browser mode: cannot set User-Agent; robots fetch may fail CORS → treated as unknown/allow for API hosts only */
  browser?: boolean
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?fc|\[?fd|metadata\.google\.internal)/i

export function assertPublicUrl(url: string): URL {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new FetchError('Invalid URL', null, url, 'blocked_url')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchError('Only http(s) URLs are allowed', null, url, 'blocked_url')
  if (PRIVATE_HOST.test(u.hostname)) {
    throw new FetchError('Private or local addresses are not allowed', null, url, 'blocked_url')
  }
  return u
}

// ---------------- robots.txt ----------------

interface RobotsRules {
  allow: string[]
  disallow: string[]
  fetchedAt: number
}

const robotsCache = new Map<string, RobotsRules | null>()

export function parseRobots(txt: string, agent = 'signalbot'): Omit<RobotsRules, 'fetchedAt'> {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = []
  let cur: { agents: string[]; allow: string[]; disallow: string[] } | null = null
  let lastWasAgent = false
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const val = line.slice(idx + 1).trim()
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] }
        groups.push(cur)
      }
      cur.agents.push(val.toLowerCase())
      lastWasAgent = true
    } else {
      lastWasAgent = false
      if (!cur) continue
      if (key === 'allow') cur.allow.push(val)
      else if (key === 'disallow' && val) cur.disallow.push(val)
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)))
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'))
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
  }
}

function ruleMatches(rule: string, path: string): number {
  // returns match length or -1
  const anchored = rule.endsWith('$')
  const body = anchored ? rule.slice(0, -1) : rule
  const re = new RegExp('^' + body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (anchored ? '$' : ''))
  return re.test(path) ? body.length : -1
}

export function robotsAllows(rules: Omit<RobotsRules, 'fetchedAt'>, pathWithQuery: string): boolean {
  let best = -1
  let allowed = true
  for (const r of rules.disallow) {
    const l = ruleMatches(r, pathWithQuery)
    if (l > best) {
      best = l
      allowed = false
    }
  }
  for (const r of rules.allow) {
    const l = ruleMatches(r, pathWithQuery)
    if (l >= best && l >= 0) {
      best = l
      allowed = true
    }
  }
  return allowed
}

// ---------------- client ----------------

const lastHit = new Map<string, number>()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class Http {
  private f: typeof fetch
  private opts: Required<Omit<HttpOptions, 'fetch'>>
  requests = 0

  constructor(opts: HttpOptions = {}) {
    this.f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
    this.opts = {
      perHostDelayMs: opts.perHostDelayMs ?? 1000,
      timeoutMs: opts.timeoutMs ?? 15000,
      maxBytes: opts.maxBytes ?? 2_000_000,
      retries: opts.retries ?? 2,
      respectRobots: opts.respectRobots ?? true,
      browser: opts.browser ?? false,
    }
  }

  async isAllowed(url: string): Promise<boolean> {
    const u = new URL(url)
    const key = u.origin
    let rules = robotsCache.get(key)
    if (rules === undefined || (rules && Date.now() - rules.fetchedAt > 24 * 3600_000)) {
      try {
        const res = await this.raw(`${u.origin}/robots.txt`, {}, false)
        if (res.status >= 400 && res.status < 500) rules = null // no robots → allowed
        else if (res.ok) rules = { ...parseRobots(await res.text()), fetchedAt: Date.now() }
        else rules = null
      } catch {
        rules = null
      }
      robotsCache.set(key, rules)
    }
    if (!rules) return true
    return robotsAllows(rules, u.pathname + u.search)
  }

  private async throttle(host: string) {
    const last = lastHit.get(host) ?? 0
    const wait = last + this.opts.perHostDelayMs - Date.now()
    if (wait > 0) await sleep(wait)
    lastHit.set(host, Date.now())
  }

  private async raw(url: string, init: RequestInit, throttle = true): Promise<Response> {
    const u = assertPublicUrl(url)
    if (throttle) await this.throttle(u.host)
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs)
    const headers = new Headers(init.headers)
    if (!this.opts.browser && !headers.has('user-agent')) headers.set('user-agent', USER_AGENT)
    try {
      if (this.opts.browser) {
        this.requests++
        return await this.f(url, { ...init, headers, signal: ctrl.signal, redirect: 'follow' })
      }
      // Server: follow redirects manually so every hop passes the public-URL (SSRF) check.
      let current = url
      for (let hop = 0; hop < 6; hop++) {
        this.requests++
        const res = await this.f(current, { ...init, headers, signal: ctrl.signal, redirect: 'manual' })
        const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
        if (!loc) return res
        current = new URL(loc, current).toString()
        assertPublicUrl(current)
      }
      throw new FetchError('Too many redirects', null, url, 'network')
    } catch (e) {
      if (e instanceof FetchError) throw e
      if ((e as Error).name === 'AbortError') throw new FetchError(`Timeout after ${this.opts.timeoutMs}ms`, null, url, 'timeout')
      throw new FetchError(`Network error: ${(e as Error).message}`, null, url, 'network')
    } finally {
      clearTimeout(t)
    }
  }

  /** Fetch with robots check (unless disabled), retries on 429/5xx, and a size cap. */
  async request(url: string, init: RequestInit & { robots?: boolean } = {}): Promise<Response> {
    const checkRobots = init.robots ?? this.opts.respectRobots
    if (checkRobots && !(await this.isAllowed(url))) {
      throw new FetchError('Disallowed by robots.txt', null, url, 'robots_disallowed')
    }
    let attempt = 0
    for (;;) {
      const res = await this.raw(url, init)
      if ((res.status === 429 || res.status >= 500) && attempt < this.opts.retries) {
        const ra = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 800 * 2 ** attempt)
        attempt++
        continue
      }
      return res
    }
  }

  async text(url: string, init: RequestInit & { robots?: boolean } = {}): Promise<string> {
    const res = await this.request(url, init)
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`, res.status, url)
    const len = Number(res.headers.get('content-length'))
    if (Number.isFinite(len) && len > this.opts.maxBytes) throw new FetchError('Response too large', res.status, url, 'too_large')
    const body = await res.text()
    if (body.length > this.opts.maxBytes * 2) return body.slice(0, this.opts.maxBytes * 2)
    return body
  }

  async json<T = unknown>(url: string, init: RequestInit & { robots?: boolean } = {}): Promise<T> {
    const res = await this.request(url, { ...init, robots: init.robots ?? false })
    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 200)
      } catch {
        /* ignore */
      }
      throw new FetchError(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status, url)
    }
    return (await res.json()) as T
  }
}
