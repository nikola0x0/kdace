-- The role a fan cheers for (same five roles as the AI analysts); shown next to their name.
alter table public.fans add column if not exists fav_role text check (fav_role in ('top', 'jungle', 'mid', 'adc', 'support'));
grant select (fav_role) on public.fans to anon, authenticated;
