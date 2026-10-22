-- Google profile photo for the leaderboard and header (Google sign-in only; wallet fans show initials).
alter table public.fans add column if not exists avatar_url text;
grant select (avatar_url) on public.fans to anon, authenticated;
