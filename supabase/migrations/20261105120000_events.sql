-- DB-15: behavior events with consent (INS-1, INS-2, spec 4.17, 5.3.12) and the daily-maintenance job
-- (4.19). Media purges join the job with media-purge (FN-2); GPS check-in purges are P1.

create table private.events (
  event_id     uuid primary key,              -- client-generated; retries do nothing
  received_at  timestamptz not null default now(),
  occurred_at  timestamptz not null,          -- client time, clamped to [received_at - 7 days, received_at]
  analytics_id uuid not null,
  session_id   uuid not null,
  campus_id    uuid,                          -- null for general users
  account_type text not null check (account_type in ('student', 'waitlist', 'general')),
  name         text not null,                 -- validated against app_config.event_catalog
  screen       text,
  props        jsonb not null default '{}',
  context      jsonb not null default '{}'    -- app_version, platform, os_version, market
);
create index on private.events (received_at);
create index on private.events (name, received_at);
create index on private.events (session_id);
create index on private.events (analytics_id, received_at);

-- The P0 events of 4.17.5 and the props each may carry. Adding an event changes this row, not the schema.
insert into public.app_config (key, value) values ('event_catalog', '{
  "session_start": ["source", "campaign"],
  "screen_view": ["screen", "previous_screen"],
  "push_open": ["type"],
  "notification_permission": ["granted"],
  "view_item_list": ["list", "page", "category", "filters", "sort", "items"],
  "select_item": ["list", "listing_id", "index"],
  "search": ["term", "scope", "category", "filters", "sort", "result_count"],
  "filter_apply": ["filters", "result_count"],
  "view_item": ["listing_id", "kind", "category", "price_bucket", "condition", "photo_count", "listing_age_hours", "source"],
  "item_engagement": ["listing_id", "seconds_bucket", "photos_seen", "description_expanded"],
  "add_to_wishlist": ["listing_id", "category", "price_bucket"],
  "remove_from_wishlist": ["listing_id", "category", "price_bucket"],
  "share": ["listing_id", "method"],
  "chat_start": ["listing_id", "source"],
  "proposal_open": ["listing_id"],
  "sell_start": ["kind"],
  "sell_step": ["step", "seconds", "photo_count", "category_suggestion_used"],
  "price_change": ["listing_id", "category", "change_pct", "listing_age_days"],
  "safety_warning_shown": ["pattern"]
}')
on conflict (key) do nothing;

-- A search term as stored: lowercased and trimmed, or null when it could identify someone (an email,
-- a phone number, 5 or more digits) or runs over 40 characters (4.17.4).
create function private.clean_term(p_term text) returns text
language sql immutable set search_path = '' as $$
  select case when t is null or t = '' or char_length(t) > 40 or t ~ '@' or t ~ '\d{5,}'
                   or t ~ '\d{3}[\s.-]?\d{3}[\s.-]?\d{4}' then null else t end
  from lower(btrim(p_term)) t;
$$;

-- INS-2: stores a batch of up to 50 events from a user who allows analytics, 1,000 an hour at most.
-- Events with an unknown name or prop are skipped, so one stale event never blocks a queue; a retried
-- event id is ignored. Events carry the analytics id, never the user id.
create function public.log_events(p_events jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user(true);
  v_catalog   jsonb := (select value from public.app_config where key = 'event_catalog');
  v_analytics uuid;
  v_campus    uuid;
  v_type      text;
  v_count     int;
begin
  if not coalesce((select analytics from public.consents where user_id = v_uid), false) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  elsif jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) > 50 then
    perform private.fail('VALIDATION_FAILED', 'events');
  end if;
  select a.analytics_id, p.campus_id,
         case when p.campus_id is null then 'general' when c.status = 'live' then 'student' else 'waitlist' end
  into v_analytics, v_campus, v_type
  from public.profiles p join private.accounts a on a.user_id = p.id left join public.campuses c on c.id = p.campus_id
  where p.id = v_uid;
  if (select count(*) from private.events where analytics_id = v_analytics and received_at > now() - interval '1 hour')
     + jsonb_array_length(p_events) > 1000 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;

  insert into private.events (event_id, occurred_at, analytics_id, session_id, campus_id, account_type, name, screen, props, context)
  select (e ->> 'event_id')::uuid,
         least(greatest(coalesce((e ->> 'occurred_at')::timestamptz, now()), now() - interval '7 days'), now()),
         v_analytics, (e ->> 'session_id')::uuid, v_campus, v_type, e ->> 'name', left(e ->> 'screen', 60),
         case when e ->> 'name' = 'search' then e -> 'props' || jsonb_build_object('term', private.clean_term(e #>> '{props,term}'))
              else coalesce(e -> 'props', '{}') end,
         coalesce(e -> 'context', '{}')
  from jsonb_array_elements(p_events) e
  where v_catalog ? (e ->> 'name')
    and (e ->> 'event_id') ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    and (e ->> 'session_id') ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    and jsonb_typeof(coalesce(e -> 'props', '{}')) = 'object'
    and not exists (select 1 from jsonb_object_keys(coalesce(e -> 'props', '{}')) k
                    where not (v_catalog -> (e ->> 'name')) ? k)
  on conflict (event_id) do nothing;
  get diagnostics v_count = row_count;
  return jsonb_build_object('accepted', v_count);
end;
$$;

-- daily-maintenance (4.19), 03:00 UTC: regrade users whose penalties just expired, delete sign-ups that
-- never confirmed within 24 hours, delete events older than 12 months, blank search terms older than 30
-- days, and compare every wallet with its ledger (a difference is a warning in the database log).
create function private.daily_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_count  int;
  v_wallet record;
begin
  if not pg_try_advisory_xact_lock(hashtext('daily-maintenance')) then
    return null;
  end if;

  perform private.mark_rank_dirty(variadic array(
    select distinct user_id from public.penalties where expires_at between now() - interval '1 day' and now()));

  delete from auth.users where email_confirmed_at is null and created_at < now() - interval '24 hours';
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('unconfirmed_users', v_count);

  delete from private.events where received_at < now() - interval '12 months';
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('events_deleted', v_count);

  update private.events set props = props - 'term'
  where name = 'search' and props ? 'term' and received_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('terms_blanked', v_count);

  v_count := 0;
  for v_wallet in
    select w.user_id, w.balance, coalesce(sum(l.delta), 0) as ledger
    from public.wallets w left join public.points_ledger l on l.user_id = w.user_id
    group by w.user_id, w.balance
    having w.balance <> coalesce(sum(l.delta), 0)
  loop
    raise warning 'daily-maintenance: wallet % balance % differs from its ledger %', v_wallet.user_id, v_wallet.balance, v_wallet.ledger;
    v_count := v_count + 1;
  end loop;
  return v_result || jsonb_build_object('wallet_mismatches', v_count);
end;
$$;
select cron.schedule('daily-maintenance', '0 3 * * *', 'select private.daily_maintenance()');

revoke execute on function private.clean_term(text), private.daily_maintenance() from public, anon, authenticated;
revoke execute on function public.log_events(jsonb) from public, anon;
grant execute on function public.log_events(jsonb) to authenticated;
