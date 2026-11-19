# Signal: Product Requirements Document

Status: v1.0 · 2026-11-19 · Owner: Product
Source brief: the ChatGPT discovery interview, pasted into the build session. The interview phase was skipped for this project.

## 1. Summary

Signal is a startup-intelligence platform. It automatically discovers new software products and online businesses, merges everything known about each one into a single evidence-backed profile, and keeps those profiles up to date. The team uses it to decide which products to watch and which business models are worth building.

The main experience is a **news feed**, not a dashboard. Each item is a company or product, shown with its business metrics and the evidence behind them.

## 2. Problem

Signals about promising small software businesses are spread across launch sites (Product Hunt, Show HN), revenue directories (TrustMRR, QuietMoney, Cashflowing, Starter Story), traffic estimators (Similarweb), ad libraries and founder posts. Each source covers a slice, and many of them disagree. Researching by hand is slow, the results are duplicated, and estimates get mistaken for facts.

## 3. Goals

| # | Goal | Measure |
|---|------|---------|
| G1 | Surface emerging products automatically | ≥ 3 operational discovery connectors that need no manual entry; the feed updates on a schedule with no browser open |
| G2 | One canonical profile per product | The same product seen in N sources appears as 1 card with N source tags; duplicate rate < 2% on deterministic keys |
| G3 | Trustworthy metrics | 100% of displayed metrics link to a source observation with its evidence class, date and period; no invented values |
| G4 | Save, track and monitor | Users can save, collect, track and receive deduplicated significant-change updates |
| G5 | Turn discoveries into opportunities | Users can create opportunities linked to inspiration products and move them through statuses |
| G6 | Affordable AI enrichment | Lightweight processing on every item; deep reports only for promising products or on request |

### Non-goals (v1)

- Scraping sites that forbid automated access, or getting around authentication or anti-bot protections.
- Inferring ad spend, ROAS or profitability.
- Multi-tenant team workspaces and billing. Single team, with per-user personal data.
- Native mobile apps. Signal is a responsive web app.

## 4. Users

- **Researcher / founder (primary)**: scans the feed daily, digs into profiles, saves and tracks products, writes notes.
- **Builder**: turns saved products into opportunities and judges whether they are feasible.
- **Operator**: manages sources, credentials and ingestion health, and works through the entity-resolution review queue.

## 5. Core concepts

| Concept | Definition |
|---|---|
| **Product** | A canonical, stable-ID entity (for example, What Brandon Thinks), optionally belonging to a **Company**. |
| **Alias** | A deterministic identifier: normalized domain, Product Hunt slug, GitHub repo, TrustMRR slug, social handle or normalized name. |
| **Source** | An external system with a connector: API, RSS, sitemap with public pages, licensed, or manual. |
| **Mention** | One source document about a product (an HN post, a QuietMoney page). Unique per source and external ID. |
| **Metric observation** | One fact from one mention: metric type, value, unit, period, evidence class, confidence, source URL, quote and dates. Never overwritten. |
| **Evidence class** | `verified` (payment-provider verified, e.g. TrustMRR via Stripe) · `platform_metric` (a count the platform itself reports: upvotes, stars) · `founder_reported` · `third_party_estimate` (Similarweb, QuietMoney, Cashflowing) · `ai_estimate` · `unknown` |
| **Event** | A timeline entry with a significance score (discovered, new source, metric change, milestone, pricing change, new ad, and so on). |
| **Save / Track** | Save means "interesting, revisit later". Track means "actively monitor and notify me". They are separate actions. |
| **Opportunity** | An idea the team might build, inspired by one or more products. |

## 6. Functional requirements

### 6.1 Discover feed (home)
- FR-1 Compact, information-dense cards showing: logo or favicon, name, one-line description, category, platform, stage badge (New launch / Early traction / Established / Unknown), up to 3 dynamically chosen metrics, source tags with a combined count, and Save, Track, Expand and Open site actions.
- FR-2 Metric selection uses a priority order: verified revenue → founder-reported revenue → MRR/ARR estimates → users → checkout or traffic estimates → growth → platform metrics (upvotes, stars). Missing values are never filled in.
- FR-3 Expand reveals an inline report without navigating away: overview, business model, pricing, revenue and traction (with evidence), growth history, distribution, sources, competitors, advertising summary, AI analysis and opportunities. It also links to the full profile.
- FR-4 Search covering name, company, domain, category, description, business model and tags.
- FR-5 Quick filters: category chips and New launches / Trending / Has revenue. Advanced filters sit behind a Filters button: platform, revenue range, traffic growth, monetization model, source, saved/tracked, product age, evidence confidence.
- FR-6 Sorts: recently discovered, recently updated, trending, highest reported revenue, fastest growth, most sources, recently launched.
- FR-7 Virtualized list that stays smooth with thousands of products. Feed scroll position persists while the research panel is used.

### 6.2 Research panel and profile
- FR-8 Selecting a card opens a collapsible, resizable right-side panel. On tablet and mobile it opens as a full-screen drawer.
- FR-9 The full profile has tabs: Overview · Sources & Evidence · Advertising · Activity · Competitors · Notes.
- FR-10 Every metric opens its evidence: source, link, publication date, collection date, period, evidence class, confidence and quote.
- FR-11 Conflicting observations are shown side by side with an explanation of the discrepancy. They are never averaged.

