-- Jimothy's D10 Isekai JRPG: editing blog posts, with the earlier versions kept so anyone can see what changed
-- Run once in the Supabase SQL Editor, after 08_bestiary.sql. Safe to run more than once.

alter table public.posts add column if not exists edited_at timestamptz;
alter table public.posts add column if not exists history jsonb not null default '[]'::jsonb;

-- The database keeps the history itself, so nobody can fake or wipe it:
-- a new post always starts with no history, and every change to the title or words saves the version before it.
-- It keeps the original plus the 19 most recent earlier versions.
create or replace function public.posts_keep_history()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  h jsonb;
begin
  if tg_op = 'INSERT' then
    new.history := '[]'::jsonb;
    new.edited_at := null;
    return new;
  end if;
  if new.title is distinct from old.title or new.body is distinct from old.body then
    h := case when jsonb_typeof(old.history) = 'array' then old.history else '[]'::jsonb end;
    h := h || jsonb_build_array(jsonb_build_object('title', old.title, 'body', old.body, 'at', coalesce(old.edited_at, old.created_at)));
    if jsonb_array_length(h) > 20 then
      h := jsonb_build_array(h -> 0) || (
        select jsonb_agg(e order by i) from jsonb_array_elements(h) with ordinality as x(e, i)
        where i > jsonb_array_length(h) - 19);
    end if;
    new.history := h;
    new.edited_at := now();
  else
    new.history := old.history;
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_history on public.posts;
create trigger posts_history
  before insert or update on public.posts
  for each row execute function public.posts_keep_history();
