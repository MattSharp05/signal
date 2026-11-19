# Signal: Technical Design Document

Status: v1.0 · 2026-11-19

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite | SPA hosted on Vercel |
| Styling | Tailwind CSS v4 + shadcn/ui-style primitives (Radix) | Modern Slate tokens defined in `src/index.css` |
| Icons | lucide-react | |
| Server state | TanStack Query v5 | All data access goes through the `Repository` interface |
| Virtualization | @tanstack/react-virtual | Feed |
| Panels | react-resizable-panels | Resizable research panel |
| DB / Auth | Supabase Postgres + Auth | RLS on all user data |
| Backend jobs | Supabase Edge Functions (Deno) | `ingest`, `add-product`, `research`, `digest` |
| Scheduling | `pg_cron` + `pg_net` calling `ingest` | Runs with no browser open |
| AI | Anthropic Messages API (`@anthropic-ai/sdk`), model from `AI_MODEL` (default `claude-opus-5-5`) | Optional. Rule-based fallback otherwise |
| Tests | Vitest | Core pipeline is pure TypeScript and tested in Node |

## 2. Repository layout

```
docs/                       PRD, TDD, tickets, source feasibility, brand
public/                     favicon + logo SVGs
src/                        React app
  components/{ui,brand,layout,product,feed,opportunity}
  pages/                    Discover, Watchlist, Opportunities, Trends, Sources, Settings, Product, Login
  data/                     Repository interface + Local and Supabase implementations + hooks
  fixtures/snapshot.json    Pipeline output collected by scripts/ingest.ts (labeled in UI)
supabase/
  migrations/               schema, RLS, seed sources, cron
  functions/_shared/core/   ★ runtime-agnostic pipeline (used by Edge Functions, Node CLI, browser, tests)
  functions/{ingest,add-product,research,digest}/
scripts/ingest.ts           Node CLI: run connectors → MemoryStore → snapshot, or → Supabase
```

**Why put the core in `supabase/functions/_shared/core`?** Edge Function bundles must stay inside `supabase/functions`. The core uses only web-standard APIs (`fetch`, `URL`, `crypto.subtle`) and relative `.ts` imports, so the same code runs in Deno, Node (vitest, CLI) and the browser. Vite imports it through the `@core` alias. Third-party imports (`@anthropic-ai/sdk`, `@supabase/supabase-js`) resolve through `supabase/functions/deno.json` in Deno and `node_modules` in Node.

## 3. Runtime modes

| Mode | When | Data | Ingestion |
|---|---|---|---|
| **Supabase** | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set | Postgres via PostgREST + RLS | pg_cron → Edge Functions |
| **Local** | No Supabase env | Browser IndexedDB, seeded from `snapshot.json` (labeled "Snapshot") | Browser runs the CORS-capable connectors (HN, GitHub) with the same core pipeline. Server-only connectors show "Runs on server" |

Both modes implement `Repository` (`src/data/repository.ts`), so the UI doesn't depend on which one is active.

## 4. Data model

The full DDL is in `supabase/migrations/20261119000000_init.sql`. The main tables:

