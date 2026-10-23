-- Each fan's result per settled series (written by the tick). Losses count straight away; a win waits for the fan to
-- claim it (claimed_at), then the payout (stake + net) joins their balance. Private: only the server reads or writes.
create table if not exists public.fan_results (
  match_id text not null,
  address text not null,
  stake int not null,
  net int not null,
  claimed_at timestamptz,
  primary key (match_id, address)
);
alter table public.fan_results enable row level security;

-- One side per market: more buys must be on the outcome the fan already holds.
create or replace function public.buy_pick(p_match_id text, p_address text, p_market text, p_choice text, p_amount int, p_at timestamptz)
returns int language plpgsql as $$
declare total int;
begin
  if exists (select 1 from public.picks where match_id = p_match_id and address = p_address and market = p_market and choice <> p_choice) then
    raise exception 'other_side' using errcode = 'P0001';
  end if;
  insert into public.picks (match_id, address, market, choice, stake, updated_at)
  values (p_match_id, p_address, p_market, p_choice, p_amount, p_at)
  on conflict (match_id, address, market, choice)
  do update set stake = public.picks.stake + excluded.stake, updated_at = excluded.updated_at
  returning stake into total;
  insert into public.buys (match_id, address, market, choice, amount, at) values (p_match_id, p_address, p_market, p_choice, p_amount, p_at);
  return total;
end $$;
revoke execute on function public.buy_pick(text, text, text, text, int, timestamptz) from public, anon, authenticated;
