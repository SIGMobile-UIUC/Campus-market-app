-- DB-9: trades, trade items and confirmations; propose, accept (reserve all or none), decline, withdraw,
-- cancel, confirm and completion with counted flags; my_trades; leave_chat refuses while a trade is open
-- (spec 4.10, 5.2, 5.3.6, 6.6). Point awards (DB-12), penalties and rank marking (DB-11) hook into
-- private.complete_trade and cancel_trade when their tables arrive.

create type public.trade_status as enum ('proposed', 'accepted', 'disputed', 'completed',
                                         'declined', 'withdrawn', 'cancelled', 'expired', 'failed');

create table public.trades (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null unique,                  -- proposer's idempotency key
  listing_id    uuid not null references public.listings on delete restrict,
  chat_id       uuid not null references public.chats on delete restrict,
  seller_id     uuid not null references public.profiles,
  buyer_id      uuid not null references public.profiles,
  proposed_by   uuid not null references public.profiles,
  status        public.trade_status not null default 'proposed',
  total_cents   integer not null check (total_cents between 0 and 10000000),
  meet_at       timestamptz,
  spot_id       uuid references public.meetup_spots on delete set null,
  place_text    text check (char_length(place_text) <= 120),
  proposed_at   timestamptz not null default now(),
  accepted_at   timestamptz,
  completed_at  timestamptz,
  closed_at     timestamptz,
  next_check_at timestamptz,                           -- next automatic transition (DB-10)
  cancelled_by  uuid references public.profiles,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  counted_seller boolean not null default false,       -- set at completion (4.10.4)
  counted_buyer  boolean not null default false,
  check (seller_id <> buyer_id),
  check (proposed_by in (seller_id, buyer_id)),
  -- A deleted spot leaves the time; the place was checked when the trade was proposed.
  check (meet_at is not null)
);

alter table public.items
  add foreign key (reserved_trade_id) references public.trades on delete restrict;

create table public.trade_items (
  trade_id    uuid not null references public.trades on delete cascade,
  line        smallint not null,
  item_id     uuid references public.items on delete set null,   -- null for wanted-listing offers
  name        text not null check (char_length(name) between 1 and 80),
  price_cents integer not null check (price_cents between 0 and 10000000),
  primary key (trade_id, line)
);

create table public.trade_confirmations (
  trade_id     uuid not null references public.trades on delete cascade,
  user_id      uuid not null references public.profiles,
  confirmed_at timestamptz not null default now(),
  primary key (trade_id, user_id)
);

create index trades_due_idx on public.trades (status, next_check_at) where status in ('proposed', 'accepted');
create index trades_seller_completed_idx on public.trades (seller_id, completed_at);
create index trades_buyer_completed_idx on public.trades (buyer_id, completed_at);
create index trades_chat_idx on public.trades (chat_id);

-- Helpers ------------------------------------------------------------------------------------------

create function private.trade_json(p_trade_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select (to_jsonb(t) - 'request_id') || jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'trade_id' order by i.line) from public.trade_items i where i.trade_id = t.id), '[]'),
    'confirmed_by', coalesce((select jsonb_agg(c.user_id order by c.confirmed_at) from public.trade_confirmations c where c.trade_id = t.id), '[]'))
  from public.trades t
  where t.id = p_trade_id;
$$;

