# Signal: Implementation Tickets

Status key: ✅ done · 🟡 partial (see note) · ⛔ blocked on credentials or approval · ⏭ deferred

## Phase 0: Foundations
| ID | Ticket | Acceptance criteria | Status |
|---|---|---|---|
| SIG-001 | Scaffold Vite + React + TS + Tailwind v4 + path aliases (`@`, `@core`) | `npm run build` and `npm test` pass | ✅ |
| SIG-002 | Modern Slate design tokens, Inter, base primitives (Button, Badge, Input, Tabs, Dialog, Sheet, Dropdown, Tooltip, Switch, Select, Skeleton) | Tokens defined in one place; no ad-hoc colors | ✅ |
| SIG-003 | Brand: 3 logo concepts, pick one, SVG asset, favicon, `<Logo/>` component with light/dark/mono variants | Mark legible at 16px; used in sidebar, collapsed sidebar and favicon | ✅ |
| SIG-004 | PRD, TDD, source feasibility, tickets | Committed in `docs/` | ✅ |

## Phase 1: Core product
| ID | Ticket | Acceptance criteria | Status |
|---|---|---|---|
| SIG-010 | Supabase schema + RLS + seeded sources | Migration applies cleanly; RLS on every table | ✅ Verified on Postgres 16: migrations apply, RLS isolates users, clients can't write shared tables, `merge_products` / source RPCs work |
| SIG-011 | `Repository` interface + Local (IndexedDB) and Supabase implementations | UI works in both modes with no code branches outside `data/` | 🟡 Local mode verified end-to-end in a browser; the Supabase implementation typechecks but hasn't been run against a live project |
| SIG-012 | App shell: sidebar (collapsible), center, resizable research panel, mobile drawer | Works at 375 / 768 / 1440 px | ✅ |
| SIG-013 | Discover feed: virtualized, infinite, compact ProductCard, expandable inline report | Smooth with 1k+ items; expand doesn't navigate | ✅ |
| SIG-014 | Dynamic ProductMetrics (top 3 by priority + availability) with evidence badges | Never shows invented values; every metric links to its evidence | ✅ |
| SIG-015 | Search + quick filters + advanced Filters popover + sorts | All PRD filters and sorts | ✅ |
| SIG-016 | Research panel + full profile page with tabs (Overview, Sources & Evidence, Advertising, Activity, Competitors, Notes) | URL-addressable (`?p=` and `/p/:slug`) | ✅ |
| SIG-017 | Save / collections / Track actions, persisted per user | RLS-scoped in Supabase mode | ✅ |
| SIG-018 | Auth (Supabase email magic link + password); local mode single user | Protected routes in Supabase mode | 🟡 Implemented; not exercised against a live Supabase Auth |
| SIG-019 | Watchlist page: Saved, Tracked, Updates | | ✅ |

## Phase 2: Ingestion
| ID | Ticket | Acceptance criteria | Status |
|---|---|---|---|
| SIG-020 | Core normalize (URL, domain, shared hosts, names) | Unit tests | ✅ |
| SIG-021 | Connector interface + registry | New connector = one file + one registry line | ✅ |
| SIG-022 | HN Show HN connector (Algolia), incremental cursor | Live-verified | ✅ |
| SIG-023 | Product Hunt Atom feed connector | Live-verified | ✅ |
| SIG-024 | Product Hunt GraphQL connector | Implemented; needs `PRODUCT_HUNT_TOKEN` | ⛔ |
| SIG-025 | GitHub rising repos connector | Live-verified | ✅ |
| SIG-026 | TrustMRR sitemap + JSON-LD connector (verified revenue) | Live-verified | ✅ |
| SIG-027 | QuietMoney sitemap + JSON-LD connector (estimates, alternatives) | Live-verified | ✅ |
| SIG-028 | Cashflowing per-domain enrichment (excludes estimator) | Live-verified | ✅ |
| SIG-029 | Founder website enrichment (meta, logo, pricing link, stated stats), robots-aware | Live-verified on reference product | ✅ |
| SIG-030 | Reddit API connector | Implemented; needs Reddit OAuth app | ⛔ |
| SIG-031 | Entity resolution + merge candidates + manual merge | Tests: consolidation, no name-only auto-merge | ✅ |
| SIG-032 | Idempotent observation storage + change detection + events | Re-running a source creates 0 new rows | ✅ |
| SIG-033 | `ingest` Edge Function + pg_cron schedule + ingestion_jobs log | Runs without a browser | 🟡 Pipeline verified live via the Node CLI (same code). Edge Functions typecheck under a Deno shim but aren't deployed; no Supabase project was available |
| SIG-034 | Sources page: status, enable/disable, frequency, last sync, errors, counts, Run now, add RSS source, review queue | | ✅ |
| SIG-035 | Node CLI `scripts/ingest.ts` + snapshot generation | Snapshot labeled in UI | ✅ |
| SIG-036 | Generic RSS connector for user-added feeds | | ✅ |

