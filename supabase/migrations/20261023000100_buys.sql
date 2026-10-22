-- Buying, like Outcomes: each buy adds AXP to the fan's position on one outcome, and a fan can hold positions on
-- several outcomes of the same market. One row per (match, fan, market, outcome); the stake is the total bought.
alter table public.picks drop constraint if exists picks_match_id_address_market_key;
alter table public.picks add constraint picks_match_id_address_market_choice_key unique (match_id, address, market, choice);

-- Atomic buy: insert the position, or add to it. Returns the new total. Called by the server (service role) only.
create or replace function public.buy_pick(p_match_id text, p_address text, p_market text, p_choice text, p_amount int, p_at timestamptz)
returns int language sql as $$
  insert into public.picks (match_id, address, market, choice, stake, updated_at)
  values (p_match_id, p_address, p_market, p_choice, p_amount, p_at)
  on conflict (match_id, address, market, choice)
  do update set stake = public.picks.stake + excluded.stake, updated_at = excluded.updated_at
  returning stake;
$$;
revoke execute on function public.buy_pick(text, text, text, text, int, timestamptz) from public, anon, authenticated;
