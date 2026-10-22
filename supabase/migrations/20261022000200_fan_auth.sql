-- How each fan signs in, and the zkLogin salt of Google fans (KDAce's own Google sign-in replaces Enoki).
-- auth_method: 'google' (verified Google ID token → zkLogin address) or 'wallet' (signed personal message).
-- zklogin_salt: HMAC-SHA256(ZKLOGIN_SALT_SECRET, iss|sub) truncated below 2^128, as a decimal string. It is
-- recoverable from the secret alone; it is kept here too as a backup. Salts are private: they are what links a
-- Google account to its address, so the public read access to fans is narrowed to the other columns.

alter table public.fans
  add column auth_method  text check (auth_method in ('google', 'wallet')),
  add column zklogin_salt text check (zklogin_salt ~ '^[0-9]{1,39}$');

-- Everyone who signed in before this migration did so by signing a message.
update public.fans set auth_method = 'wallet' where auth_method is null;

-- Column-level read access: everything but the salt. New columns stay private until granted here.
revoke select on public.fans from anon, authenticated;
grant select (address, suins_name, suins_checked_at, created_at, auth_method) on public.fans to anon, authenticated;
