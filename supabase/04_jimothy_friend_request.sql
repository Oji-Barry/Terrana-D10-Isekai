-- Jimothy's D10 Isekai JRPG: every new player gets a friend request from Jimothy
-- Run once in the Supabase SQL Editor, after 02_ourspace.sql.
-- The request comes from the account named in welcome_username() below.

create function public.welcome_username()
returns text
language sql
immutable
as $$ select 'Jimothy' $$;

create function public.welcome_friend_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  host uuid;
begin
  select id into host from public.profiles where username = public.welcome_username()::extensions.citext;
  if host is not null and host <> new.id then
    insert into public.friendships (requester, addressee, status)
    values (host, new.id, 'pending')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger on_profile_welcome
  after insert on public.profiles
  for each row execute function public.welcome_friend_request();

-- Players who signed up before this: send them a request too,
-- unless they are already friends or already have a request either way
insert into public.friendships (requester, addressee, status)
select h.id, p.id, 'pending'
  from public.profiles p
  cross join (select id from public.profiles where username = public.welcome_username()::extensions.citext) h
 where p.id <> h.id
   and not exists (select 1 from public.friendships f
                    where (f.requester = h.id and f.addressee = p.id)
                       or (f.requester = p.id and f.addressee = h.id))
on conflict do nothing;
