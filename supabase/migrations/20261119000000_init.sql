-- Signal: core schema. Canonical products + source evidence + per-user research data.
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- shared research data
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text unique,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  domain text,
  website_url text,
  company_id uuid references public.companies(id) on delete set null,
  company_name text,
  tagline text,
  description text,
  category text,
  tags text[] not null default '{}',
  platforms text[] not null default '{}',
  business_model text,
  pricing_summary text,
  launch_date timestamptz,
  logo_url text,
  stage text not null default 'unknown' check (stage in ('new_launch','early_traction','established','unknown')),
  status text not null default 'active' check (status in ('active','merged')),
  merged_into uuid references public.products(id),
  relevance_score int not null default 0,
  monthly_revenue double precision,
  revenue_evidence text,
  growth_pct double precision,
  evidence_level text,
  opportunity_score jsonb,
  summary_metrics jsonb not null default '{}',
  source_ids text[] not null default '{}',
  source_count int not null default 0,
  first_discovered_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  last_significant_at timestamptz,
  data_origin text not null default 'pipeline' check (data_origin in ('pipeline','snapshot','fixture')),
  search tsvector
);
create index products_feed_idx on public.products (status, first_discovered_at desc);
create index products_updated_idx on public.products (status, last_updated_at desc);
create index products_relevance_idx on public.products (status, relevance_score desc);
create index products_revenue_idx on public.products (status, monthly_revenue desc nulls last);
create index products_category_idx on public.products (category);
create index products_domain_idx on public.products (domain);
create index products_search_idx on public.products using gin (search);
create index products_name_trgm on public.products using gin (name gin_trgm_ops);

create or replace function public.products_search_update() returns trigger language plpgsql as $$
begin
  new.search :=
    setweight(to_tsvector('simple', coalesce(new.name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.domain, '') || ' ' || coalesce(new.company_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.tagline, '') || ' ' || coalesce(new.category, '') || ' ' || coalesce(new.business_model, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.description, '') || ' ' || array_to_string(new.tags, ' ')), 'C');
  return new;
end $$;
create trigger products_search before insert or update on public.products
  for each row execute function public.products_search_update();

create table public.product_aliases (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  kind text not null check (kind in ('domain','host_path','name','ph_slug','github_repo','trustmrr_slug','hn_item','social')),
  value text not null
);
-- strong identifiers are globally unique; weak ones (name, social) may be shared between products
create unique index product_aliases_strong_uq on public.product_aliases (kind, value) where kind not in ('name','social');
create unique index product_aliases_weak_uq on public.product_aliases (kind, value, product_id) where kind in ('name','social');
create index product_aliases_lookup on public.product_aliases (kind, value);
create index product_aliases_product on public.product_aliases (product_id);

create table public.sources (
  id text primary key,
  name text not null,
  kind text not null,
  role text not null,
  status text not null,
  enabled boolean not null default false,
  refresh_minutes int not null default 60,
  homepage text not null default '',
  docs_url text,
  notes text,
  credential_env text[] not null default '{}',
  credentials_present boolean,
  runs_in text[] not null default '{server}',
  config jsonb not null default '{}',
  cursor jsonb not null default '{}',
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  products_discovered int not null default 0,
  mentions_collected int not null default 0,
  custom boolean not null default false
);

create table public.source_mentions (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.sources(id),
  product_id uuid not null references public.products(id) on delete cascade,
  external_id text not null,
  url text not null,
  title text,
  excerpt text,
  author text,
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  collected_at timestamptz not null default now(),
  content_hash text not null,
  unique (source_id, external_id)
);
create index source_mentions_product on public.source_mentions (product_id);

create table public.metric_observations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  mention_id uuid references public.source_mentions(id) on delete set null,
  source_id text not null references public.sources(id),
  metric text not null,
  value double precision not null,
  unit text not null,
  currency text,
  period_start date,
  period_end date,
  period_label text,
  as_of timestamptz,
  evidence text not null check (evidence in ('verified','platform_metric','founder_reported','third_party_estimate','ai_estimate','unknown')),
  confidence text not null check (confidence in ('high','medium','low')),
  source_url text not null,
  quote text,
  note text,
  attribution text,
  published_at timestamptz,
  collected_at timestamptz not null default now(),
  dedupe_key text not null unique
);
create index metric_observations_product on public.metric_observations (product_id, metric);

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  type text not null,
  title text not null,
  detail text,
  significance int not null default 0,
  occurred_at timestamptz not null default now(),
  source_id text references public.sources(id),
  mention_id uuid references public.source_mentions(id) on delete set null,
  observation_id uuid references public.metric_observations(id) on delete set null,
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);
create index product_events_product on public.product_events (product_id, occurred_at desc);
create index product_events_recent on public.product_events (occurred_at desc);

