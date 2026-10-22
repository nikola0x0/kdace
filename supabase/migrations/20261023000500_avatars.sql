-- Fan-uploaded profile photos: a public bucket (photos show on the public leaderboard). Only the server writes, with
-- the service key, after checking the file; 256px WebP from the browser is ~20 KB, so the cap is generous.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 204800, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
