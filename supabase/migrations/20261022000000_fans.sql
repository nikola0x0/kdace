-- KDAce fan accounts, fan picks and fan-batch commits.
-- Everyone may read (the crowd split and committed batches are public). Only the server writes, with the
-- service role key, which bypasses row level security. anon/authenticated get no write grants at all.

create table public.fans (
  address          text primary key check (address ~ '^0x[0-9a-f]{64}$'),
  suins_name       text,
  suins_checked_at timestamptz,
  created_at       timestamptz not null default now()
);

create table public.picks (
  match_id   text not null,
  address    text not null references public.fans (address) on delete cascade,
  market     text not null check (market in ('winner', 'score')),
  choice     text not null,
  -- Server time of the last accepted pick; the lock job only takes picks stamped before lock.
  updated_at timestamptz not null,
  unique (match_id, address, market)
);
create index picks_address_idx on public.picks (address);

-- One fan batch per series. Recorded as 'committing' before the Sui call and 'committed' after,
-- so a crash resumes with the same hash instead of committing a different batch.
create table public.fan_commits (
  match_id      text primary key,
  status        text not null check (status in ('committing', 'committed', 'missed')),
  batch         text,          -- canonicalBatch('<matchId>:fans', entries), byte-exact
  batch_hash    text,          -- sha256 hex of batch, as committed on chain
  pick_count    integer not null default 0,
  commit_digest text,
  network       text not null, -- 'testnet' | 'mainnet'
  package_id    text not null,
  committed_at  timestamptz,
  attempted_at  timestamptz not null
);

-- Mutex for Referee transactions: the GitHub tick and the Vercel lock route sign with the same key and
-- ResolverCap, and two concurrent transactions on one owned object can lock it until the epoch ends.
create table public.referee_lock (
  id         integer primary key default 1 check (id = 1),
  holder     text,
  expires_at timestamptz not null default 'epoch'
);
insert into public.referee_lock (id) values (1);

create function public.acquire_referee_lock(p_holder text, p_ttl_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare got integer;
begin
  update referee_lock set holder = p_holder, expires_at = now() + make_interval(secs => p_ttl_seconds)
   where id = 1 and (expires_at < now() or holder = p_holder);
  get diagnostics got = row_count;
  return got = 1;
end $$;

create function public.release_referee_lock(p_holder text) returns void
language sql security definer set search_path = public as $$
  update referee_lock set holder = null, expires_at = 'epoch' where id = 1 and holder = p_holder;
$$;

revoke execute on function public.acquire_referee_lock(text, integer) from public, anon, authenticated;
revoke execute on function public.release_referee_lock(text) from public, anon, authenticated;
grant execute on function public.acquire_referee_lock(text, integer) to service_role;
grant execute on function public.release_referee_lock(text) to service_role;

alter table public.fans enable row level security;
alter table public.picks enable row level security;
alter table public.fan_commits enable row level security;
alter table public.referee_lock enable row level security;

create policy "fans are public" on public.fans for select using (true);
create policy "picks are public" on public.picks for select using (true);
create policy "fan commits are public" on public.fan_commits for select using (true);
-- referee_lock: no policy, so only the service role sees it.

revoke insert, update, delete, truncate on public.fans, public.picks, public.fan_commits, public.referee_lock from anon, authenticated;