create table public.product_relationships (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  related_product_id uuid references public.products(id) on delete set null,
  related_name text not null,
  related_domain text,
  kind text not null check (kind in ('competitor','similar','same_company')),
  reason text,
  source_id text references public.sources(id),
  unique (product_id, kind, related_name)
);

create table public.merge_candidates (
  id uuid primary key default gen_random_uuid(),
  product_a uuid not null references public.products(id) on delete cascade,
  product_b uuid not null references public.products(id) on delete cascade,
  reason text not null,
  score real not null,
  status text not null default 'open' check (status in ('open','merged','dismissed')),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  unique (product_a, product_b)
);

create table public.advertisements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  source_id text not null,
  external_id text not null,
  platform text not null,
  advertiser text,
  headline text,
  body text,
  media_type text,
  media_url text,
  landing_url text,
  first_observed timestamptz,
  last_observed timestamptz,
  is_active boolean,
  original_url text,
  analysis jsonb,
  manual boolean not null default false,
  created_by uuid references auth.users(id),
  unique (source_id, external_id)
);
create table public.advertisement_observations (
  id bigint generated always as identity primary key,
  advertisement_id uuid not null references public.advertisements(id) on delete cascade,
  observed_at timestamptz not null default now(),
  is_active boolean
);

create table public.research_reports (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  tier text not null check (tier in ('lite','deep')),
  generator text not null check (generator in ('rules','ai')),
  model text,
  content jsonb not null,
  cost_tokens int,
  created_at timestamptz not null default now()
);
create index research_reports_product on public.research_reports (product_id, created_at desc);

create table public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.sources(id) on delete cascade,
  status text not null,
  trigger text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_fetched int not null default 0,
  mentions_new int not null default 0,
  products_created int not null default 0,
  products_updated int not null default 0,
  observations_new int not null default 0,
  events_new int not null default 0,
  error text,
  log jsonb not null default '[]'
);
create index ingestion_jobs_recent on public.ingestion_jobs (started_at desc);

