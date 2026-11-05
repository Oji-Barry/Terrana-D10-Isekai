-- Jimothy's D10 Isekai JRPG: combat phases (who may advance a turn) and damage to others' combatants
-- Run once in the Supabase SQL Editor, after 05_combat.sql.

-- The player whose turn it is may move through the phases and pass the turn.
-- They can only change phase, the turn tracker, and step the turn forward by one.
create function public.turn_update(e uuid, patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st jsonb; h uuid; ord jsonb; n int; t int; cur uuid; nt int;
begin
  select state, host into st, h from public.encounters where id = e for update;
  if st is null then raise exception 'No such encounter.' using errcode = 'P0001'; end if;
  if h = auth.uid() then
    st := st || patch;
  else
    ord := coalesce(st->'order', '[]'::jsonb);
    n := jsonb_array_length(ord);
    t := coalesce((st->>'turn')::int, 0);
    if n = 0 or not coalesce((st->>'started')::boolean, false) then raise exception 'Combat has not started.' using errcode = 'P0001'; end if;
    cur := (ord->>(t % n))::uuid;
    if not exists (select 1 from public.combatants where id = cur and encounter_id = e and owner = auth.uid()) then
      raise exception 'It is not your turn.' using errcode = '42501';
    end if;
    if exists (select 1 from jsonb_object_keys(patch) k where k not in ('phase', 't', 'turn', 'round')) then
      raise exception 'Only the Storyteller can change that.' using errcode = '42501';
    end if;
    if patch ? 'turn' then
      nt := (patch->>'turn')::int;
      if nt <> (t + 1) % n then raise exception 'You can only pass the turn to the next person.' using errcode = 'P0001'; end if;
    end if;
    st := st || patch;
  end if;
  update public.encounters set state = st where id = e;
  return st;
end;
$$;
revoke all on function public.turn_update(uuid, jsonb) from public, anon;
grant execute on function public.turn_update(uuid, jsonb) to authenticated;

-- Mark one damage box on a combatant someone else controls (a player's hit on an NPC).
-- Anyone in the encounter can do it; it is logged in the roll log by the page.
create function public.apply_damage(c uuid, k text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare e uuid;
begin
  if k not in ('b', 'l', 'a') then raise exception 'Unknown damage type.' using errcode = 'P0001'; end if;
  select encounter_id into e from public.combatants where id = c;
  if e is null or not public.in_encounter(e) then raise exception 'You are not in this fight.' using errcode = '42501'; end if;
  update public.combatants
     set health = jsonb_set(health, array[k], to_jsonb(coalesce((health->>k)::int, 0) + 1)),
         stats = jsonb_set(stats, '{hurt}', 'true'::jsonb)
   where id = c;
end;
$$;
revoke all on function public.apply_damage(uuid, text) from public, anon;
grant execute on function public.apply_damage(uuid, text) to authenticated;
