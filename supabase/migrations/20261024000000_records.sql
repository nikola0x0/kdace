-- The published records in Supabase, for KDACE_STORE=supabase (src/core/supastore.ts): series records, title days,
-- the board / fan names / pending list, Scout's data, and the staged runner's lock and schedule. Applying this changes
-- nothing by itself: the jobs and the site keep using data/ in git until KDACE_STORE=supabase is set.
--
-- Values are `json`, not `jsonb`: json keeps the text exactly as written (key order included), so a record exported
-- back to data/ is byte-identical to what was copied in. Records are only ever read and written whole.
-- Series records and title days carry a version: a write only replaces the version its writer read (compare-and-set).
--
-- Only the server touches these tables, with the service role key (bypasses row level security). RLS is on with no
-- policies, and anon/authenticated get no grants: the site reads server-side, and /api/records serves the public view.

create table if not exists public.series_records (
  match_id   text primary key,
  record     json not null,
  version    integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.title_days (
  date       date primary key,
  day        json not null,
  version    integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

-- Single documents derived from the records: the board, the fans' display names, the pending list.
create table if not exists public.record_docs (
  key        text primary key check (key in ('board', 'fan_names', 'pending')),
  value      json not null,
  updated_at timestamptz not null default now()
);

-- Scout's files (data/scout/<key>.json); games is ~1.5 MB.
create table if not exists public.scout_data (
  key        text primary key check (key in ('series', 'games', 'teams', 'meta')),
  value      json not null,
  updated_at timestamptz not null default now()
);

-- Mutex for the staged runner (/api/tick on Vercel and the GitHub tick in supabase mode): one stage at a time.
-- Same shape as referee_lock; the database clock decides expiry, so a killed invocation frees it after its TTL.
create table if not exists public.runner_lock (
  id         integer primary key default 1 check (id = 1),
  holder     text,
  expires_at timestamptz not null default 'epoch'
);
insert into public.runner_lock (id) values (1) on conflict (id) do nothing;

-- When each runner stage may run next (back-off after a run that made no progress, Scout every 30 minutes).
create table if not exists public.runner_state (
  stage   text primary key,
  next_at timestamptz,
  last_at timestamptz,
  note    text
);

create or replace function public.acquire_runner_lock(p_holder text, p_ttl_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare got integer;
begin
  update runner_lock set holder = p_holder, expires_at = now() + make_interval(secs => p_ttl_seconds)
   where id = 1 and (expires_at < now() or holder = p_holder);
  get diagnostics got = row_count;
  return got = 1;
end $$;

create or replace function public.release_runner_lock(p_holder text) returns void
language sql security definer set search_path = public as $$
  update runner_lock set holder = null, expires_at = 'epoch' where id = 1 and holder = p_holder;
$$;

revoke execute on function public.acquire_runner_lock(text, integer) from public, anon, authenticated;
revoke execute on function public.release_runner_lock(text) from public, anon, authenticated;
grant execute on function public.acquire_runner_lock(text, integer) to service_role;
grant execute on function public.release_runner_lock(text) to service_role;

alter table public.series_records enable row level security;
alter table public.title_days enable row level security;
alter table public.record_docs enable row level security;
alter table public.scout_data enable row level security;
alter table public.runner_lock enable row level security;
alter table public.runner_state enable row level security;

revoke all on public.series_records, public.title_days, public.record_docs, public.scout_data, public.runner_lock, public.runner_state from anon, authenticated;