- **companies** (id, name, domain)
- **products**: canonical. `id uuid` (stable), `slug`, `name`, `domain`, `website_url`, `company_id`, `tagline`, `description`, `category`, `tags[]`, `platforms[]`, `business_model`, `pricing_summary`, `launch_date`, `logo_url`, `stage`, `status` (active | merged), `merged_into`, `relevance_score`, `opportunity_score jsonb`, `summary_metrics jsonb` (derived cache), `source_ids[]`, `source_count`, `first_discovered_at`, `last_updated_at`, `last_significant_at`, `search tsvector` (generated).
- **product_aliases**: (kind, value) unique. Kinds: `domain`, `host_path`, `name`, `ph_slug`, `github_repo`, `trustmrr_slug`, `hn_item`, `social`.
- **sources**: id (text slug), name, kind, role, status, enabled, refresh_minutes, config, credential_env[], cursor jsonb, last_run_at, last_success_at, last_error, products_discovered, docs_url, notes.
- **source_mentions**: unique(source_id, external_id). Holds url, title, excerpt, author, published_at, discovered_at, collected_at, content_hash, raw.
- **metric_observations**: unique(dedupe_key). Holds metric, value, unit, currency, period_start, period_end, period_label, as_of, evidence, confidence, source_url, quote, published_at, collected_at, mention_id.
- **product_events**: unique(dedupe_key). Holds type, title, detail, significance (0–100), occurred_at, mention_id, metric_observation_id.
- **product_relationships**: (product_id, related_product_id or related_name, kind, reason, source_id).
- **merge_candidates**: product_a, product_b, reason, score, status.
- **advertisements**, **advertisement_observations**
- **research_reports**: product_id, tier (lite | deep), generator (rules | ai), model, content jsonb, cost_tokens, created_at.
- **ingestion_jobs**: source_id, status, trigger, counts, error, log jsonb, timings.
- User data (RLS `user_id = auth.uid()`): **saved_products**, **tracked_products** (min_significance), **collections**, **collection_products**, **opportunities**, **opportunity_products**, **research_notes**, **notification_preferences**, **notifications**, **user_settings** (score weights).

Shared research data (products, observations and so on) is readable by any authenticated user and writable only with the service role. Users can't write directly to canonical tables. Manual submission goes through the `add-product` function.

### Metric vocabulary

`mrr`, `arr`, `revenue_run_rate`, `revenue_30d`, `total_revenue`, `one_time_sales`, `customers`, `users`, `accounts`, `downloads`, `monthly_visits`, `checkout_visits_monthly`, `checkout_visits_total`, `traffic_growth_pct`, `revenue_growth_pct`, `mrr_growth_pct`, `global_rank`, `upvotes`, `comments`, `stars`.

Each metric has a unit (`USD`, `count`, `visits`, `percent`, `rank`) and an evidence class (`verified`, `platform_metric`, `founder_reported`, `third_party_estimate`, `ai_estimate`, `unknown`).

## 5. Connector interface

```ts
interface Connector {
  id: string; name: string;
  kind: 'api'|'rss'|'sitemap'|'public_page'|'licensed'|'manual';
  role: 'discovery'|'enrichment'|'both';
  requiresCredentials?: string[];          // env var names
  runsIn: ('server'|'browser')[];          // CORS capability
  discover?(ctx: ConnectorContext): Promise<DiscoveryBatch>;   // incremental via ctx.cursor
  enrich?(ctx: ConnectorContext, target: EnrichTarget): Promise<RawMention[]>;
}
interface RawMention {
  sourceId; externalId; url; title?; excerpt?; author?; publishedAt?;
  identity: { name?; websiteUrl?; aliases: Alias[]; company?; logoUrl?; category?; tags?; platforms? };
  metrics: RawMetric[];        // value, unit, period, evidence, confidence, quote
  relationships?: { name; domain?; kind }[];
  ads?: RawAd[];
  text?: string;               // for optional AI extraction
}
```

Connectors only fetch and parse. Everything after that is handled by the shared pipeline.

## 6. Pipeline

```
runSource(sourceId) ─► connector.discover(cursor) ─► RawMention[]
  for each mention:
    normalize (domain, name, url)                   normalize.ts
    resolve → {productId, created, ambiguous[]}     resolve.ts
    upsert mention (idempotent: source_id+external_id; skip if content_hash unchanged)
    insert metric observations (dedupe_key = sha(source|product|metric|period|value))
    detect changes vs previous observations          changes.ts → product_events
    recompute product summary (summary_metrics, stage, source_count, scores)  summarize.ts / scoring.ts
  enrichment fan-out for newly created products with a domain (website, cashflowing, trustmrr, quietmoney), within budget
  notify: events with significance ≥ tracker threshold → notifications (unique user_id+event_id)
  record ingestion_job (counts, errors, log), advance cursor only on success
```

Each stage is a pure function, or a function over the `Store` interface, so it can be tested on its own with `MemoryStore`. `SupabaseStore` implements the same interface using the service role.

