-- Append-only log of every buy, for the live activity feed (positions in `picks` only keep the running total).
create table if not exists public.buys (
  id bigint generated always as identity primary key,
  match_id text not null,
  address text not null,
  market text not null,
  choice text not null,
  amount int not null check (amount >= 1),
  at timestamptz not null default now()
);
create index if not exists buys_at_idx on public.buys (at desc);
create index if not exists buys_match_idx on public.buys (match_id, at desc);
alter table public.buys enable row level security;
create policy buys_public_read on public.buys for select to anon, authenticated using (true);

-- buy_pick now also appends to the log, in the same statement's transaction.
create or replace function public.buy_pick(p_match_id text, p_address text, p_market text, p_choice text, p_amount int, p_at timestamptz)
returns int language plpgsql as $$
declare total int;
begin
  insert into public.picks (match_id, address, market, choice, stake, updated_at)
  values (p_match_id, p_address, p_market, p_choice, p_amount, p_at)
  on conflict (match_id, address, market, choice)
  do update set stake = public.picks.stake + excluded.stake, updated_at = excluded.updated_at
  returning stake into total;
  insert into public.buys (match_id, address, market, choice, amount, at) values (p_match_id, p_address, p_market, p_choice, p_amount, p_at);
  return total;
end $$;
revoke execute on function public.buy_pick(text, text, text, text, int, timestamptz) from public, anon, authenticated;
