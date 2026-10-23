-- Fans can cancel a buy before lock: the buy is marked canceled and its AXP leaves the position (atomic).
alter table public.buys add column if not exists canceled_at timestamptz;

create or replace function public.cancel_buy(p_buy_id bigint, p_address text, p_at timestamptz)
returns int language plpgsql as $$
declare b public.buys%rowtype;
begin
  select * into b from public.buys where id = p_buy_id and address = p_address and canceled_at is null for update;
  if not found then raise exception 'no_such_buy' using errcode = 'P0001'; end if;
  if exists (select 1 from public.fan_commits where match_id = b.match_id) then raise exception 'locked' using errcode = 'P0001'; end if;
  update public.buys set canceled_at = p_at where id = p_buy_id;
  update public.picks set stake = stake - b.amount, updated_at = p_at
    where match_id = b.match_id and address = p_address and market = b.market and choice = b.choice;
  delete from public.picks where match_id = b.match_id and address = p_address and market = b.market and choice = b.choice and stake <= 0;
  return b.amount;
end $$;
revoke execute on function public.cancel_buy(bigint, text, timestamptz) from public, anon, authenticated;
