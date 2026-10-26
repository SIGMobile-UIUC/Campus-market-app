-- FN-1: push notifications (CHT-5, spec 4.16, 5.3.11). Tokens, the notifications log, and sending
-- from the database: triggers on messages, trades, confirmations and reviews call the Expo push API
-- through pg_net, which sends only after commit, so a rolled-back change never notifies. The
-- push-receipts job reads Expo's tickets and receipts and drops tokens of uninstalled apps.

create extension if not exists pg_net;

create table public.push_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);

create table private.push_tickets (
  ticket_id    text primary key,
  token        text not null,
  created_at   timestamptz not null default now(),
  requested_at timestamptz                       -- when its receipt was asked for
);

-- Sends and receipt checks waiting for Expo's answer (net._http_response). For a send, tokens lists
-- each message's token in order; for a receipt check, tickets lists the tickets asked about.
create table private.push_requests (
  request_id bigint primary key,
  kind       text not null check (kind in ('send', 'receipts')),
  tokens     text[],
  tickets    text[],
  created_at timestamptz not null default now()
);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  type       text not null,
  payload    jsonb not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);
create index notifications_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;

alter table public.push_tokens   enable row level security;
alter table public.notifications enable row level security;
create policy push_tokens_select on public.push_tokens for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));

-- Sending ----------------------------------------------------------------------------------------

