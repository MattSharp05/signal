// Dependency-free HTML/XML helpers (no DOMParser so they run in Deno, Node and browsers alike).

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', copy: '©', reg: '®', trade: '™',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return NAMED[e.toLowerCase()] ?? m
  })
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ')
}

export function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Visible text of an HTML document (scripts/styles/svg removed). */
export function htmlToText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr|br)>/gi, '$&\n')
  return collapse(decodeEntities(stripTags(body)))
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  if (!m) return null
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
}

export interface PageMeta {
  title: string | null
  description: string | null
  ogTitle: string | null
  ogDescription: string | null
  ogImage: string | null
  siteName: string | null
  canonical: string | null
  icon: string | null
  lang: string | null
}

export function extractMeta(html: string, baseUrl?: string): PageMeta {
  const head = html.slice(0, 200_000)
  const metas = head.match(/<meta\b[^>]*>/gi) ?? []
  const get = (key: string) => {
    for (const t of metas) {
      const n = (attr(t, 'name') ?? attr(t, 'property') ?? '').toLowerCase()
      if (n === key) return attr(t, 'content')
    }
    return null
  }
  const titleM = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const links = head.match(/<link\b[^>]*>/gi) ?? []
  let icon: string | null = null
  let canonical: string | null = null
  let bestIconScore = -1
  for (const l of links) {
    const rel = (attr(l, 'rel') ?? '').toLowerCase()
    const href = attr(l, 'href')
    if (!href) continue
    if (rel === 'canonical') canonical = href
    if (rel.includes('icon')) {
      const sizes = attr(l, 'sizes') ?? ''
      const px = parseInt(sizes, 10) || (rel.includes('apple') ? 180 : 32)
      const score = href.endsWith('.svg') ? 1000 : px
      if (score > bestIconScore) {
        bestIconScore = score
        icon = href
      }
    }
  }
  const abs = (u: string | null) => {
    if (!u || !baseUrl) return u
    try {
      return new URL(u, baseUrl).toString()
    } catch {
      return u
    }
  }
  const langM = head.match(/<html[^>]*\blang\s*=\s*["']?([a-zA-Z-]+)/i)
  return {
    title: titleM ? collapse(decodeEntities(stripTags(titleM[1]))) : null,
    description: get('description'),
    ogTitle: get('og:title'),
    ogDescription: get('og:description'),
    ogImage: abs(get('og:image')),
    siteName: get('og:site_name') ?? get('application-name'),
    canonical: abs(canonical),
    icon: abs(icon),
    lang: langM ? langM[1] : null,
  }
}

/** All JSON-LD blocks, flattened (@graph expanded). Invalid JSON is skipped. */
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const it of items) {
        if (it && typeof it === 'object') {
          const graph = (it as Record<string, unknown>)['@graph']
          if (Array.isArray(graph)) out.push(...(graph as Record<string, unknown>[]))
          else out.push(it as Record<string, unknown>)
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out
}

export function ldOfType(blocks: Record<string, unknown>[], type: string): Record<string, unknown> | undefined {
  return blocks.find((b) => {
    const t = b['@type']
    return t === type || (Array.isArray(t) && t.includes(type))
  })
}

export interface SitemapEntry {
  loc: string
  lastmod: string | null
}

export function parseSitemap(xml: string): { urls: SitemapEntry[]; sitemaps: string[] } {
  const urls: SitemapEntry[] = []
  const sitemaps: string[] = []
  const blockRe = /<(url|sitemap)>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(xml))) {
    const loc = m[2].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1]
    if (!loc) continue
    const lastmod = m[2].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i)?.[1] ?? null
    if (m[1].toLowerCase() === 'sitemap') sitemaps.push(decodeEntities(loc))
    else urls.push({ loc: decodeEntities(loc), lastmod })
  }
  return { urls, sitemaps }
}

export interface FeedItem {
  id: string
  title: string
  link: string
  links: string[]
  published: string | null
  updated: string | null
  author: string | null
  contentHtml: string
  categories: string[]
}

function tagText(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (!m) return null
  let v = m[1].trim()
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  if (cdata) v = cdata[1]
  return v
}

/** Minimal RSS 2.0 + Atom parser. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = []
  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml)
  const re = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi
  for (const block of xml.match(re) ?? []) {
    const links: string[] = []
    if (isAtom) {
      for (const l of block.match(/<link\b[^>]*>/gi) ?? []) {
        const href = attr(l, 'href')
        if (href) links.push(href)
      }
    } else {
      const l = tagText(block, 'link')
      if (l) links.push(decodeEntities(l))
    }
    const rawContent = tagText(block, 'content') ?? tagText(block, 'description') ?? tagText(block, 'summary') ?? ''
    const content = rawContent.includes('&lt;') ? decodeEntities(rawContent) : rawContent
    const cats = [...block.matchAll(/<category(?:\s[^>]*term="([^"]*)")?[^>]*>(?:([\s\S]*?)<\/category>)?/gi)]
      .map((c) => decodeEntities((c[1] ?? c[2] ?? '').trim()))
      .filter(Boolean)
    const title = decodeEntities(collapse(stripTags(tagText(block, 'title') ?? '')))
    items.push({
      id: decodeEntities(tagText(block, 'id') ?? tagText(block, 'guid') ?? links[0] ?? title),
      title,
      link: links[0] ?? '',
      links,
      published: tagText(block, 'published') ?? tagText(block, 'pubDate') ?? null,
      updated: tagText(block, 'updated') ?? null,
      author: tagText(block, 'name') ?? tagText(block, 'author') ?? tagText(block, 'dc:creator') ?? null,
      contentHtml: content,
      categories: cats,
    })
  }
  return items
}

export function hrefs(html: string, baseUrl?: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const h = decodeEntities(m[2] ?? m[3] ?? '')
    if (!h || h.startsWith('#') || h.startsWith('mailto:') || h.startsWith('javascript:')) continue
    try {
      out.push(baseUrl ? new URL(h, baseUrl).toString() : h)
    } catch {
      /* ignore */
    }
  }
  return out
}

export function toIsoDate(s: string | null | undefined): string | undefined {
  if (!s) return undefined
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}
