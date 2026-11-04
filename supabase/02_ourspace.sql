-- Jimothy's D10 Isekai JRPG: OurSpace (pages, friends, Top 8, blogs, PMs)
-- Run once in the Supabase SQL Editor, after 01_accounts_and_characters.sql.

-- FRIENDS -------------------------------------------------------------
-- A request goes from requester to addressee. It counts once accepted.
create table public.friendships (
  requester  uuid not null references public.profiles (id) on delete cascade,
  addressee  uuid not null references public.profiles (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
create index friendships_addressee_idx on public.friendships (addressee);

alter table public.friendships enable row level security;

create function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
     where status = 'accepted'
       and ((requester = a and addressee = b) or (requester = b and addressee = a))
  );
$$;

-- Friend lists are public (a Top 8 is only drawn from friends), requests are not
create policy "accepted friendships are public"
  on public.friendships for select
  to anon, authenticated
  using (status = 'accepted' or requester = (select auth.uid()) or addressee = (select auth.uid()));

create policy "send a friend request"
  on public.friendships for insert
  to authenticated
  with check (requester = (select auth.uid()) and status = 'pending');

create policy "accept a friend request"
  on public.friendships for update
  to authenticated
  using (addressee = (select auth.uid()))
  with check (addressee = (select auth.uid()) and status = 'accepted');

create policy "remove a friend or a request"
  on public.friendships for delete
  to authenticated
  using (requester = (select auth.uid()) or addressee = (select auth.uid()));

grant select on public.friendships to anon;
grant select, insert, update, delete on public.friendships to authenticated;

-- Friends can see a character sheet set to Friends
create policy "friends see friends-only sheets"
  on public.characters for select
  to authenticated
  using (sheet_visibility = 'friends' and public.are_friends(owner, (select auth.uid())));

-- PLAYER PAGES --------------------------------------------------------
create table public.player_pages (
  id           uuid primary key references public.profiles (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  tagline      text not null default '' check (char_length(tagline) <= 120),
  mood         text not null default '' check (char_length(mood) <= 40),
  status       text not null default '' check (char_length(status) <= 140),
  pic_url      text not null default '' check (pic_url = '' or (pic_url ~ '^https://' and char_length(pic_url) <= 500)),
  about        text not null default '' check (char_length(about) <= 4000),
  who_to_meet  text not null default '' check (char_length(who_to_meet) <= 2000),
  interests    jsonb not null default '{}'::jsonb,
  top8         jsonb not null default '[]'::jsonb,
  theme        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.player_pages enable row level security;

create policy "player pages are public"
  on public.player_pages for select
  to anon, authenticated
  using (true);

create policy "players make their page"
  on public.player_pages for insert
  to authenticated
  with check (id = (select auth.uid()));

create policy "players edit their page"
  on public.player_pages for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant select on public.player_pages to anon;
grant select, insert, update on public.player_pages to authenticated;

create trigger player_pages_touch
  before update on public.player_pages
  for each row execute function public.touch_updated_at();

-- Every account gets a page, including accounts made before OurSpace
create function public.handle_new_profile_page()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.player_pages (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile_page();

insert into public.player_pages (id) select id from public.profiles on conflict do nothing;

-- CHARACTER PAGES -----------------------------------------------------
-- The page is public; the stats stay in characters.sheet behind its own rules.
create table public.character_pages (
  id           uuid primary key references public.characters (id) on delete cascade,
  owner        uuid not null references public.profiles (id) on delete cascade,
  name         text not null default '',
  tagline      text not null default '' check (char_length(tagline) <= 120),
  mood         text not null default '' check (char_length(mood) <= 40),
  status       text not null default '' check (char_length(status) <= 140),
  pic_url      text not null default '' check (pic_url = '' or (pic_url ~ '^https://' and char_length(pic_url) <= 500)),
  about        text not null default '' check (char_length(about) <= 4000),
  details      jsonb not null default '{}'::jsonb,
  top8         jsonb not null default '[]'::jsonb,
  theme        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);
create index character_pages_owner_idx on public.character_pages (owner);

alter table public.character_pages enable row level security;

create policy "character pages are public"
  on public.character_pages for select
  to anon, authenticated
  using (true);

create policy "owners edit their character pages"
  on public.character_pages for update
  to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

grant select on public.character_pages to anon;
grant select, update on public.character_pages to authenticated;

create trigger character_pages_touch
  before update on public.character_pages
  for each row execute function public.touch_updated_at();

-- Keep each character's page and name in step with the character
create function public.sync_character_page()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.character_pages (id, owner, name) values (new.id, new.owner, new.name)
  on conflict (id) do update set name = excluded.name, owner = excluded.owner;
  return new;
end;
$$;

create trigger characters_page_sync
  after insert or update of name, owner on public.characters
  for each row execute function public.sync_character_page();

insert into public.character_pages (id, owner, name) select id, owner, name from public.characters on conflict do nothing;

-- Owners can't change a page's owner or name by hand
create function public.lock_character_page()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    new.owner = old.owner;
    new.name = old.name;
  end if;
  return new;
end;
$$;

create trigger character_pages_lock
  before update on public.character_pages
  for each row execute function public.lock_character_page();

-- BLOG POSTS ----------------------------------------------------------
-- Written by a player, on their own page or on one of their characters' pages
create table public.posts (
  id           uuid primary key default gen_random_uuid(),
  author       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  character_id uuid references public.characters (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  body         text not null check (char_length(body) between 1 and 10000),
  visibility   text not null default 'public' check (visibility in ('public', 'friends', 'private')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index posts_author_idx on public.posts (author, created_at desc);
create index posts_character_idx on public.posts (character_id, created_at desc);

alter table public.posts enable row level security;

create policy "read posts you are allowed to see"
  on public.posts for select
  to anon, authenticated
  using (visibility = 'public'
         or author = (select auth.uid())
         or (visibility = 'friends' and public.are_friends(author, (select auth.uid())))
         or (select public.is_admin()));

create policy "write your own posts"
  on public.posts for insert
  to authenticated
  with check (author = (select auth.uid())
              and (character_id is null
                   or exists (select 1 from public.characters c where c.id = character_id and c.owner = (select auth.uid()))));

create policy "edit your own posts"
  on public.posts for update
  to authenticated
  using (author = (select auth.uid()))
  with check (author = (select auth.uid())
              and (character_id is null
                   or exists (select 1 from public.characters c where c.id = character_id and c.owner = (select auth.uid()))));

create policy "delete your own posts"
  on public.posts for delete
  to authenticated
  using (author = (select auth.uid()));

grant select on public.posts to anon;
grant select, insert, update, delete on public.posts to authenticated;

create trigger posts_touch
  before update on public.posts
  for each row execute function public.touch_updated_at();

-- PRIVATE MESSAGES ----------------------------------------------------
-- Between friends. Either side can be the player or one of their characters.
create table public.messages (
  id                  uuid primary key default gen_random_uuid(),
  sender              uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  sender_character    uuid references public.characters (id) on delete set null,
  recipient           uuid not null references public.profiles (id) on delete cascade,
  recipient_character uuid references public.characters (id) on delete set null,
  subject             text not null default '' check (char_length(subject) <= 120),
  body                text not null check (char_length(body) between 1 and 5000),
  created_at          timestamptz not null default now(),
  read_at             timestamptz,
  hidden_by_sender    boolean not null default false,
  hidden_by_recipient boolean not null default false
);
create index messages_recipient_idx on public.messages (recipient, created_at desc);
create index messages_sender_idx on public.messages (sender, created_at desc);

alter table public.messages enable row level security;

create policy "read your own messages"
  on public.messages for select
  to authenticated
  using (sender = (select auth.uid()) or recipient = (select auth.uid()));

create policy "message a friend"
  on public.messages for insert
  to authenticated
  with check (sender = (select auth.uid())
              and public.are_friends(sender, recipient)
              and (sender_character is null
                   or exists (select 1 from public.characters c where c.id = sender_character and c.owner = sender))
              and (recipient_character is null
                   or exists (select 1 from public.character_pages p where p.id = recipient_character and p.owner = recipient)));

create policy "mark read or hide your messages"
  on public.messages for update
  to authenticated
  using (sender = (select auth.uid()) or recipient = (select auth.uid()))
  with check (sender = (select auth.uid()) or recipient = (select auth.uid()));

grant select, insert, update on public.messages to authenticated;

-- Only read_at and the hidden flags can change, and only by the right side
create function public.lock_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sender is distinct from old.sender or new.recipient is distinct from old.recipient
     or new.body is distinct from old.body or new.subject is distinct from old.subject
     or new.sender_character is distinct from old.sender_character
     or new.recipient_character is distinct from old.recipient_character
     or new.created_at is distinct from old.created_at then
    raise exception 'Messages cannot be edited.' using errcode = '42501';
  end if;
  if auth.uid() <> old.recipient then
    new.read_at = old.read_at;
    new.hidden_by_recipient = old.hidden_by_recipient;
  end if;
  if auth.uid() <> old.sender then
    new.hidden_by_sender = old.hidden_by_sender;
  end if;
  return new;
end;
$$;

create trigger messages_lock
  before update on public.messages
  for each row execute function public.lock_message();