-- ---------------------------------------------------------------- per-user data
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table public.saved_products (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  collection_id uuid references public.collections(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create table public.collection_products (
  collection_id uuid not null references public.collections(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (collection_id, product_id)
);
create table public.tracked_products (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  min_significance int not null default 50,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create table public.research_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  kind text not null default 'observation' check (kind in ('observation','conclusion','opportunity')),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  target_audience text not null default '',
  monetization text not null default '',
  distribution text not null default '',
  competitors text not null default '',
  feasibility text not null default '',
  mvp_complexity text not null default '' check (mvp_complexity in ('','low','medium','high')),
  notes text not null default '',
  status text not null default 'idea' check (status in ('idea','researching','validating','planned','building','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.opportunity_products (
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (opportunity_id, product_id)
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  event_id uuid not null references public.product_events(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, event_id)
);
create table public.notification_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  digest text not null default 'off' check (digest in ('off','daily','weekly')),
  default_min_significance int not null default 50,
  email boolean not null default false
);
create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  weights jsonb not null default '{"growth":30,"monetization":30,"distribution":25,"feasibility":15}'
);

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  -- shared research tables: read for signed-in users, writes only via service role (no policies)
  foreach t in array array['companies','products','product_aliases','sources','source_mentions','metric_observations','product_events',
    'product_relationships','merge_candidates','advertisements','advertisement_observations','research_reports','ingestion_jobs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
  -- per-user tables: owner only
  foreach t in array array['collections','saved_products','collection_products','tracked_products','research_notes','opportunities',
    'opportunity_products','notifications','notification_preferences','user_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner select" on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy "owner insert" on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy "owner update" on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy "owner delete" on public.%I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;
-- users may not create notifications for themselves (pipeline does that); drop the insert policy
drop policy "owner insert" on public.notifications;

-- Users may file manual ad references (attributed to themselves).
create policy "insert manual ads" on public.advertisements for insert to authenticated
  with check (manual = true and created_by = auth.uid());

-- ---------------------------------------------------------------- merge (audited, security definer)
create or replace function public.merge_products(survivor uuid, loser uuid, candidate uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if survivor = loser then raise exception 'cannot merge a product into itself'; end if;
  -- move evidence
  update product_aliases a set product_id = survivor where product_id = loser
    and not exists (select 1 from product_aliases b where b.product_id = survivor and b.kind = a.kind and b.value = a.value);
  delete from product_aliases where product_id = loser;
  update source_mentions set product_id = survivor where product_id = loser;
  update metric_observations set product_id = survivor where product_id = loser;
  update product_events set product_id = survivor where product_id = loser;
  update product_relationships set product_id = survivor where product_id = loser
    and not exists (select 1 from product_relationships r where r.product_id = survivor and r.kind = product_relationships.kind and r.related_name = product_relationships.related_name);
  update advertisements set product_id = survivor where product_id = loser;
  update research_notes set product_id = survivor where product_id = loser;
  insert into saved_products (user_id, product_id, collection_id, note, created_at)
    select user_id, survivor, collection_id, note, created_at from saved_products where product_id = loser on conflict do nothing;
  insert into tracked_products (user_id, product_id, min_significance, created_at)
    select user_id, survivor, min_significance, created_at from tracked_products where product_id = loser on conflict do nothing;
  insert into opportunity_products (opportunity_id, product_id, user_id)
    select opportunity_id, survivor, user_id from opportunity_products where product_id = loser on conflict do nothing;
  delete from saved_products where product_id = loser;
  delete from tracked_products where product_id = loser;
  delete from opportunity_products where product_id = loser;
  update products set status = 'merged', merged_into = survivor, last_updated_at = now() where id = loser;
  update products set
    source_ids = (select coalesce(array_agg(distinct source_id), '{}') from source_mentions where product_id = survivor),
    source_count = (select count(distinct source_id) from source_mentions where product_id = survivor),
    last_updated_at = now()
  where id = survivor;
  insert into product_events (product_id, type, title, detail, significance, dedupe_key)
    values (survivor, 'merged', 'Merged duplicate profile', 'Merged ' || loser::text || ' by user ' || auth.uid()::text, 20, 'merge:' || loser::text);
  update merge_candidates set status = 'merged', resolved_by = auth.uid(), resolved_at = now()
    where id = candidate or (product_a in (survivor, loser) and product_b in (survivor, loser));
end $$;
revoke all on function public.merge_products(uuid, uuid, uuid) from public, anon;
grant execute on function public.merge_products(uuid, uuid, uuid) to authenticated;

create or replace function public.dismiss_merge_candidate(candidate uuid)
returns void language sql security definer set search_path = public as $$
  update merge_candidates set status = 'dismissed', resolved_by = auth.uid(), resolved_at = now() where id = candidate and auth.uid() is not null;
$$;
revoke all on function public.dismiss_merge_candidate(uuid) from public, anon;
grant execute on function public.dismiss_merge_candidate(uuid) to authenticated;

-- Source settings editable by signed-in users (enable/disable, frequency) without exposing other columns.
create or replace function public.update_source_settings(source text, is_enabled boolean, refresh int)
returns void language sql security definer set search_path = public as $$
  update sources set enabled = is_enabled, refresh_minutes = greatest(15, refresh)
  where id = source and auth.uid() is not null and status not in ('unsupported','licensed');
$$;
revoke all on function public.update_source_settings(text, boolean, int) from public, anon;
grant execute on function public.update_source_settings(text, boolean, int) to authenticated;

create or replace function public.add_rss_source(feed_url text, display_name text)
returns text language plpgsql security definer set search_path = public as $$
declare sid text := 'rss_' || substr(md5(feed_url), 1, 10);
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if feed_url !~ '^https?://' then raise exception 'feed URL must be http(s)'; end if;
  insert into sources (id, name, kind, role, status, enabled, refresh_minutes, homepage, notes, runs_in, config, custom)
  values (sid, display_name, 'rss', 'discovery', 'operational', true, 240, feed_url,
    'User-added RSS/Atom feed. Items become products only when they link to a product website.', '{server}',
    jsonb_build_object('url', feed_url), true)
  on conflict (id) do nothing;
  return sid;
end $$;
revoke all on function public.add_rss_source(text, text) from public, anon;
grant execute on function public.add_rss_source(text, text) to authenticated;
