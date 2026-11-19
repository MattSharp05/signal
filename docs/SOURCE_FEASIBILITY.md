# Source Feasibility Assessment

Researched 2026-11-19 from this build environment by probing endpoints, robots.txt and page structure. "Verified" below means we fetched the endpoint or page and parsed it successfully.

Legend. **Role:** D = discovery, E = enrichment. **Status:** the value Signal assigns in the `sources` table.

| # | Source | Provides | Role | Official API / feed | Auth | Cost / limits | Automation permitted | Data quality | Difficulty | Signal status & approach |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Hacker News – Show HN** | Launch posts, URL, points, comments | D | Algolia HN Search API `hn.algolia.com/api/v1/search_by_date?tags=show_hn` (verified 200, CORS enabled) | None | Free; ~10k req/h per IP | Yes (public API) | High for identity; points/comments are platform metrics | Low | **operational** · incremental via `created_at_i` cursor |
| 2 | **Product Hunt** | Daily launches, tagline, maker | D | Public Atom feed `producthunt.com/feed` (verified, 50 entries); GraphQL API v2 (developer token) | Feed: none · API: OAuth token | API free, ~6,250 complexity pts / 15 min; commercial use needs approval | Feed: yes. Website pages: Cloudflare-protected (403) – not scraped | Feed lacks website URL & votes; API has votes + topics | Low / Medium | Feed connector **operational** (identity = PH slug alias); GraphQL connector **requires credentials** |
| 3 | **GitHub** (Trending substitute) | New repos gaining stars | D | No Trending API. Search API `search/repositories?q=created:>X stars:>N` (verified) | Optional token (60 → 5,000 req/h) | Free | Yes (API) | Good for dev tools; stars are platform metrics | Low | **operational** · labeled "GitHub (rising repos)", not "Trending" |
| 4 | **TrustMRR** | **Stripe-verified** revenue, MRR, customers, growth, founder, category | D+E | Startup sitemap (13k URLs, `lastmod`) + per-startup JSON-LD `additionalProperty` + `.md` export (verified). Private API exists (401 without key) | None for public pages | Free; we cap at 30 pages/run | robots.txt `Allow: /` for `*` | **Highest**: payment-provider verified | Low | **operational** · evidence class `verified` |
| 5 | **QuietMoney** | Checkout visits (Similarweb-based estimate), traffic mix, growth story, alternatives | D+E | No API (`/api/` disallowed). Sitemap with 1,144 `/s/{domain}/` pages + JSON-LD Article & FAQ (verified) | None (Pro paywall for some sections; we read only free public content) | Free; polite 1 req/s, ≤ 25 pages/run | robots.txt `Allow: /` (except /api/) | Third-party **estimates**; explicitly says "not revenue" | Low | **operational** · evidence `third_party_estimate`; alternatives → competitor relationships |
| 6 | **Cashflowing** | Checkout-page visits by month, checkout provider, rank, Similarweb rank | E | No public API ("Get the data" = licensed). Sitemap (4,906 URLs, incl. eBay-scale sites) + public pages (verified) | None | Free pages; dataset licensed (paid) | robots.txt allows `/en/sites/` | Third-party estimates. The on-page MRR "estimator" is a slider model of user assumptions — **never ingested** | Low | **operational (enrichment, per-domain lookup)**; discovery disabled (too noisy: large retailers) |
| 7 | **Founder website** | Title, description, logo, pricing link, founder-stated stats (e.g. "710,000+ accounts") | E | n/a — public pages | None | Free | Per-site robots.txt checked before each fetch | Founder-reported (never verified) | Medium (heterogeneous HTML) | **operational** · homepage + /about + /pricing; rule-based stat extraction, AI extraction when configured (quote must appear in page) |
| 8 | **Reddit** (r/SaaS, r/SideProject, r/indiehackers) | Founder posts, revenue claims, launches | D | Official Data API (OAuth). Anonymous JSON/RSS blocked from this network (403/404) | OAuth client credentials | Free tier 100 QPM for non-commercial; commercial use requires agreement | Only via API under Data API Terms | Founder-reported, noisy | Medium | Connector implemented · **requires credentials** |
| 9 | **Indie Hackers** | Product directory w/ self-reported revenue, posts | D+E | No API; `feed.xml` 403; robots blocks AI crawlers (ClaudeBot, GPTBot…) | — | — | **No** for automated/AI collection | Founder-reported | — | **unsupported** · manual submission only |
| 10 | **Starter Story** | Founder interviews with revenue | D+E | No API / RSS (`/feed` 404); content largely paywalled | Paid membership | Paid | Not for paywalled content | Founder-reported (interviewed) | High | **manual** · paste URL into Add Product (only public metadata is read) |
| 11 | **Acquire.com** | Listings w/ TTM revenue/profit | D+E | No public API; financials behind buyer login/NDA | Account | Paid buyer plans | No (gated) | Seller-reported | High | **unsupported** |
| 12 | **Exploding Topics** | Trending topics/startups | D | Paid API (Business plan) | API key | Paid (~$249+/mo tier) | Via API only | Medium (curated) | Low once licensed | **licensed · not configured** (flagged cost) |
| 13 | **Similarweb** | Traffic, rank, channels | E | Paid Digital Data API; free DigitalRank API (rank only) | API key | Paid for traffic; DigitalRank free (limited) | Via API only | Estimates | Low once licensed | Connector stub for DigitalRank · **requires credentials**; Similarweb figures already arrive *via* QuietMoney/Cashflowing (attributed as such) |
| 14 | **Google Trends** | Search interest | E | Official Trends API in limited alpha (application); no other legit API | Approval | — | Unofficial scrapers violate ToS | Relative index only | — | **unsupported** (revisit when API GA) |
| 15 | **Meta Ad Library** | Ad creatives, dates, page, copy | E (ads) | Ad Library API `graph.facebook.com/vXX/ads_archive` | User token + identity verification | Free; rate-limited | Yes via API; coverage = EU-delivered + political/issue ads | Primary source for what ran | Medium | Connector implemented · **requires credentials** |
| 16 | **TikTok Creative Center / Commercial Content API** | Top ads, creatives | E (ads) | Creative Center has no public API; Commercial Content API (EU ads) requires application | Approved app | Free after approval | Creative Center scraping not permitted | Good (EU scope) | High | **unsupported** until approved |
| 17 | **Google Ads Transparency Center** | Advertiser creatives, regions, dates | E (ads) | No API; **BigQuery public dataset** `bigquery-public-data.google_ads_transparency_center` | GCP project | BigQuery query cost (~$6.25/TB scanned) | Yes (public dataset) | Good (dates, regions, formats; no spend) | Medium | Documented · **not implemented** (flagged cost) |
| 18 | **Manual submission** | Any URL | D+E | — | User | — | — | Depends | — | **operational** |

## Recommended MVP sources

1. **Hacker News Show HN**: free, real-time, legitimate API.
2. **TrustMRR**: the only freely accessible source of *verified* revenue. High value.
3. **QuietMoney**: rich estimates, competitor lists, and a sitemap for incremental discovery.
4. **Product Hunt feed**: broad consumer and SaaS launch coverage.
5. **GitHub rising repos**: developer tools.
6. **Enrichment**: founder website and Cashflowing, run per domain for every new product that has a domain.

The reference product (whatbrandonthinks.com) is covered by QuietMoney, Cashflowing and its founder website. All three resolve to a single profile through the normalized domain, with founder-reported accounts, third-party checkout estimates and Similarweb rank kept as separate evidence classes.

## Compliance controls built into the pipeline

- A per-host robots.txt check (cached for 24h) runs before every public-page fetch. A disallowed path is skipped and logged as `robots_disallowed`.
- Requests identify themselves as `SignalBot/1.0 (+contact)`. Each connector has a page budget, there is a per-host delay of 1 request per second, and transient errors are retried with exponential backoff.
- Only public, unauthenticated content is read. Paywalled sections are never requested.
- Credentials live in Supabase secrets. The UI only shows whether a credential is present.