### Entity resolution (deterministic → review)

1. Normalize the URL. Lowercase the host, strip `www.`, `m.`, `app.` and tracking params. Shared hosts (`github.com`, `gitlab.com`, `apps.apple.com`, `play.google.com`, `chromewebstore.google.com`, `*.vercel.app`, `*.netlify.app`, `*.github.io`, `*.notion.site`, `*.framer.website`, `*.lovable.app`, `*.replit.app`, `*.bubbleapps.io`, `*.webflow.io`) use `host_path` or a full-host identity instead of the registrable domain. Aggregator hosts (producthunt.com, news.ycombinator.com, reddit.com and similar) never become a product domain.
2. If any strong alias (`domain`, `host_path`, `ph_slug`, `github_repo`, `trustmrr_slug`) matches, attach to that product (high confidence). If strong aliases point to two different products, attach to the first and create a merge candidate.
3. If there's no strong match but the normalized name matches an existing product, and at least one side has no domain, create a new product plus a merge candidate (score 0.6). Same name with different domains means separate products and no candidate.
4. Otherwise, create a new product.
5. Merging (manual) moves aliases, mentions, observations, events and user rows to the survivor, sets the loser's `status='merged', merged_into=survivor`, and records the action in an event.

### Change detection and significance

For each new observation, compare it with the latest prior observation of the same metric, evidence class and source.
- Revenue metrics: |Δ| ≥ 20% → `metric_change` (significance 60–90). Crossing a milestone ($1k, $5k, $10k, $25k, $50k, $100k MRR) → `revenue_milestone` (85).
- Traffic metrics: |Δ| ≥ 25% → `traffic_change` (50–75).
- First observation from a new source → `new_source` (40). First discovery → `discovered` (30).
- Pricing summary change → `pricing_change` (60). New ad → `new_ad` (55).

Notifications go out when significance ≥ the tracker's `min_significance` (default 50). They are deduplicated by `unique(user_id, event_id)`, and events themselves are deduplicated by `dedupe_key`.

## 7. Summaries, stage and scoring

**summary_metrics**: for each metric, the preferred observation, picked by the most trusted evidence class (verified > platform > founder > third-party > AI) and then the newest `as_of`. Conflicts are flagged when observations of the same metric and period from different sources differ by more than 25%.

**Card metric selection**: a fixed priority list (`mrr`, `revenue_30d`, `arr`, `total_revenue`, `customers`, `accounts`, `users`, `checkout_visits_monthly`, `monthly_visits`, `traffic_growth_pct`, `mrr_growth_pct`, `downloads`, `upvotes`, `stars`, `global_rank`) filtered by availability. Cards show the top 3.

**Stage**:
- `established`: MRR ≥ $10k, accounts or users ≥ 100k, or checkout visits ≥ 20k/mo.
- `early_traction`: any revenue, customer or traffic evidence.
- `new_launch`: first seen on a launch platform within 60 days, with no traction evidence.
- Otherwise `unknown`.

**Opportunity score** (`scoring.ts`): Growth, Monetization, Distribution and Feasibility are each scored 0–100, or `null` when there's no evidence. Each comes with a list of `reasons` that cite observations. The overall score is the weighted mean over the non-null components, using user-configurable weights (default 30/30/25/15). `coverage` is the share of total weight that had evidence. When `coverage < 0.55`, the UI shows "Insufficient evidence" and does not show the number as a headline. Feasibility is a heuristic based on category and platform, and is always labeled as assumed.

**Relevance score**: monetization evidence, growth, source count and recency. Products with relevance ≥ 60 get an automatic deep report when AI is configured (at most `AI_DEEP_PER_RUN` per run).

## 8. AI

