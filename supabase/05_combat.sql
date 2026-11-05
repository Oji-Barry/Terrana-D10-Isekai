-- Jimothy's D10 Isekai JRPG: hosted combat (encounters, combatants, rolls), live
-- Run once in the Supabase SQL Editor, after 02_ourspace.sql.

-- ENCOUNTERS ----------------------------------------------------------
-- The host is the Storyteller for that encounter. Players join with its code.
create table public.encounters (
  id         uuid primary key default gen_random_uuid(),
  host       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  code       text not null unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
  map        jsonb not null default '{"cols": 5, "rows": 7, "theme": "dark"}'::jsonb,
  state      jsonb not null default '{"round": 1, "turn": 0, "order": []}'::jsonb,
  open       boolean not null default true,
  public     boolean not null default false, -- public: anyone can join from the list; private: needs the code
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index encounters_host_idx on public.encounters (host);

create table public.encounter_players (
  encounter_id uuid not null references public.encounters (id) on delete cascade,
  player       uuid not null references public.profiles (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (encounter_id, player)
);
create index encounter_players_player_idx on public.encounter_players (player);

create function public.in_encounter(e uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.encounters where id = e and host = (select auth.uid()))
      or exists (select 1 from public.encounter_players where encounter_id = e and player = (select auth.uid()));
$$;

create function public.hosts_encounter(e uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.encounters where id = e and host = (select auth.uid()));
$$;

alter table public.encounters enable row level security;
alter table public.encounter_players enable row level security;

create policy "members see the encounter"
  on public.encounters for select to authenticated
  using (host = (select auth.uid()) or public.in_encounter(id));
create policy "anyone can host"
  on public.encounters for insert to authenticated
  with check (host = (select auth.uid()));
create policy "host runs the encounter"
  on public.encounters for update to authenticated
  using (host = (select auth.uid())) with check (host = (select auth.uid()));
create policy "host ends the encounter"
  on public.encounters for delete to authenticated
  using (host = (select auth.uid()));

create policy "members see who joined"
  on public.encounter_players for select to authenticated
  using (public.in_encounter(encounter_id));
create policy "leave, or host removes"
  on public.encounter_players for delete to authenticated
  using (player = (select auth.uid()) or public.hosts_encounter(encounter_id));

grant select, insert, update, delete on public.encounters to authenticated;
grant select, delete on public.encounter_players to authenticated;

create trigger encounters_touch
  before update on public.encounters
  for each row execute function public.touch_updated_at();

-- 10 encounters per host
create function public.limit_encounters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.encounters where host = new.host) >= 10 then
    raise exception 'You already host 10 encounters. End one to start another.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger encounters_limit
  before insert on public.encounters
  for each row execute function public.limit_encounters();

-- Join with a code. Returns the encounter id.
create function public.join_encounter(join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e uuid;
begin
  if auth.uid() is null then
    raise exception 'Log in to join.' using errcode = '42501';
  end if;
  select id into e from public.encounters where code = upper(trim(join_code)) and open;
  if e is null then
    raise exception 'No open encounter has that code.' using errcode = 'P0001';
  end if;
  insert into public.encounter_players (encounter_id, player) values (e, auth.uid()) on conflict do nothing;
  return e;
end;
$$;
revoke all on function public.join_encounter(text) from public, anon;
grant execute on function public.join_encounter(text) to authenticated;

-- Every open fight for the Combat page list, without the join codes
create function public.list_encounters()
returns table (id uuid, name text, host_name text, is_public boolean, players int, mine boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.name, coalesce(p.username, ''), e.public,
         (select count(*)::int from public.encounter_players ep where ep.encounter_id = e.id),
         (e.host = (select auth.uid()) or exists (select 1 from public.encounter_players ep where ep.encounter_id = e.id and ep.player = (select auth.uid()))),
         e.created_at
  from public.encounters e
  left join public.profiles p on p.id = e.host
  where e.open
  order by e.created_at desc
  limit 100;
$$;
revoke all on function public.list_encounters() from public;
grant execute on function public.list_encounters() to anon, authenticated;

-- Join a public fight from the list (private fights need join_encounter with the code)
create function public.join_public_encounter(e uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Log in to join.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.encounters where id = e and open and public) then
    if exists (select 1 from public.encounters where id = e and host = auth.uid()) then return e; end if;
    raise exception 'That fight is private, or no longer open. Ask the Storyteller for its code.' using errcode = 'P0001';
  end if;
  insert into public.encounter_players (encounter_id, player) values (e, auth.uid()) on conflict do nothing;
  return e;
end;
$$;
revoke all on function public.join_public_encounter(uuid) from public, anon;
grant execute on function public.join_public_encounter(uuid) to authenticated;

-- COMBATANTS ----------------------------------------------------------
create table public.combatants (
  id           uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters (id) on delete cascade,
  owner        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  character_id uuid references public.characters (id) on delete set null,
  name         text not null check (char_length(name) between 1 and 60),
  kind         text not null default 'pc' check (kind in ('pc', 'npc', 'summon')),
  side         text not null default 'party' check (side in ('party', 'enemy', 'neutral')),
  x            int,
  y            int,
  initiative   int not null default 0,
  ap           int not null default 0,
  health       jsonb not null default '{"b": 0, "l": 0, "a": 0}'::jsonb,
  boxes        jsonb not null default '{"b": 7, "l": 5, "a": 3}'::jsonb,
  bdt          int not null default 1,
  mana         int not null default 0,
  mana_max     int not null default 0,
  mt           int not null default 0,
  willpower    int not null default 5,
  conditions   jsonb not null default '[]'::jsonb,
  stats        jsonb not null default '{}'::jsonb,
  hidden       boolean not null default false,
  pic_url      text not null default '' check (pic_url = '' or pic_url ~ '^https://'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index combatants_encounter_idx on public.combatants (encounter_id);
alter table public.combatants replica identity full;

alter table public.combatants enable row level security;

create policy "members see combatants"
  on public.combatants for select to authenticated
  using (public.in_encounter(encounter_id)
         and (not hidden or owner = (select auth.uid()) or public.hosts_encounter(encounter_id)));
create policy "host adds anything, players add their own"
  on public.combatants for insert to authenticated
  with check (public.hosts_encounter(encounter_id)
              or (owner = (select auth.uid()) and public.in_encounter(encounter_id)
                  and (character_id is null or exists (select 1 from public.characters c where c.id = character_id and c.owner = (select auth.uid())))));
create policy "host or owner changes a combatant"
  on public.combatants for update to authenticated
  using (public.hosts_encounter(encounter_id) or owner = (select auth.uid()))
  with check (public.hosts_encounter(encounter_id) or owner = (select auth.uid()));
create policy "host or owner removes a combatant"
  on public.combatants for delete to authenticated
  using (public.hosts_encounter(encounter_id) or owner = (select auth.uid()));

grant select, insert, update, delete on public.combatants to authenticated;

create trigger combatants_touch
  before update on public.combatants
  for each row execute function public.touch_updated_at();

-- ROLLS ---------------------------------------------------------------
create table public.rolls (
  id           uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters (id) on delete cascade,
  roller       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  combatant_id uuid references public.combatants (id) on delete set null,
  label        text not null default '' check (char_length(label) <= 200),
  pool         int not null default 0,
  dice         int[] not null default '{}',
  successes    int not null default 0,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index rolls_encounter_idx on public.rolls (encounter_id, created_at desc);

alter table public.rolls enable row level security;

create policy "members see rolls"
  on public.rolls for select to authenticated
  using (public.in_encounter(encounter_id));
create policy "members roll"
  on public.rolls for insert to authenticated
  with check (roller = (select auth.uid()) and public.in_encounter(encounter_id));
create policy "host clears rolls"
  on public.rolls for delete to authenticated
  using (public.hosts_encounter(encounter_id));

grant select, insert, delete on public.rolls to authenticated;

-- LIVE UPDATES --------------------------------------------------------
alter publication supabase_realtime add table public.encounters, public.encounter_players, public.combatants, public.rolls;
