-- Jimothy's D10 Isekai JRPG: accounts and characters
-- Run once in the Supabase SQL Editor.

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- PLAYERS -------------------------------------------------------------
-- One row per account. Filled in automatically when someone signs up.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   extensions.citext not null unique
             check (username ~ '^[A-Za-z0-9_-]{3,20}$'),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone can see usernames (OurSpace needs this later). Nobody can change
-- them from the website; the admin flag is set by hand in the dashboard.
create policy "usernames are public"
  on public.profiles for select
  to anon, authenticated
  using (true);

grant select on public.profiles to anon, authenticated;

-- Make the profile row when a new account is created.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- CHARACTERS ----------------------------------------------------------
create table public.characters (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid()
             references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  sheet      jsonb not null default '{}'::jsonb,
  -- Who can see the stats: only the owner, friends (OurSpace, later), or everyone
  sheet_visibility text not null default 'private'
             check (sheet_visibility in ('private', 'friends', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index characters_owner_idx on public.characters (owner);

alter table public.characters enable row level security;

-- Players can only see and change their own characters.
create policy "owners read their characters"
  on public.characters for select
  to authenticated
  using (owner = (select auth.uid()));

-- The admin can see every character.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and is_admin);
$$;

create policy "admin reads all characters"
  on public.characters for select
  to authenticated
  using ((select public.is_admin()));

-- Characters whose owner made the sheet public can be seen by anyone.
create policy "public sheets are visible"
  on public.characters for select
  to anon, authenticated
  using (sheet_visibility = 'public');

grant select on public.characters to anon;

create policy "owners add characters"
  on public.characters for insert
  to authenticated
  with check (owner = (select auth.uid()));

create policy "owners edit their characters"
  on public.characters for update
  to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

create policy "owners delete their characters"
  on public.characters for delete
  to authenticated
  using (owner = (select auth.uid()));

grant select, insert, update, delete on public.characters to authenticated;

-- Keep updated_at current.
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger characters_touch
  before update on public.characters
  for each row execute function public.touch_updated_at();

-- 12 characters per player, enforced by the database.
create function public.limit_characters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.characters where owner = new.owner) >= 12 then
    raise exception 'You already have 12 characters. Delete one to make room.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger characters_limit
  before insert on public.characters
  for each row execute function public.limit_characters();

-- ADMIN PASSWORD RESET ------------------------------------------------
-- Only an admin account can run this. Sets a temporary password for a player.
create function public.admin_reset_password(target_username text, new_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Only an admin can reset passwords.' using errcode = '42501';
  end if;
  if char_length(new_password) < 8 then
    raise exception 'The temporary password needs at least 8 characters.' using errcode = 'P0001';
  end if;
  select id into target from public.profiles where username = target_username::extensions.citext;
  if target is null then
    raise exception 'No player has that username.' using errcode = 'P0001';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = target;
end;
$$;

revoke all on function public.admin_reset_password(text, text) from public, anon;
grant execute on function public.admin_reset_password(text, text) to authenticated;
