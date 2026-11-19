# Signal

Startup intelligence: discover emerging software products, combine every source about a product into one evidence-backed profile, and track how it changes over time.

![Aperture mark](public/logo-mark.svg)

- **Discover feed**: compact cards with up to 3 metrics chosen per product, source tags, Save, Track, an inline expanded report and a resizable research panel.
- **Canonical profiles**: deterministic entity resolution (domain, host/path, Product Hunt slug, GitHub repo, TrustMRR slug). Name-only matches go to a review queue and are never merged automatically.
- **Provenance on every number**: each figure carries its source, URL, dates, period, evidence class (verified, platform metric, founder-reported, third-party estimate, AI estimate) and confidence. Conflicting figures are kept side by side and explained, never averaged.
- **Automatic discovery**: Hacker News Show HN, Product Hunt, GitHub, TrustMRR (Stripe-verified revenue) and QuietMoney. Enrichment comes from founder websites and Cashflowing. Every source respects robots.txt and runs on a schedule with no browser open.
- **Monitoring**: change detection with significance scores, per-product tracking thresholds and deduplicated updates.
- **Research**: rule-based reports that use stored evidence only, plus optional AI reports in which every stated fact must cite an evidence id. AI metric extraction is grounded: a figure is dropped unless its quote appears verbatim in the page.
- **Opportunities**, **Trends**, **Sources** (health, logs, Run now, custom RSS), **Advertising** (Meta Ad Library connector plus manual references).

Docs: [PRD](docs/PRD.md) · [TDD](docs/TDD.md) · [Tickets](docs/TICKETS.md) · [Source feasibility](docs/SOURCE_FEASIBILITY.md) · [Brand](docs/BRAND.md)

## Quick start (Local mode)

```bash
npm install
```

```bash
npm run dev
```

With no Supabase variables set, the app runs in **Local mode**. Data lives in the browser (IndexedDB) and is seeded from `src/fixtures/snapshot.json`, a real snapshot that the ingestion pipeline collected from live sources. It is labeled "Snapshot" in the UI. Hacker News and GitHub discovery can run from the browser. Every other connector needs the server.

## Production (Supabase + Vercel)

1. Create a Supabase project, then link it and push the schema:

```bash
npx supabase link --project-ref <ref>
```

```bash
npx supabase db push
```

2. Deploy the functions and set their secrets:

```bash
npx supabase functions deploy ingest add-product research digest
```

```bash
npx supabase secrets set CRON_SECRET=<random-string> ANTHROPIC_API_KEY=<optional> PRODUCT_HUNT_TOKEN=<optional> GITHUB_TOKEN=<optional>
```

3. Turn on scheduled ingestion by storing two Vault secrets. The cron jobs are created by `supabase/migrations/20261119000200_cron.sql`.

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<same CRON_SECRET>', 'cron_secret');
```

4. In Vercel, import the repo and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. `vercel.json` handles the SPA rewrites.

5. Create users under Supabase Auth (email and password, or magic link).

### Optional credentials

| Secret | Enables | Cost |
|---|---|---|
| `ANTHROPIC_API_KEY` (+ `AI_MODEL`, default `claude-opus-5-5`; `AI_DEEP_PER_RUN`, default 5) | Grounded AI fact extraction, deep research reports, ad creative analysis | **Recurring usage cost**, bounded per run |
| `PRODUCT_HUNT_TOKEN` | Product Hunt GraphQL connector (votes, topics, website) | Free; commercial use needs PH approval |
| `GITHUB_TOKEN` | Higher GitHub rate limits | Free |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Reddit connector | Free tier; commercial use may need an agreement |
| `META_ADS_TOKEN` | Meta Ad Library connector | Free; requires identity verification |
| `SIMILARWEB_API_KEY` | Similarweb rank | Paid |
| `RESEND_API_KEY` + `DIGEST_FROM_EMAIL` | Email digests | Paid beyond the free tier |

## Ingestion CLI

The CLI runs the same pipeline code as the Edge Functions.

Refresh the local snapshot from live sources (Node 22+; add `NODE_USE_ENV_PROXY=1` behind a proxy):

```bash
npx tsx scripts/ingest.ts --sources hn_show,producthunt_feed,github_rising,trustmrr,quietmoney --budget 20 --add https://www.whatbrandonthinks.com/ --enrich-all
```

Run due sources directly against Supabase:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/ingest.ts --store supabase --sources due
```

## Development

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npx tsc -p supabase/functions
```

```bash
npm run build
```

`npm test` runs the core pipeline tests against real saved source pages. `npx tsc -p supabase/functions` typechecks the Edge Functions (Deno) using a small type shim.

Layout: `supabase/functions/_shared/core` holds the runtime-agnostic pipeline (connectors, normalization, resolution, scoring and reports) that the Edge Functions, the CLI, the browser and the tests share. `src/` is the React app, which reads data through a single `Repository` interface with Local and Supabase implementations.

### Adding a source

Add a connector file in `supabase/functions/_shared/core/connectors/` that implements `discover` and/or `enrich`, then add it to `connectors/index.ts`. Regenerate the seed SQL:

```bash
npx tsx scripts/gen-sources-sql.ts > supabase/migrations/20261119000100_seed_sources.sql
```

The same Edge Function also registers new connectors at runtime.
