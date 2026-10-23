-- Up to two favourite champions per fan (Data Dragon ids like "JarvanIV"), shown next to their name.
alter table public.fans add column if not exists fav_champs text[] not null default '{}'
  check (cardinality(fav_champs) <= 2);
grant select (fav_champs) on public.fans to anon, authenticated;
