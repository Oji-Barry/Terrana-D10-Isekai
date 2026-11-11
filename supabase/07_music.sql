-- Jimothy's D10 Isekai JRPG: music in combat and OurSpace profile songs
-- Run once in the Supabase SQL Editor, after 06_combat_turns.sql.

-- COMBAT MUSIC --------------------------------------------------------
-- The Storyteller always controls the fight's music. When they flip "Let players pick songs" on,
-- anyone in the fight can change it too (but only the Storyteller can flip it back off).
create function public.set_music(e uuid, m jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st jsonb; h uuid;
begin
  if jsonb_typeof(m) <> 'object' then raise exception 'Bad music setting.' using errcode = 'P0001'; end if;
  select state, host into st, h from public.encounters where id = e for update;
  if st is null then raise exception 'No such encounter.' using errcode = 'P0001'; end if;
  if h <> auth.uid() then
    if not public.in_encounter(e) then raise exception 'You are not in this fight.' using errcode = '42501'; end if;
    if not coalesce((st->'music'->>'open')::boolean, false) then
      raise exception 'The Storyteller picks the music.' using errcode = '42501';
    end if;
    m := m || '{"open": true}'::jsonb;
  end if;
  st := jsonb_set(st, '{music}', m);
  update public.encounters set state = st where id = e;
  return st;
end;
$$;
revoke all on function public.set_music(uuid, jsonb) from public, anon;
grant execute on function public.set_music(uuid, jsonb) to authenticated;

-- PROFILE SONGS -------------------------------------------------------
-- A public bucket for songs players upload for their OurSpace pages: 10 MB each, audio only, 5 per player.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ourspace-music', 'ourspace-music', true, 10485760,
        array['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/webm', 'audio/flac'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create function public.my_song_count()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from storage.objects
  where bucket_id = 'ourspace-music' and (storage.foldername(name))[1] = (select auth.uid())::text;
$$;
revoke all on function public.my_song_count() from public, anon;
grant execute on function public.my_song_count() to authenticated;

create policy "profile songs are public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'ourspace-music');

create policy "players upload up to 5 songs into their own folder"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'ourspace-music'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.my_song_count() < 5);

create policy "players delete their own songs"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'ourspace-music' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Every uploaded song, with the uploader's username, so all the site's players can list them by player
create or replace function public.list_songs()
returns table (username text, path text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.username::text, o.name, o.created_at
  from storage.objects o
  join public.profiles p on p.id::text = (storage.foldername(o.name))[1]
  where o.bucket_id = 'ourspace-music' and o.name !~ '\.emptyFolderPlaceholder$'
  order by p.username, o.created_at
  limit 500;
$$;
revoke all on function public.list_songs() from public;
grant execute on function public.list_songs() to anon, authenticated;
