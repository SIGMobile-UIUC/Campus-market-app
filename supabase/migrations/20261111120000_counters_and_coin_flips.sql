-- Counter offers (TRD-2) and coin flips in chat (CHT-9).

-- A counter offer declines a proposal and proposes new terms in the same chat, in one transaction. A
-- retry with the same request id returns the counter offer it already made.
create function public.counter_trade(p_trade_id uuid, p_proposal jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_chat uuid := (select chat_id from public.trades where id = p_trade_id);
begin
  if not exists (select 1 from public.trades where request_id = p_request_id and proposed_by = v_uid) then
    perform public.decline_trade(p_trade_id);
  end if;
  return public.propose_trade(v_chat, p_proposal, p_request_id);
end;
$$;

-- Either side proposes a flip; the other side calls heads or tails and the server flips. Each step posts
-- a system message that carries the whole state, so the chat shows the flip without another query.
create table public.coin_flips (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats on delete cascade,
  proposed_by uuid not null references public.profiles,
  status      text not null default 'proposed' check (status in ('proposed', 'flipped', 'cancelled')),
  call        text check (call in ('heads', 'tails')),
  result      text check (result in ('heads', 'tails')),
  created_at  timestamptz not null default now(),
  flipped_at  timestamptz,
  check ((status = 'flipped') = (call is not null and result is not null))
);
-- One open flip per chat.
create unique index coin_flips_open on public.coin_flips (chat_id) where status = 'proposed';
-- Read through chat messages only.
alter table public.coin_flips enable row level security;

create function public.propose_coin_flip(p_chat_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_chat public.chats := private.party_chat(p_chat_id, v_uid);
  v_id   uuid;
begin
  if v_chat.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  if (case when v_uid = v_chat.owner_id then v_chat.member_id else v_chat.owner_id end) = any (private.my_block_list()) then
    raise exception using errcode = 'P0001', message = 'BLOCKED';
  end if;
  select id into v_id from public.coin_flips where chat_id = p_chat_id and status = 'proposed';
  if found then
    return v_id;
  end if;
  insert into public.coin_flips (chat_id, proposed_by) values (p_chat_id, v_uid) returning id into v_id;
  perform private.post_system_message(p_chat_id,
    jsonb_build_object('event', 'coin_flip', 'flip_id', v_id, 'status', 'proposed', 'user_id', v_uid), v_uid);
  return v_id;
end;
$$;

-- The side that did not propose calls it; returns the result.
create function public.call_coin_flip(p_flip_id uuid, p_call text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_user();
  v_chat   public.chats := private.party_chat((select chat_id from public.coin_flips where id = p_flip_id), v_uid);
  v_flip   public.coin_flips;
  v_result text := case when random() < 0.5 then 'heads' else 'tails' end;
begin
  select * into v_flip from public.coin_flips where id = p_flip_id for update;
  if v_flip.status <> 'proposed' or v_flip.proposed_by = v_uid or v_chat.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  if p_call is null or p_call not in ('heads', 'tails') then
    perform private.fail('VALIDATION_FAILED', 'call');
  end if;
  update public.coin_flips set status = 'flipped', call = p_call, result = v_result, flipped_at = now()
  where id = p_flip_id;
  perform private.post_system_message(v_chat.id,
    jsonb_build_object('event', 'coin_flip', 'flip_id', p_flip_id, 'status', 'flipped', 'user_id', v_uid,
                       'call', p_call, 'result', v_result), v_uid);
  return v_result;
end;
$$;

-- The proposer takes back a flip nobody called yet.
create function public.cancel_coin_flip(p_flip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_chat public.chats := private.party_chat((select chat_id from public.coin_flips where id = p_flip_id), v_uid);
begin
  update public.coin_flips set status = 'cancelled'
  where id = p_flip_id and status = 'proposed' and proposed_by = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  perform private.post_system_message(v_chat.id,
    jsonb_build_object('event', 'coin_flip', 'flip_id', p_flip_id, 'status', 'cancelled', 'user_id', v_uid), v_uid);
end;
$$;

revoke execute on function public.counter_trade(uuid, jsonb, uuid), public.propose_coin_flip(uuid),
  public.call_coin_flip(uuid, text), public.cancel_coin_flip(uuid) from public, anon;
grant execute on function public.counter_trade(uuid, jsonb, uuid), public.propose_coin_flip(uuid),
  public.call_coin_flip(uuid, text), public.cancel_coin_flip(uuid) to authenticated;
