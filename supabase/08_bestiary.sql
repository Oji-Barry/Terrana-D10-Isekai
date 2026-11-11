-- Jimothy's D10 Isekai JRPG: each player's own Bestiary
-- Run once in the Supabase SQL Editor, after 07_music.sql.
-- A player adds a creature after fighting one; from then on they can see its stats in combat.

create table public.player_bestiary (
  player     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  creature   text not null check (char_length(creature) between 1 and 80),
  name       text not null default '' check (char_length(name) <= 80),
  added_at   timestamptz not null default now(),
  primary key (player, creature)
);

alter table public.player_bestiary enable row level security;

create policy "players see their own bestiary"
  on public.player_bestiary for select to authenticated
  using (player = (select auth.uid()));
create policy "players add to their own bestiary"
  on public.player_bestiary for insert to authenticated
  with check (player = (select auth.uid()));
create policy "players remove from their own bestiary"
  on public.player_bestiary for delete to authenticated
  using (player = (select auth.uid()));

grant select, insert, delete on public.player_bestiary to authenticated;