## Phase 3: AI and research
| ID | Ticket | Acceptance criteria | Status |
|---|---|---|---|
| SIG-040 | Rule-based categorization + description | | ✅ |
| SIG-041 | AI fact extraction with grounding check | Facts whose quote isn't in the source are dropped (tested with mock client) | ✅ (live calls need `ANTHROPIC_API_KEY`) |
| SIG-042 | Deep research report (AI) + rule-based fallback, facts kept separate from interpretation | | ✅ |
| SIG-043 | Opportunity score, transparent with coverage + configurable weights | | ✅ |
| SIG-044 | Competitors from source relationships + same-category similarity | | ✅ |
| SIG-045 | Opportunities CRUD + status pipeline + link products | | ✅ |

## Phase 4: Monitoring and ads
| ID | Ticket | Acceptance criteria | Status |
|---|---|---|---|
| SIG-050 | Tracking thresholds + notifications (dedup) | | ✅ |
| SIG-051 | Digest function (in-app; email if Resend configured) | | 🟡 In-app updates done; the email path is untested without a key |
| SIG-052 | Advertising tab + AdCreativeCard grid + manual ad references | Empty state is honest | ✅ |
| SIG-053 | Meta Ad Library connector | Needs `META_ADS_TOKEN` | ⛔ |
| SIG-054 | AI creative analysis | Needs `ANTHROPIC_API_KEY` | ⛔ |
| SIG-055 | Google Ads Transparency (BigQuery), TikTok Commercial Content API | Cost or approval required | ⏭ |

## Phase 5: Advanced
| ID | Ticket | Acceptance criteria | Status |
|---|---|---|---|
| SIG-060 | Trends page: ranked categories, business models, launch activity sparklines, gaining traction | | ✅ |
| SIG-061 | Product comparisons | | ⏭ |
| SIG-062 | Similarweb DigitalRank, Exploding Topics | Licensed | ⏭ |

## Verification log (2026-11-19)

- `npm test`: core pipeline tests run against real saved pages (TrustMRR, QuietMoney, Cashflowing, the What Brandon Thinks site, the PH feed). They cover consolidation, idempotency, no merging on name alone, change events, tracking notifications, AI grounding, and prices not being read as revenue.
- Live ingestion through the CLI from HN, Product Hunt feed, GitHub, TrustMRR and QuietMoney, plus enrichment from founder websites and Cashflowing. The result is committed as `src/fixtures/snapshot.json` and labeled "Snapshot" in the UI.
- Browser (Playwright): feed, filters and sorts, expand, research panel, evidence popovers, save + collections, track, opportunities, watchlist, trends, sources, a live **Run now** for HN from the browser, and the mobile layout. No console errors.
- SQL: migrations applied to a local Postgres 16 with Supabase auth stubs. RLS and RPC behaviour checked with psql.
- **Not verified:** deployed Edge Functions, pg_cron scheduling, the Supabase-backed UI, AI calls (no `ANTHROPIC_API_KEY`), and connectors that need credentials (Product Hunt API, Reddit, Meta Ads, Similarweb).