### 6.3 Automatic discovery
- FR-12 Modular connector interface. Each connector declares its kind, role (discovery, enrichment or both), credential requirements, rate limits and operational status.
- FR-13 Scheduled ingestion runs without a browser (Supabase pg_cron → `ingest` Edge Function).
- FR-14 Ingestion is idempotent and incremental: it uses cursors and sitemap `lastmod`, and observations carry dedupe keys.
- FR-15 Robots.txt and published terms are respected. Sources that can't be automated are marked `manual` or `unsupported`.
- FR-16 Sources page: list, enable/disable, refresh frequency, last success, errors, products discovered, a credential-presence indicator (secrets stay server-side), Run now, add a custom RSS source, and the job log.

### 6.4 Entity resolution
- FR-17 Deterministic first: normalized domain (with shared-host rules such as github.com/owner/repo and *.vercel.app), then platform slugs, then normalized name.
- FR-18 Name-only matches create a separate profile and add a **merge candidate** to the review queue. They are never merged automatically.
- FR-19 Manual merge and dismiss actions, with an audit trail. AI-assisted suggestions are available only in the review queue.
- FR-20 Multiple products per company.

### 6.5 Save, track, notify
- FR-21 Save with optional collection and note. Collections are listed in the sidebar.
- FR-22 Track with per-product thresholds (minimum significance). Tracking applies to the canonical product.
- FR-23 Significant events produce notifications deduplicated per user and event, shown in the Watchlist "Updates" feed. An optional daily or weekly digest is supported (in-app; email when a provider is configured).

### 6.6 Opportunities
- FR-24 CRUD with fields: title, description, inspiration products, target audience, monetization hypothesis, distribution strategy, competitors, technical feasibility, MVP complexity, notes, and a status (Idea → Researching → Validating → Planned → Building → Archived).

### 6.7 Advertising intelligence
- FR-25 An Advertising tab with a creative grid: preview, platform, advertiser, headline, copy, landing page, first and last observed dates, active status, and original link.
- FR-26 Connectors: Meta Ad Library API (needs a token), TikTok Commercial Content API and the Google Ads Transparency BigQuery dataset (documented, not yet implemented). Manual ad references can be bookmarked.
- FR-27 AI creative analysis (hook, audience, emotional appeal, value proposition, CTA, format, angle) runs only on lawfully accessible ad text.
- FR-28 Longevity is shown as a research signal and explicitly labeled "not evidence of profitability".

### 6.8 AI research
- FR-29 Tiered processing. Lightweight extraction runs on every mention (rules first, AI optional). Deep reports run automatically for products above a relevance threshold, or on request.
- FR-30 Reports keep **sourced facts** (each citing an observation or mention) separate from **interpretation** and **speculation**.
- FR-31 Opportunity score with transparent, configurable weights (Growth 30, Monetization 30, Distribution 25, Feasibility 15). It shows its component evidence and an insufficient-evidence state.

### 6.9 Trends
- FR-32 Ranked lists: fastest-growing categories, common business models, launch activity by category (small sparkline), products gaining traction, and common monetization and ad angles once the data supports them.

### 6.10 Manual submission
- FR-33 Add Product by URL: normalize, dedupe, fetch the public website (respecting robots.txt), run enrichment connectors (TrustMRR, QuietMoney, Cashflowing), then create or enrich the profile and open it.

## 7. Data-quality rules (non-negotiable)

1. Never invent revenue, users, growth or publication dates. Missing values display as "Unavailable".
2. Checkout visits are not purchases. Traffic estimates are not analytics. Founder claims are not verified.
3. Cashflowing's "revenue estimator" is a user-assumption model and is **never** ingested as revenue.
4. Ad longevity is not profitability.
5. A source's status in the UI reflects whether it actually works. Connectors without credentials show "Needs credentials".
6. Development or snapshot data is labeled in the UI.

## 8. Design

Modern Slate. Inter, a slate palette with cobalt #2563EB, a compact three-column layout, restrained motion, no gradients or neon, and Lucide icons. See `docs/BRAND.md`.

## 9. Release phases

1. UI, core product, schema and auth. 2. Real ingestion and entity resolution. 3. AI enrichment and scoring. 4. Monitoring and ads. 5. Trends and advanced intelligence. The phases are sequenced in `docs/TICKETS.md`.

## 10. Decisions with cost or architecture impact (flagged)

| Decision | Impact |
|---|---|
| Anthropic API for AI enrichment (`claude-opus-5-5`, configurable via `AI_MODEL`) | **Recurring cost**: about $4 / $20 per M input/output tokens. Gated by tiering and only used when `ANTHROPIC_API_KEY` is set. |
| Product Hunt GraphQL API | Free developer token. Commercial use needs PH approval. |
| Reddit API | OAuth app required. Commercial or data use may need a paid agreement under Reddit's Data API terms. |
| Meta Ad Library API | Free, but requires identity verification. Coverage is limited to EU-delivered ads and political ads. |
| Similarweb, Exploding Topics, Starter Story, Acquire.com | **Paid or licensed**. Not enabled. Documented only. |
| Email digests | Need a provider (e.g. Resend). Recurring cost. In-app digest by default. |
