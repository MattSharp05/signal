// Lightweight, deterministic categorization used at ingestion time (AI may refine later).

export const CATEGORIES = [
  'Consumer AI',
  'AI Utility',
  'Developer Tools',
  'Productivity',
  'Marketing',
  'Sales & CRM',
  'Finance',
  'Education',
  'Health & Wellness',
  'Relationships & Social',
  'Design & Creative',
  'Video & Audio',
  'E-commerce',
  'Analytics & Data',
  'Security & Privacy',
  'Entertainment & Games',
  'Travel & Lifestyle',
  'Hardware',
  'Other',
] as const
export type Category = (typeof CATEGORIES)[number]

const RULES: [Category, RegExp][] = [
  ['Relationships & Social', /\b(relationship|dating|couple|friend(s|ship)?|group chat|whatsapp|imessage|social network|crush|situationship|texts?)\b/i],
  ['Developer Tools', /\b(developer|devtool|api|sdk|cli|open[- ]source|github|code|coding|programming|debug|deploy|kubernetes|database|postgres|sql|typescript|javascript|python|rust|llm ops|mcp|agentic coding|terminal|ide|compiler)\b/i],
  ['Video & Audio', /\b(video|podcast|audio|music|song|voice|transcri\w+|subtitle|youtube|tiktok clips?|shorts)\b/i],
  ['Design & Creative', /\b(design|figma|logo|image generat\w+|photo|illustrat\w+|ui kit|mockup|font|creative|art|headshot|avatar)\b/i],
  ['Marketing', /\b(marketing|seo|ads?|advertis\w+|newsletter|email campaign|social media|influencer|ugc|growth hack\w*|landing page|copywriting|outreach)\b/i],
  ['Sales & CRM', /\b(sales|crm|leads?|prospect\w*|cold email|pipeline|b2b outreach)\b/i],
  ['Finance', /\b(finance|budget\w*|invoice|accounting|tax|invest\w*|stock|crypto|trading|payment|bank\w*|expense|savings?)\b/i],
  ['Education', /\b(learn\w*|study|student|course|quiz|flashcard|language|tutor\w*|homework|exam|teach\w*|school)\b/i],
  ['Health & Wellness', /\b(health|fitness|workout|diet|nutrition|sleep|meditat\w+|therapy|mental|wellness|habit|coach\w*|tarot|astrolog\w+|horoscope)\b/i],
  ['E-commerce', /\b(e-?commerce|shopify|store|marketplace|dropship\w*|product listing|amazon seller|etsy)\b/i],
  ['Analytics & Data', /\b(analytics|dashboard|metrics|data pipeline|bi\b|report(ing)? tool|scrap\w+|monitor\w*)\b/i],
  ['Security & Privacy', /\b(security|privacy|password|vpn|encrypt\w*|auth\w*|vulnerab\w+|compliance|soc ?2)\b/i],
  ['Entertainment & Games', /\b(game|gaming|fun|meme|roast|quiz game|trivia|puzzle|anime|movie|streaming)\b/i],
  ['Travel & Lifestyle', /\b(travel|trip|hotel|flight|recipe|cooking|food|home|pet|fashion|outfit)\b/i],
  ['Productivity', /\b(productiv\w+|task|todo|to-do|notes?|calendar|schedul\w+|meeting|workflow|automat\w+|docs?|pdf|spreadsheet|email|inbox|writing|summar\w+)\b/i],
  ['Hardware', /\b(hardware|device|wearable|3d print\w*|robot(ics)?|iot|arduino|raspberry)\b/i],
]

const AI_RE = /\b(ai|a\.i\.|gpt|llm|chatgpt|claude|gemini|machine learning|neural|genai|generative|agent(s|ic)?)\b/i
const CONSUMER_RE = /\b(friends?|relationship|dating|roast|horoscope|tarot|selfie|couples?|family|kids|parents|group chat|personality|outfit|wellbeing|consumers?)\b/i

export function categorize(text: string): { category: Category; tags: string[]; isAI: boolean } {
  const t = text.slice(0, 4000)
  const isAI = AI_RE.test(t)
  const hits = RULES.filter(([, re]) => re.test(t)).map(([c]) => c)
  let category: Category = hits[0] ?? 'Other'
  const consumer = isAI && CONSUMER_RE.test(t) && category !== 'Developer Tools'
  if (isAI && (category === 'Other' || category === 'Productivity')) {
    category = consumer && category === 'Other' ? 'Consumer AI' : 'AI Utility'
  }
  const tags = new Set<string>()
  if (isAI) tags.add('AI')
  if (consumer) tags.add('Consumer AI')
  for (const c of hits.slice(0, 3)) tags.add(c)
  return { category, tags: [...tags], isAI }
}

export function detectPlatforms(text: string, urls: string[] = []): string[] {
  const p = new Set<string>()
  const all = `${text} ${urls.join(' ')}`
  if (/apps\.apple\.com|\bios\b|iphone|ipad|app store/i.test(all)) p.add('iOS')
  if (/play\.google\.com|\bandroid\b/i.test(all)) p.add('Android')
  if (/chrome(webstore)?\.google\.com|chrome extension|browser extension/i.test(all)) p.add('Browser extension')
  if (/\bmacos\b|\bmac app\b|menu ?bar/i.test(all)) p.add('macOS')
  if (/\bwindows\b/i.test(all)) p.add('Windows')
  if (/\bcli\b|command[- ]line|terminal/i.test(all)) p.add('CLI')
  if (/\bapi\b/i.test(text)) p.add('API')
  if (/github\.com\//i.test(urls.join(' '))) p.add('Open source')
  if (p.size === 0 || urls.some((u) => /^https?:\/\//.test(u) && !/apps\.apple|play\.google|github\.com/.test(u))) p.add('Web')
  return [...p]
}

export function detectBusinessModel(text: string): string | null {
  const t = text.toLowerCase()
  const models: string[] = []
  if (/\b(subscription|per month|\/mo\b|\/month|monthly plan|annual plan|membership)\b/.test(t)) models.push('Subscription')
  if (/\b(free plan|free tier|freemium|free forever|start for free|try (it )?free|free preview)\b/.test(t)) models.push('Freemium')
  if (/\b(one[- ]time|lifetime deal|lifetime access|pay once|unlock (the )?(full )?report)\b/.test(t)) models.push('One-time purchase')
  if (/\b(credits?|pay as you go|usage[- ]based|per (image|minute|request|call))\b/.test(t)) models.push('Usage-based')
  if (/\b(marketplace|commission|take rate)\b/.test(t)) models.push('Marketplace')
  if (/\b(open[- ]source|mit license|apache 2)\b/.test(t)) models.push('Open source')
  return models.length ? models.join(' + ') : null
}

/** Extract visible price points like "$9/mo", "$29 per month", "€49 one-time". */
export function extractPricePoints(text: string): string[] {
  const out = new Set<string>()
  const re = /([$€£])\s?(\d{1,4}(?:[.,]\d{2})?)\s*(?:\/\s?|per\s)(mo(?:nth)?|yr|year|week|wk|report|user|seat)\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) && out.size < 6) {
    const per = m[3].toLowerCase().startsWith('mo') ? 'mo' : m[3].toLowerCase().startsWith('y') ? 'yr' : m[3].toLowerCase().replace('wk', 'week')
    out.add(`${m[1]}${m[2]}/${per}`)
  }
  return [...out]
}