-- When the trades-advance job next looks at the trade (5.2): proposals expire after 48 hours; an
-- accepted trade completes 72 hours after the meetup once one side confirmed, or expires after 7 days.
create function private.next_check(p_trade_id uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case t.status
    when 'proposed' then t.proposed_at + interval '48 hours'
    when 'accepted' then t.meet_at + case when exists (select 1 from public.trade_confirmations c where c.trade_id = t.id)
                                          then interval '72 hours' else interval '7 days' end
  end
  from public.trades t
  where t.id = p_trade_id;
$$;

-- Locks the trade and returns it, or raises NOT_PARTY when it does not exist or the caller is not in it.
create function private.party_trade(p_trade_id uuid, p_uid uuid) returns public.trades
language plpgsql security definer set search_path = '' as $$
declare
  v_trade public.trades;
begin
  select * into v_trade from public.trades where id = p_trade_id for update;
  if not found or p_uid not in (v_trade.seller_id, v_trade.buyer_id) then
    raise exception using errcode = 'P0001', message = 'NOT_PARTY';
  end if;
  return v_trade;
end;
$$;

-- The trade card in the chat (4.9): one system message per step.
create function private.trade_event(p_trade_id uuid, p_actor uuid) returns void
language sql security definer set search_path = '' as $$
  select private.post_system_message(t.chat_id, jsonb_build_object('event', 'trade', 'trade_id', t.id, 'status', t.status), p_actor)
  from public.trades t
  where t.id = p_trade_id;
$$;

-- Completion in one transaction for both callers, confirm_trade and the job (4.10.4). The conditional
-- update lets only one caller complete. Returns false when the trade was no longer accepted.
create function private.complete_trade(p_trade_id uuid, p_actor uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_trade public.trades;
begin
  update public.trades set status = 'completed', completed_at = now(), closed_at = now(), next_check_at = null
  where id = p_trade_id and status = 'accepted'
  returning * into v_trade;
  if not found then
    return false;
  end if;

  update public.items set status = 'sold', sold_at = now(), reserved_trade_id = null where reserved_trade_id = p_trade_id;

  -- Counted flags: a price above 0 counts for both sides, a free trade for the giver, and a pair counts
  -- once per 7 days. The pair lock keeps two trades of one pair completing together from both counting.
  perform pg_advisory_xact_lock(hashtextextended(
    least(v_trade.seller_id, v_trade.buyer_id)::text || greatest(v_trade.seller_id, v_trade.buyer_id)::text, 0));
  if not exists (
    select 1 from public.trades t
    where least(t.seller_id, t.buyer_id) = least(v_trade.seller_id, v_trade.buyer_id)
      and greatest(t.seller_id, t.buyer_id) = greatest(v_trade.seller_id, v_trade.buyer_id)
      and t.id <> p_trade_id and t.status = 'completed' and (t.counted_seller or t.counted_buyer)
      and t.completed_at > now() - interval '7 days') then
    update public.trades set counted_seller = true, counted_buyer = total_cents > 0 where id = p_trade_id;
  end if;

  perform private.trade_event(p_trade_id, p_actor);
  return true;
end;
$$;

-- Triggers and row-level security -----------------------------------------------------------------

alter table public.trades              enable row level security;
alter table public.trade_items         enable row level security;
alter table public.trade_confirmations enable row level security;

create policy trades_select on public.trades for select to authenticated
using ((select auth.uid()) in (seller_id, buyer_id));
create policy trade_items_select on public.trade_items for select to authenticated
using (exists (select 1 from public.trades t where t.id = trade_id));
create policy trade_confirmations_select on public.trade_confirmations for select to authenticated
using (exists (select 1 from public.trades t where t.id = trade_id));

-- Functions ----------------------------------------------------------------------------------------

-- On sell listings the owner is the seller; on wanted listings the owner is the buyer. Proposals do not
-- reserve: several buyers can propose for one item and the first acceptance wins (4.10.1). Takes the chat
-- lock like send_message and leave_chat, so a proposal and a leave cannot cross.
create function public.propose_trade(p_chat_id uuid, p_proposal jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid         uuid := private.require_user();
  v_chat        public.chats;
  v_listing     public.listings;
  v_seller      uuid;
  v_buyer       uuid;
  v_meet        timestamptz;
  v_spot        uuid;
  v_place       text := nullif(btrim(p_proposal ->> 'place_text'), '');
  v_item_ids    uuid[];
  v_offers      jsonb := p_proposal -> 'offer_items';
  v_unavailable uuid[];
  v_id          uuid;
begin
  if p_request_id is null then
    perform private.fail('VALIDATION_FAILED', 'request_id');
  end if;
  v_chat := private.party_chat(p_chat_id, v_uid);
  select id into v_id from public.trades where request_id = p_request_id and proposed_by = v_uid;
  if found then
    return private.trade_json(v_id);
  end if;

  if v_chat.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  if (case when v_uid = v_chat.owner_id then v_chat.member_id else v_chat.owner_id end) = any (private.my_block_list()) then
    raise exception using errcode = 'P0001', message = 'BLOCKED';
  end if;
  select * into v_listing from public.listings where id = v_chat.listing_id;
  if v_listing.deleted_at is not null or v_listing.status = 'closed' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  if v_listing.kind = 'wanted' then
    v_seller := v_chat.member_id;
    v_buyer  := v_chat.owner_id;
  else
    v_seller := v_chat.owner_id;
    v_buyer  := v_chat.member_id;
  end if;
  if p_proposal ? 'role' and p_proposal ->> 'role' is distinct from (case when v_uid = v_seller then 'seller' else 'buyer' end) then
    perform private.fail('VALIDATION_FAILED', 'role');
  end if;

  if jsonb_typeof(p_proposal -> 'total_cents') is distinct from 'number'
     or (p_proposal ->> 'total_cents')::numeric not between 0 and 10000000
     or (p_proposal ->> 'total_cents')::numeric % 1 <> 0 then
    perform private.fail('VALIDATION_FAILED', 'total_cents');
  end if;
  begin
    v_meet := (p_proposal ->> 'meet_at')::timestamptz;
  exception when others then
    perform private.fail('VALIDATION_FAILED', 'meet_at');
  end;
  if v_meet is null or v_meet <= now() then
    perform private.fail('VALIDATION_FAILED', 'meet_at');
  end if;
  -- A spot of the listing's campus, or a typed place (the only choice for general users' listings).
  begin
    v_spot := (p_proposal ->> 'spot_id')::uuid;
  exception when others then
    perform private.fail('VALIDATION_FAILED', 'spot_id');
  end;
  if v_spot is not null and not exists (select 1 from public.meetup_spots s where s.id = v_spot and s.campus_id = v_listing.campus_id) then
    perform private.fail('VALIDATION_FAILED', 'spot_id');
  end if;
  if v_spot is null and v_place is null then
    perform private.fail('VALIDATION_FAILED', 'place_text');
  end if;
  if char_length(v_place) > 120 then
    perform private.fail('VALIDATION_FAILED', 'place_text');
  elsif private.prohibited_term(v_place) is not null then
    perform private.fail('PROHIBITED_CONTENT', 'place_text');
  end if;

  if v_listing.kind = 'wanted' then
    -- The responding seller describes what they offer; nothing is reserved.
    if jsonb_typeof(v_offers) is distinct from 'array' or jsonb_array_length(v_offers) not between 1 and 10
       or exists (select 1 from jsonb_array_elements(v_offers) o
                  where char_length(coalesce(o ->> 'name', '')) not between 1 and 80
                     or jsonb_typeof(o -> 'price_cents') is distinct from 'number'
                     or (o ->> 'price_cents')::numeric not between 0 and 10000000
                     or (o ->> 'price_cents')::numeric % 1 <> 0) then
      perform private.fail('VALIDATION_FAILED', 'offer_items');
    end if;
    if exists (select 1 from jsonb_array_elements(v_offers) o where private.prohibited_term(o ->> 'name') is not null) then
      perform private.fail('PROHIBITED_CONTENT', 'offer_items');
    end if;
  else
    begin
      v_item_ids := array(select distinct x::uuid from jsonb_array_elements_text(p_proposal -> 'item_ids') x);
    exception when others then
      perform private.fail('VALIDATION_FAILED', 'item_ids');
    end;
    if cardinality(v_item_ids) = 0 or cardinality(v_item_ids) <> jsonb_array_length(p_proposal -> 'item_ids')
       or (select count(*) from public.items where id = any (v_item_ids) and listing_id = v_listing.id) <> cardinality(v_item_ids) then
      perform private.fail('VALIDATION_FAILED', 'item_ids');
    end if;
    select array_agg(id) into v_unavailable from public.items where id = any (v_item_ids) and status <> 'available';
    if v_unavailable is not null then
      raise exception using errcode = 'P0001', message = 'ITEM_UNAVAILABLE',
        detail = json_build_object('item_ids', v_unavailable)::text;
    end if;
  end if;

  insert into public.trades (request_id, listing_id, chat_id, seller_id, buyer_id, proposed_by, total_cents, meet_at,
                             spot_id, place_text, next_check_at)
  values (p_request_id, v_listing.id, p_chat_id, v_seller, v_buyer, v_uid, (p_proposal ->> 'total_cents')::int, v_meet,
          v_spot, v_place, now() + interval '48 hours')
  returning id into v_id;

  -- Names and prices are copied, so later edits to the listing do not change the terms (4.7).
  if v_listing.kind = 'wanted' then
    insert into public.trade_items (trade_id, line, name, price_cents)
    select v_id, n, o ->> 'name', (o ->> 'price_cents')::int
    from jsonb_array_elements(v_offers) with ordinality as x(o, n);
  else
    insert into public.trade_items (trade_id, line, item_id, name, price_cents)
    select v_id, row_number() over (order by i.position), i.id, i.name, i.price_cents
    from public.items i where i.id = any (v_item_ids);
  end if;

  perform private.trade_event(v_id, v_uid);
  return private.trade_json(v_id);
end;
$$;

-- Reserves every item or none (4.10.1). A repeated tap returns the accepted trade.
create function public.accept_trade(p_trade_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := private.require_user();
  v_trade    public.trades := private.party_trade(p_trade_id, v_uid);
  v_reserved int;
begin
  if v_trade.status = 'accepted' then
    return private.trade_json(p_trade_id);
  elsif v_trade.status <> 'proposed' or v_trade.proposed_by = v_uid or v_trade.proposed_at + interval '48 hours' <= now() then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  if exists (select 1 from public.listings where id = v_trade.listing_id and (deleted_at is not null or status = 'closed')) then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;

  update public.items i
  set status = 'reserved', reserved_trade_id = p_trade_id
  from public.trade_items ti
  where ti.trade_id = p_trade_id and ti.item_id = i.id and i.status = 'available';
  get diagnostics v_reserved = row_count;
  if v_reserved <> (select count(*) from public.trade_items where trade_id = p_trade_id and item_id is not null) then
    -- Raising rolls back the partial reservation.
    raise exception using errcode = 'P0001', message = 'ITEM_UNAVAILABLE';
  end if;

  update public.trades set status = 'accepted', accepted_at = now() where id = p_trade_id;
  update public.trades set next_check_at = private.next_check(p_trade_id) where id = p_trade_id;
  perform private.trade_event(p_trade_id, v_uid);
  return private.trade_json(p_trade_id);
end;
$$;

create function public.decline_trade(p_trade_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user(true);
  v_trade public.trades := private.party_trade(p_trade_id, v_uid);
begin
  if v_trade.status = 'declined' then
    return private.trade_json(p_trade_id);
  elsif v_trade.status <> 'proposed' or v_trade.proposed_by = v_uid then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  update public.trades set status = 'declined', closed_at = now(), next_check_at = null where id = p_trade_id;
  perform private.trade_event(p_trade_id, v_uid);
  return private.trade_json(p_trade_id);
end;
$$;

create function public.withdraw_trade(p_trade_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user(true);
  v_trade public.trades := private.party_trade(p_trade_id, v_uid);
begin
  if v_trade.proposed_by <> v_uid then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  elsif v_trade.status = 'withdrawn' then
    return private.trade_json(p_trade_id);
  elsif v_trade.status <> 'proposed' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  update public.trades set status = 'withdrawn', closed_at = now(), next_check_at = null where id = p_trade_id;
  perform private.trade_event(p_trade_id, v_uid);
  return private.trade_json(p_trade_id);
end;
$$;

-- Releases the items. Cancelling later than 2 hours before the meetup is a late cancel for the
-- canceller (TRD-6); DB-11 records the penalty here. A repeated tap returns the same result.
create function public.cancel_trade(p_trade_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user(true);
  v_trade public.trades := private.party_trade(p_trade_id, v_uid);
begin
  if v_trade.status = 'cancelled' and v_trade.cancelled_by = v_uid then
    return jsonb_build_object('trade', private.trade_json(p_trade_id),
                              'late_cancel_penalty', v_trade.closed_at > v_trade.meet_at - interval '2 hours');
  elsif v_trade.status <> 'accepted' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  if char_length(coalesce(btrim(p_reason), '')) not between 1 and 500 then
    perform private.fail('VALIDATION_FAILED', 'reason');
  end if;

  update public.items set status = 'available', reserved_trade_id = null where reserved_trade_id = p_trade_id;
  update public.trades set status = 'cancelled', closed_at = now(), next_check_at = null, cancelled_by = v_uid,
                           cancel_reason = btrim(p_reason)
  where id = p_trade_id;
  perform private.trade_event(p_trade_id, v_uid);
  return jsonb_build_object('trade', private.trade_json(p_trade_id),
                            'late_cancel_penalty', now() > v_trade.meet_at - interval '2 hours');
end;
$$;

-- Both sides tap Completed (TRD-4), from 30 minutes before the meetup until the trade would expire.
-- The second confirmation completes the trade. points_awarded stays 0 until DB-12.
create function public.confirm_trade(p_trade_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user();
  v_trade     public.trades := private.party_trade(p_trade_id, v_uid);
  v_completed boolean := false;
begin
  if v_trade.status = 'completed' then
    return jsonb_build_object('trade', private.trade_json(p_trade_id), 'completed', true, 'points_awarded', 0);
  elsif v_trade.status <> 'accepted' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  elsif now() < v_trade.meet_at - interval '30 minutes' or now() > v_trade.meet_at + interval '7 days' then
    raise exception using errcode = 'P0001', message = 'WINDOW_CLOSED';
  end if;

  insert into public.trade_confirmations (trade_id, user_id) values (p_trade_id, v_uid) on conflict do nothing;
  if found then
    if (select count(*) from public.trade_confirmations where trade_id = p_trade_id) = 2 then
      v_completed := private.complete_trade(p_trade_id, v_uid);
    else
      update public.trades set next_check_at = private.next_check(p_trade_id) where id = p_trade_id;
      perform private.post_system_message(v_trade.chat_id,
        jsonb_build_object('event', 'trade', 'trade_id', p_trade_id, 'status', 'confirmed', 'user_id', v_uid), v_uid);
    end if;
  end if;
  return jsonb_build_object('trade', private.trade_json(p_trade_id), 'completed', v_completed, 'points_awarded', 0);
end;
$$;

-- Trade history (TRD-9), newest proposal first; the cursor is the last row's {proposed_at, id}.
create function public.my_trades(p_status_group text, p_cursor jsonb default null, p_limit int default 20)
returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_statuses public.trade_status[] := case p_status_group
    when 'active'    then array['proposed', 'accepted', 'disputed']::public.trade_status[]
    when 'completed' then array['completed']::public.trade_status[]
    when 'closed'    then array['declined', 'withdrawn', 'cancelled', 'expired', 'failed']::public.trade_status[]
  end;
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_rows  jsonb;
begin
  if v_statuses is null then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field": "status_group"}';
  end if;
  select coalesce(jsonb_agg(x.r order by x.proposed_at desc, x.id desc), '[]') into v_rows
  from (
    select t.proposed_at, t.id, (to_jsonb(t) - 'request_id') || jsonb_build_object(
      'items', (select jsonb_agg(to_jsonb(i) - 'trade_id' order by i.line) from public.trade_items i where i.trade_id = t.id),
      'listing', (select jsonb_build_object('id', l.id, 'title', l.title, 'kind', l.kind) from public.listings l where l.id = t.listing_id),
      'partner', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'tier', p.tier)
                  from public.profiles p where p.id = case when t.seller_id = (select auth.uid()) then t.buyer_id else t.seller_id end)) as r
    from public.trades t
    where t.status = any (v_statuses)
      and (p_cursor is null or (t.proposed_at, t.id) < ((p_cursor ->> 'proposed_at')::timestamptz, (p_cursor ->> 'id')::uuid))
    order by t.proposed_at desc, t.id desc
    limit v_limit
  ) x;
  return jsonb_build_object('rows', v_rows, 'next_cursor', case when jsonb_array_length(v_rows) = v_limit then
    jsonb_build_object('proposed_at', v_rows -> -1 -> 'proposed_at', 'id', v_rows -> -1 -> 'id') end);
end;
$$;

-- CHT-7: leaving is refused while a trade in the chat is proposed, accepted or disputed (replaces DB-8).
create or replace function public.leave_chat(p_chat_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user(true);
  v_chat public.chats := private.party_chat(p_chat_id, v_uid);
begin
  if exists (select 1 from public.trades where chat_id = p_chat_id and status in ('proposed', 'accepted', 'disputed')) then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
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

-- Grants -------------------------------------------------------------------------------------------

revoke execute on function
  private.trade_json(uuid), private.next_check(uuid), private.party_trade(uuid, uuid), private.trade_event(uuid, uuid),
  private.complete_trade(uuid, uuid)
from public, anon, authenticated;

revoke execute on function
  public.propose_trade(uuid, jsonb, uuid), public.accept_trade(uuid), public.decline_trade(uuid),
  public.withdraw_trade(uuid), public.cancel_trade(uuid, text), public.confirm_trade(uuid),
  public.my_trades(text, jsonb, int)
from public, anon;
grant execute on function
  public.propose_trade(uuid, jsonb, uuid), public.accept_trade(uuid), public.decline_trade(uuid),
  public.withdraw_trade(uuid), public.cancel_trade(uuid, text), public.confirm_trade(uuid),
  public.my_trades(text, jsonb, int)
to authenticated;
