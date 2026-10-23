-- When the lock route last dispatched the GitHub tick workflow (src/core/dispatch.ts): one row, claimed with a
-- conditional update so the tick is dispatched at most once per 4 minutes even if two lock runs overlap.
-- Only the server touches it, with the service role key (bypasses row level security); nobody else gets any grant.
create table if not exists public.tick_dispatch (
  id      integer primary key default 1 check (id = 1),
  last_at timestamptz
);
insert into public.tick_dispatch (id) values (1) on conflict (id) do nothing;
alter table public.tick_dispatch enable row level security;
revoke all on public.tick_dispatch from anon, authenticated;
