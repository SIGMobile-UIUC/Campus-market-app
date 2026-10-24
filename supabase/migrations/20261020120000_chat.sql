-- DB-8: chats, messages and read state; get_or_create_chat, send_message, get_messages, mark_read,
-- set_chat_muted, leave_chat and unread_summary; Broadcast delivery and its realtime.messages policy;
-- the chat-images bucket (spec 4.9, 5.3.5, 6.5).

create type public.message_kind as enum ('text', 'image', 'system');

create table public.chats (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.listings on delete restrict,
  owner_id        uuid not null references public.profiles,      -- the listing owner
  member_id       uuid not null references public.profiles,      -- the person who opened the chat
  last_seq        bigint not null default 0,
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,                         -- first side left; no new messages
  purge_after     timestamptz,                         -- both sides left: closed_at of the second + 7 days
  purged_at       timestamptz,                         -- messages and photos deleted
  check (owner_id <> member_id)
);
create unique index chats_open_pair_idx on public.chats (listing_id, member_id) where closed_at is null;

create table public.messages (
  chat_id    uuid not null references public.chats on delete cascade,
  seq        bigint not null,
  sender_id  uuid references public.profiles,          -- null for system messages
  kind       public.message_kind not null,
  body       text check (char_length(body) <= 2000),
  image_path text,                                     -- cleared when the photo expires
  meta       jsonb,                                    -- system cards: trade id, event
  client_id  uuid not null,
  created_at timestamptz not null default now(),
  primary key (chat_id, seq),
  unique (chat_id, client_id),
  check ((kind = 'system') = (sender_id is null))
);

create table public.chat_reads (
  chat_id       uuid not null references public.chats on delete cascade,
  user_id       uuid not null references public.profiles on delete cascade,
  last_read_seq bigint not null default 0,
  muted         boolean not null default false,
  left_at       timestamptz,
  primary key (chat_id, user_id)
);

create index chat_reads_user_idx on public.chat_reads (user_id);
create index messages_sender_created_idx on public.messages (sender_id, created_at);

-- Helpers ------------------------------------------------------------------------------------------

