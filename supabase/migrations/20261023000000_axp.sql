-- AXP play-money betting. AXP has no cash value, can't be transferred and isn't a token; every player starts with
-- 10,000 and stakes it on outcomes. Each market settles parimutuel (see src/core/points.ts).
--
-- picks.stake:            AXP staked on the pick (the API requires a whole number of at least 10). Rows from before
--                         this migration get 10.
-- fans.axp_settled:       the fan's net AXP over settled series, written by the tick after settle (from the published
--                         batches in data/series). Balance = 10,000 + axp_settled.
-- fan_commits.settled_at: when the tick counted this series into axp_settled. Until then the stakes in it are still
--                         open, so the API keeps holding them back from the fan's available AXP.

alter table public.picks
  add column stake integer not null default 10 check (stake >= 1);

alter table public.fans
  add column axp_settled integer not null default 0;

alter table public.fan_commits
  add column settled_at timestamptz;

-- fans has column-level read grants (20261022000200_fan_auth.sql); the settled balance is public like the batches it
-- comes from.
grant select (axp_settled) on public.fans to anon, authenticated;
