-- Profile pictures and nicknames for players.
-- avatar_url: public URL of the picture in the `avatars` storage bucket.
-- nicknames: free-form aliases entered comma-separated in the admin panel.

alter table public.players
  add column if not exists avatar_url text,
  add column if not exists nicknames text[] not null default '{}'::text[];

-- Public-read bucket for player pictures. Only the service role (admin API)
-- writes to it; anon/authenticated get read access through the public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');