-- Takes text so policies can pass a topic or folder name; anything that is not a uuid is not a chat.
create function private.is_chat_party(p_chat_id text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_chat_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (select 1 from public.chats c where c.id = p_chat_id::uuid and auth.uid() in (c.owner_id, c.member_id));
end;
$$;

-- Private Broadcast topics (4.9): user:{own id}, and chat:{id} for the two parties.
create function private.can_join_topic(p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_topic = 'user:' || auth.uid()
      or (p_topic like 'chat:%' and private.is_chat_party(substr(p_topic, 6)));
$$;

-- Appends a system message (trade cards, "left the chat"); the update holds the chat row lock until
-- commit, like send_message. The actor's own event does not count as unread for them.
create function private.post_system_message(p_chat_id uuid, p_meta jsonb, p_actor uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_seq bigint;
begin
  update public.chats set last_seq = last_seq + 1, last_message_at = now() where id = p_chat_id
  returning last_seq into v_seq;
  insert into public.messages (chat_id, seq, kind, meta, client_id)
  values (p_chat_id, v_seq, 'system', p_meta, gen_random_uuid());
  update public.chat_reads set last_read_seq = v_seq where chat_id = p_chat_id and user_id = p_actor;
  return v_seq;
end;
$$;

-- Locks the chat and returns it, or raises NOT_PARTY when it does not exist or the caller is not in it.
create function private.party_chat(p_chat_id uuid, p_uid uuid) returns public.chats
language plpgsql security definer set search_path = '' as $$
declare
  v_chat public.chats;
begin
  select * into v_chat from public.chats where id = p_chat_id for update;
  if not found or p_uid not in (v_chat.owner_id, v_chat.member_id) then
    raise exception using errcode = 'P0001', message = 'NOT_PARTY';
  end if;
  return v_chat;
end;
$$;

-- Delivery (4.9): the new message to chat:{id}, and a badge event to both users' topics.
-- realtime.send rows commit with the message and are dropped with it on rollback.
create function private.messages_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner  uuid;
  v_member uuid;
begin
  perform realtime.broadcast_changes('chat:' || new.chat_id, 'message', tg_op, tg_table_name, tg_table_schema, new, old);
  select owner_id, member_id into v_owner, v_member from public.chats where id = new.chat_id;
  perform realtime.send(jsonb_build_object('chat_id', new.chat_id, 'seq', new.seq), 'badge', 'user:' || v_owner, true);
  perform realtime.send(jsonb_build_object('chat_id', new.chat_id, 'seq', new.seq), 'badge', 'user:' || v_member, true);
  return null;
end;
$$;

create trigger messages_broadcast after insert on public.messages
for each row execute function private.messages_broadcast();

-- Row-level security -------------------------------------------------------------------------------
-- No write policies: every write goes through the functions below.

alter table public.chats      enable row level security;
alter table public.messages   enable row level security;
alter table public.chat_reads enable row level security;

create policy chats_select on public.chats for select to authenticated
using ((select auth.uid()) in (owner_id, member_id));

-- Messages and read state follow their chat; the subquery applies the chats policy. Both parties see
-- both read rows for read receipts. ponytail: that includes the other side's muted flag; move muted to
-- its own table if that matters.
create policy messages_select on public.messages for select to authenticated
using (exists (select 1 from public.chats c where c.id = chat_id));
create policy chat_reads_select on public.chat_reads for select to authenticated
using (exists (select 1 from public.chats c where c.id = chat_id));

-- Clients may receive on their own topics; they cannot send, so every message goes through send_message.
create policy chat_topics_receive on realtime.messages for select to authenticated
using ((select private.can_join_topic((select realtime.topic()))) and extension = 'broadcast');

-- Chat photos: private, the same formats and size as listing photos. A party uploads under
-- {chat_id}/{own id}/ and both parties read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 409600, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

create policy chat_images_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-images'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and private.is_chat_party((storage.foldername(name))[1])
);

create policy chat_images_read on storage.objects for select to authenticated
using (bucket_id = 'chat-images' and private.is_chat_party((storage.foldername(name))[1]));

-- Functions ----------------------------------------------------------------------------------------

-- One open chat per listing and person (CHT-1). A double tap returns the same chat; after the
-- previous chat was closed, a new one starts.
create function public.get_or_create_chat(p_listing_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_listing public.listings;
  v_id      uuid;
begin
  -- The listings policy, applied by hand since this function bypasses RLS.
  select * into v_listing from public.listings l
  where l.id = p_listing_id and l.deleted_at is null and not l.hidden
    and (l.visibility = 'open' or l.campus_id = private.my_live_campus_id());
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if v_listing.owner_id = v_uid then
    raise exception using errcode = 'P0001', message = 'SELF_ACTION';
  end if;
  if v_listing.owner_id = any (private.my_block_list()) then
    raise exception using errcode = 'P0001', message = 'BLOCKED';
  end if;

  select id into v_id from public.chats where listing_id = p_listing_id and member_id = v_uid and closed_at is null;
  if found then
    return jsonb_build_object('chat_id', v_id, 'created', false);
  end if;
  if v_listing.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;

  insert into public.chats (listing_id, owner_id, member_id) values (p_listing_id, v_listing.owner_id, v_uid)
  on conflict (listing_id, member_id) where closed_at is null do nothing
  returning id into v_id;
  if v_id is null then
    -- A concurrent call created it first.
    select id into v_id from public.chats where listing_id = p_listing_id and member_id = v_uid and closed_at is null;
    return jsonb_build_object('chat_id', v_id, 'created', false);
  end if;
  insert into public.chat_reads (chat_id, user_id) values (v_id, v_listing.owner_id), (v_id, v_uid);
  return jsonb_build_object('chat_id', v_id, 'created', true);
end;
$$;

-- The chat row lock orders messages: seq order is commit order within a chat (4.9). A retry with the
-- same client_id returns the stored message.
create function public.send_message(p_chat_id uuid, p_kind text, p_body text, p_image_path text, p_client_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_chat    public.chats := private.party_chat(p_chat_id, v_uid);
  v_seq     bigint;
  v_created timestamptz;
begin
  if p_client_id is null then
    perform private.fail('VALIDATION_FAILED', 'client_id');
  end if;
  select seq, created_at into v_seq, v_created from public.messages where chat_id = p_chat_id and client_id = p_client_id;
  if found then
    return jsonb_build_object('seq', v_seq, 'created_at', v_created);
  end if;

  if v_chat.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  if (case when v_uid = v_chat.owner_id then v_chat.member_id else v_chat.owner_id end) = any (private.my_block_list()) then
    raise exception using errcode = 'P0001', message = 'BLOCKED';
  end if;

  if coalesce(p_kind, '') not in ('text', 'image') then
    perform private.fail('VALIDATION_FAILED', 'kind');
  end if;
  if char_length(p_body) > 2000 or (p_kind = 'text' and coalesce(btrim(p_body), '') = '') then
    perform private.fail('VALIDATION_FAILED', 'body');
  end if;
  if (p_kind = 'text' and p_image_path is not null)
     or (p_kind = 'image' and coalesce(p_image_path, '') not like p_chat_id || '/' || v_uid || '/%') then
    perform private.fail('VALIDATION_FAILED', 'image_path');
  end if;
  if private.prohibited_term(p_body) is not null then
    perform private.fail('PROHIBITED_CONTENT', 'body');
  end if;
  if (select count(*) from public.messages where sender_id = v_uid and created_at > now() - interval '10 seconds') >= 10 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;

  update public.chats set last_seq = last_seq + 1, last_message_at = now() where id = p_chat_id
  returning last_seq into v_seq;
  insert into public.messages (chat_id, seq, sender_id, kind, body, image_path, client_id)
  values (p_chat_id, v_seq, v_uid, p_kind::public.message_kind, p_body, p_image_path, p_client_id)
  returning created_at into v_created;
  update public.chat_reads set last_read_seq = v_seq where chat_id = p_chat_id and user_id = v_uid;
  return jsonb_build_object('seq', v_seq, 'created_at', v_created);
end;
$$;

-- After after_seq, oldest first (gap fill); otherwise the latest before before_seq (history). Either
-- way the page comes back in seq order.
create function public.get_messages(p_chat_id uuid, p_after_seq bigint default null, p_before_seq bigint default null,
                                    p_limit int default 50)
returns setof public.messages
language plpgsql stable set search_path = '' as $$
begin
  if not exists (select 1 from public.chats where id = p_chat_id) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  return query
    select * from (
      select m.* from public.messages m
      where m.chat_id = p_chat_id
        and m.seq > coalesce(p_after_seq, 0)
        and m.seq < coalesce(p_before_seq, 9223372036854775807)
      order by case when p_after_seq is not null then m.seq end, m.seq desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) page
    order by page.seq;
end;
$$;

-- Moves the caller's marker forward only, never past the last message, and tells the other side
-- (read receipts) when it moved.
create function public.mark_read(p_chat_id uuid, p_seq bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(true);
  v_seq bigint;
begin
  update public.chat_reads r set last_read_seq = least(p_seq, c.last_seq)
  from public.chats c
  where r.chat_id = p_chat_id and r.user_id = v_uid and c.id = r.chat_id and r.last_read_seq < least(p_seq, c.last_seq)
  returning r.last_read_seq into v_seq;
  if found then
    perform realtime.send(jsonb_build_object('user_id', v_uid, 'seq', v_seq), 'read', 'chat:' || p_chat_id, true);
  else
    select last_read_seq into v_seq from public.chat_reads where chat_id = p_chat_id and user_id = v_uid;
    if not found then
      raise exception using errcode = 'P0001', message = 'NOT_PARTY';
    end if;
  end if;
  return jsonb_build_object('last_read_seq', v_seq);
end;
$$;

create function public.set_chat_muted(p_chat_id uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(true);
begin
  update public.chat_reads set muted = coalesce(p_muted, false) where chat_id = p_chat_id and user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_PARTY';
  end if;
end;
$$;

-- CHT-7: the first leave closes the chat for both sides; the second sets the purge date (CHT-8).
-- Leaving again returns the current state. DB-9 adds the refusal while a trade in the chat is open.
create function public.leave_chat(p_chat_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user(true);
  v_chat public.chats := private.party_chat(p_chat_id, v_uid);
begin
  update public.chat_reads set left_at = now() where chat_id = p_chat_id and user_id = v_uid and left_at is null;
  if found then
    if v_chat.closed_at is null then
      perform private.post_system_message(p_chat_id, jsonb_build_object('event', 'left', 'user_id', v_uid), v_uid);
      update public.chats set closed_at = now() where id = p_chat_id;
    else
      update public.chats set purge_after = now() + interval '7 days' where id = p_chat_id;
    end if;
  end if;
  return (select jsonb_build_object('closed_at', closed_at, 'purge_after', purge_after) from public.chats where id = p_chat_id);
end;
$$;

-- Open chats only; a chat the caller left no longer counts.
create function public.unread_summary() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'total', coalesce(sum(u.unread), 0),
    'chats', coalesce(jsonb_agg(jsonb_build_object('chat_id', u.chat_id, 'unread', u.unread)), '[]'))
  from (
    select c.id as chat_id, c.last_seq - r.last_read_seq as unread
    from public.chat_reads r
    join public.chats c on c.id = r.chat_id
    where r.user_id = (select auth.uid()) and r.left_at is null and c.last_seq > r.last_read_seq
  ) u;
$$;

-- Grants -------------------------------------------------------------------------------------------

revoke execute on function
  private.is_chat_party(text), private.can_join_topic(text), private.post_system_message(uuid, jsonb, uuid),
  private.party_chat(uuid, uuid), private.messages_broadcast()
from public, anon, authenticated;
grant execute on function private.is_chat_party(text), private.can_join_topic(text) to authenticated;

revoke execute on function
  public.get_or_create_chat(uuid), public.send_message(uuid, text, text, text, uuid),
  public.get_messages(uuid, bigint, bigint, int), public.mark_read(uuid, bigint), public.set_chat_muted(uuid, boolean),
  public.leave_chat(uuid), public.unread_summary()
from public, anon;
grant execute on function
  public.get_or_create_chat(uuid), public.send_message(uuid, text, text, text, uuid),
  public.get_messages(uuid, bigint, bigint, int), public.mark_read(uuid, bigint), public.set_chat_muted(uuid, boolean),
  public.leave_chat(uuid), public.unread_summary()
to authenticated;
