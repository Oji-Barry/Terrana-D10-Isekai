-- Jimothy's D10 Isekai JRPG: OurSpace picture uploads
-- Run once in the Supabase SQL Editor, after 02_ourspace.sql.

-- A public bucket for page pictures and blog pictures, 3 MB each, images only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ourspace', 'ourspace', true, 3145728, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can see the pictures (they are on public pages)
create policy "ourspace pictures are public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'ourspace');

-- Players can only upload into their own folder (named with their account id)
create policy "players upload their own pictures"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'ourspace' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "players delete their own pictures"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'ourspace' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Blog posts can carry up to 4 pictures
alter table public.posts
  add column images jsonb not null default '[]'::jsonb
  check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 4);
