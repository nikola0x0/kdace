-- A name the fan picks for themselves (shown instead of their SuiNS name or short address).
alter table public.fans add column if not exists nickname text check (nickname is null or char_length(nickname) between 3 and 20);
grant select (nickname) on public.fans to anon, authenticated;