- `core/ai.ts` takes an injected Anthropic client.
  - `extractFacts(text, url, evidenceClass)` → structured output, a list of `{metric, value, unit, period, quote}`. **Grounding check**: a fact is dropped unless its `quote` appears verbatim in the source text and its value can be parsed from the quote.
  - `deepReport(product, evidence)` → a JSON report with `facts[]` (each with evidence IDs), `interpretation[]`, `speculation[]`, `opportunities[]`, `competitors[]` and `technical_complexity`. Facts that cite unknown IDs are removed.
  - `analyzeAd(ad)` → hook, audience, appeal, value proposition, CTA, format, angle.
- The model is set by `AI_MODEL` (default `claude-opus-5-5`, adaptive thinking, `effort: low` for extraction and `medium` for reports). Server-side refusal fallback is enabled. Token usage is stored on `research_reports.cost_tokens`.
- Without a key, `core/report.ts` builds a **rule-based** report from observations. It's labeled "Rule-based summary" and contains no speculation.

## 9. Edge Functions

| Function | Auth | Purpose |
|---|---|---|
| `ingest` | `Authorization: Bearer <CRON_SECRET>` or service role | Runs due or specified sources; called every 15 min by pg_cron |
| `add-product` | User JWT | Manual URL submission → resolve → enrich → returns product id |
| `research` | User JWT | Generates a deep report (AI or rules) |
| `digest` | CRON_SECRET | Builds daily or weekly digest notifications; email if `RESEND_API_KEY` is set |
| `merge` | User JWT | Applies or dismisses a merge candidate (service role inside, audited) |

Secrets: `SUPABASE_SERVICE_ROLE_KEY` (auto), `CRON_SECRET`, `ANTHROPIC_API_KEY`, `PRODUCT_HUNT_TOKEN`, `GITHUB_TOKEN`, `REDDIT_CLIENT_ID/SECRET`, `META_ADS_TOKEN`, `SIMILARWEB_API_KEY`, `RESEND_API_KEY`. None of them are exposed to the client. The Sources page reads credential *presence* from `sources.credential_status`, which `ingest` writes.

## 10. Frontend architecture

- `RepositoryProvider` picks the Supabase or Local implementation. Hooks in `data/hooks.ts` wrap TanStack Query, with keys like `['feed', filters]` and `['product', id]`.
- `AppShell`: sidebar (collapsible to the logo mark), center outlet, and the research panel (`react-resizable-panels`; a `Sheet` drawer below 1024px).
- Feed: `useInfiniteQuery` with 40 items per page, virtualized with `useVirtualizer` and dynamic measurement for expanded cards. The selected product is stored in the URL (`?p=slug`), so it can be linked and the feed's scroll position is kept.
- Design tokens: CSS variables (`--bg`, `--sidebar`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, `--positive`, `--negative`, `--warning`) mapped to Tailwind theme colors. Inter is loaded from Google Fonts, with `font-variant-numeric: tabular-nums` on metrics.

## 11. Security

- RLS is enabled on every table. User tables use the `user_id = auth.uid()` policy. Shared tables are `select` for `authenticated`, with no insert/update/delete policies, so only the service role can write.
- Edge Functions check the caller's JWT (`supabase.auth.getUser`) before using the service-role client.
- The URL fetcher blocks private and loopback IP literals and non-http(s) schemes (SSRF guard), caps response size at 2 MB and times out after 15 s.

## 12. Testing

- Unit: normalize, metric parsing, resolve, changes, scoring, summarize, robots.
- Connector parsing: against saved real fixtures in `supabase/functions/_shared/core/__fixtures__` (QuietMoney, Cashflowing, TrustMRR, the What Brandon Thinks site, the PH feed, HN JSON).
- Pipeline integration: running the same source twice doesn't change any counts (idempotency). Three sources about one domain produce one product with three source IDs (consolidation).
- UI: `tsc --noEmit`, `vite build`, and a Playwright smoke run that screenshots the main pages.

## 13. Deployment

1. `supabase link`, then `supabase db push`, then `supabase functions deploy`, then `supabase secrets set ...`.
2. Run the cron migration's SQL with the project URL and CRON_SECRET stored in Vault (see the README).
3. On Vercel, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. `vercel.json` provides the SPA rewrite.