-- Pushes to each recipient's devices unless they turned the type off in push_prefs, and logs it for the
-- notification center (NTF-1, which leaves chat messages out). With lock_screen_preview off, a private
-- body is replaced by p_hidden_body.
create function private.push(p_users uuid[], p_type text, p_title text, p_body text, p_data jsonb,
                             p_hidden_body text default null, p_log boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_messages jsonb;
  v_tokens   text[];
  v_request  bigint;
begin
  insert into public.notifications (user_id, type, payload)
  select u, p_type, jsonb_build_object('title', p_title, 'body', p_body) || p_data
  from unnest(p_users) u
  where p_log;

  -- Expo takes up to 100 messages per request.
  for v_messages, v_tokens in
    select jsonb_agg(jsonb_build_object('to', t.token, 'title', p_title, 'sound', 'default', 'data', p_data,
             'body', case when p_hidden_body is not null and not coalesce(s.lock_screen_preview, true) then p_hidden_body else p_body end)
             order by t.token),
           array_agg(t.token order by t.token)
    from (select pt.*, (row_number() over (order by pt.token) - 1) / 100 as batch
          from public.push_tokens pt where pt.user_id = any (p_users)) t
    left join public.user_settings s on s.user_id = t.user_id
    where coalesce(s.push_prefs ->> p_type, 'true') <> 'false'
    group by t.batch
  loop
    v_request := net.http_post(url := 'https://exp.host/--/api/v2/push/send', body := v_messages,
                               headers := '{"Content-Type": "application/json", "Accept": "application/json"}');
    insert into private.push_requests (request_id, kind, tokens) values (v_request, 'send', v_tokens);
  end loop;
end;
$$;

-- New chat messages go to the other side unless they muted or left the chat (pref "chats").
create function private.push_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
  v_sender    text;
begin
  if new.kind = 'system' then
    return null;
  end if;
  select case when c.owner_id = new.sender_id then c.member_id else c.owner_id end into v_recipient
  from public.chats c where c.id = new.chat_id;
  if exists (select 1 from public.chat_reads r
             where r.chat_id = new.chat_id and r.user_id = v_recipient and (r.muted or r.left_at is not null)) then
    return null;
  end if;
  select display_name into v_sender from public.profiles where id = new.sender_id;
  perform private.push(array[v_recipient], 'chats', coalesce(v_sender, 'New message'),
                       case when new.kind = 'image' then 'Sent a photo' else new.body end,
                       jsonb_build_object('type', 'chat', 'chat_id', new.chat_id), 'New message', false);
  return null;
end;
$$;

-- Trade steps go to whoever did not take them (pref "trades").
create function private.push_trade() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor     uuid;
  v_title     text;
  v_users     uuid[];
  v_listing   text;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return null;
  end if;
  v_actor := case new.status
    when 'proposed'  then new.proposed_by
    when 'accepted'  then case when new.proposed_by = new.seller_id then new.buyer_id else new.seller_id end
    when 'declined'  then case when new.proposed_by = new.seller_id then new.buyer_id else new.seller_id end
    when 'withdrawn' then new.proposed_by
    when 'cancelled' then new.cancelled_by
  end;
  v_title := case new.status
    when 'proposed'  then 'New trade proposal'
    when 'accepted'  then 'Trade accepted'
    when 'declined'  then 'Proposal declined'
    when 'withdrawn' then 'Proposal withdrawn'
    when 'cancelled' then 'Trade cancelled'
    when 'completed' then 'Trade completed'
    when 'expired'   then 'Trade expired'
  end;
  if v_title is null then
    return null;
  end if;
  -- Completion and expiry concern both sides; the confirmation that completed a trade is the
  -- completer's own step, so they are told too (the review prompt).
  v_users := array(select u from unnest(array[new.seller_id, new.buyer_id]) u where v_actor is null or u <> v_actor);
  select title into v_listing from public.listings where id = new.listing_id;
  perform private.push(v_users, 'trades', v_title,
                       case when new.status = 'completed' then 'Leave a review for ' || coalesce(v_listing, 'your trade')
                            else coalesce(v_listing, 'Your trade') end,
                       jsonb_build_object('type', 'trade', 'trade_id', new.id, 'chat_id', new.chat_id));
  return null;
end;
$$;

-- The first confirmation asks the other side to confirm too; the second completes the trade, which
-- notifies on its own.
create function private.push_confirmation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_trade public.trades;
  v_name  text;
begin
  select * into v_trade from public.trades where id = new.trade_id;
  if v_trade.status <> 'accepted'
     or exists (select 1 from public.trade_confirmations where trade_id = new.trade_id and user_id <> new.user_id) then
    return null;
  end if;
  select display_name into v_name from public.profiles where id = new.user_id;
  perform private.push(array[case when new.user_id = v_trade.seller_id then v_trade.buyer_id else v_trade.seller_id end],
                       'trades', coalesce(v_name, 'The other side') || ' marked the trade completed',
                       'Tap Completed once you have met',
                       jsonb_build_object('type', 'trade', 'trade_id', v_trade.id, 'chat_id', v_trade.chat_id));
  return null;
end;
$$;

create function private.push_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  select display_name into v_name from public.profiles where id = new.reviewer_id;
  perform private.push(array[new.reviewee_id], 'trades', 'New review',
                       coalesce(v_name, 'Someone') || ' gave you ' || new.rating || (case when new.rating = 1 then ' star' else ' stars' end),
                       jsonb_build_object('type', 'trade', 'trade_id', new.trade_id));
  return null;
end;
$$;

create trigger messages_push after insert on public.messages
for each row execute function private.push_message();
create trigger trades_push after insert or update of status on public.trades
for each row execute function private.push_trade();
create trigger trade_confirmations_push after insert on public.trade_confirmations
for each row execute function private.push_confirmation();
create trigger reviews_push after insert on public.reviews
for each row execute function private.push_review();

-- Receipts ---------------------------------------------------------------------------------------

-- Every 15 minutes: turn send answers into tickets, ask for receipts of tickets older than 15 minutes
-- (Expo has them by then), and drop tokens that Expo reports as DeviceNotRegistered at either step.
create function private.push_receipts() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request record;
  v_checked int := 0;
  v_removed int := 0;
  v_dead    text[] := '{}'::text[];
  v_tickets text[];
  v_id      bigint;
begin
  if not pg_try_advisory_xact_lock(hashtext('push-receipts')) then
    return null;
  end if;

  for v_request in
    select q.*, r.status_code, r.content from private.push_requests q join net._http_response r on r.id = q.request_id
  loop
    if v_request.status_code = 200 and v_request.kind = 'send' then
      insert into private.push_tickets (ticket_id, token)
      select t ->> 'id', v_request.tokens[n::int] from jsonb_array_elements(v_request.content::jsonb -> 'data') with ordinality x(t, n)
      where t ->> 'status' = 'ok'
      on conflict do nothing;
      v_dead := v_dead || array(select v_request.tokens[n::int]
                                from jsonb_array_elements(v_request.content::jsonb -> 'data') with ordinality x(t, n)
                                where t #>> '{details,error}' = 'DeviceNotRegistered');
    elsif v_request.status_code = 200 and v_request.kind = 'receipts' then
      v_dead := v_dead || array(select k.token from jsonb_each(v_request.content::jsonb -> 'data') r(id, receipt)
                                join private.push_tickets k on k.ticket_id = r.id
                                where r.receipt #>> '{details,error}' = 'DeviceNotRegistered');
      delete from private.push_tickets where ticket_id = any (v_request.tickets);
      v_checked := v_checked + cardinality(v_request.tickets);
    end if;
    delete from private.push_requests where request_id = v_request.request_id;
  end loop;

  delete from public.push_tokens where token = any (v_dead);
  get diagnostics v_removed = row_count;
  -- Answers that never came, and tickets whose receipts were lost with them.
  delete from private.push_requests where created_at < now() - interval '1 day';
  delete from private.push_tickets where created_at < now() - interval '1 day';

  select array_agg(ticket_id) into v_tickets
  from (select ticket_id from private.push_tickets
        where requested_at is null and created_at < now() - interval '15 minutes' limit 1000) t;
  if v_tickets is not null then
    v_id := net.http_post(url := 'https://exp.host/--/api/v2/push/getReceipts', body := jsonb_build_object('ids', v_tickets),
                          headers := '{"Content-Type": "application/json", "Accept": "application/json"}');
    insert into private.push_requests (request_id, kind, tickets) values (v_id, 'receipts', v_tickets);
    update private.push_tickets set requested_at = now() where ticket_id = any (v_tickets);
  end if;
  return jsonb_build_object('checked', v_checked, 'removed_tokens', v_removed);
end;
$$;

-- Tokens ------------------------------------------------------------------------------------------

-- A device registers its Expo push token after the user allows notifications; a token that moves to
-- another account (shared phone) follows the newest sign-in.
create function public.register_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(true);
begin
  if coalesce(p_token, '') !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$' then
    perform private.fail('VALIDATION_FAILED', 'token');
  elsif coalesce(p_platform, '') not in ('ios', 'android') then
    perform private.fail('VALIDATION_FAILED', 'platform');
  end if;
  insert into public.push_tokens (token, user_id, platform) values (p_token, v_uid, p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

-- Signing out removes the device's token.
create function public.unregister_push_token(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(true);
begin
  delete from public.push_tokens where token = p_token and user_id = v_uid;
end;
$$;

-- Grants and schedule ------------------------------------------------------------------------------

revoke execute on function
  private.push(uuid[], text, text, text, jsonb, text, boolean), private.push_message(), private.push_trade(),
  private.push_confirmation(), private.push_review(), private.push_receipts()
from public, anon, authenticated;

revoke execute on function public.register_push_token(text, text), public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text), public.unregister_push_token(text) to authenticated;

select cron.schedule('push-receipts', '*/15 * * * *', 'select private.push_receipts()');
