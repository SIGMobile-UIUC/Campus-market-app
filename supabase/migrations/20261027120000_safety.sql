-- DB-13: reports with automatic hiding, blocking, enforcement actions and their effects, and the admin
-- log; the admin queue, private case data, report resolution, hiding, enforcement and config changes
-- (spec 1.6.10, 2.8 to 2.10, 4.15, 5.3.10, 6.9, 6.10). Disputes join the queue with DB-14; appeals,
-- feature restrictions and the conflict-of-interest check are P1.

create type public.report_target    as enum ('listing', 'user', 'message');
create type public.enforcement_kind as enum ('warning', 'content_removal', 'restriction', 'suspension', 'ban');

create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles,
  target_type      public.report_target not null,
  target_ref       text not null,                               -- listing id, user id, or chat_id:seq
  target_user_id   uuid not null references public.profiles,   -- whose listing, account or message
  target_campus_id uuid references public.campuses,            -- null: the open-market queue (super admins)
  reason           text not null,
  note             text check (char_length(note) <= 1000),
  status           text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references public.profiles,
  unique (reporter_id, target_type, target_ref)
);
create index reports_queue_idx on public.reports (target_campus_id, status, created_at);
create index reports_open_target_idx on public.reports (target_type, target_ref) where status = 'open';

-- A hidden message keeps no text or photo in the chat; its content waits here for a restore.
create table private.hidden_messages (
  chat_id    uuid not null,
  seq        bigint not null,
  body       text,
  image_path text,
  hidden_by  uuid not null references public.profiles,
  hidden_at  timestamptz not null default now(),
  primary key (chat_id, seq),
  foreign key (chat_id, seq) references public.messages on delete cascade
);

create table public.enforcement_actions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles,
  kind        public.enforcement_kind not null,
  scope       text,                          -- for restrictions (P1): 'posting' or 'chat'
  reason_code text not null,
  policy_ref  text not null,                 -- e.g. '2.8'
  case_type   text check (case_type in ('report', 'dispute')),
  case_id     uuid,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,                   -- suspensions and restrictions only
  decided_by  uuid not null references public.profiles,
  note        text,
  created_at  timestamptz not null default now(),
  check ((ends_at is not null) = (kind in ('suspension', 'restriction')))
);
create index enforcement_actions_user_idx on public.enforcement_actions (user_id, created_at desc);

create table private.admin_log (
  id         bigint generated always as identity primary key,
  admin_id   uuid not null,
  operation  text not null,                  -- function name, or 'view' for private data
  args       jsonb not null,                 -- for views: resource and case
  created_at timestamptz not null default now()
);

-- Append-only (2.10): corrections are new rows. Revoked from every role below, and refused for the
-- owner too.
create function private.append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;
create trigger enforcement_actions_append_only before update or delete or truncate on public.enforcement_actions
for each statement execute function private.append_only();
create trigger admin_log_append_only before update or delete or truncate on private.admin_log
for each statement execute function private.append_only();

-- Reasons the report sheet offers (SAF-1); the app reads this public row.
insert into public.app_config (key, value, public) values ('report_reasons', '[
  {"id": "scam", "label": "Scam or fraud"},
  {"id": "prohibited_item", "label": "Prohibited item"},
  {"id": "harassment", "label": "Harassment or threats"},
  {"id": "inappropriate", "label": "Inappropriate content"},
  {"id": "spam", "label": "Spam or misleading"},
  {"id": "other", "label": "Something else"}
]', true)
on conflict (key) do nothing;

-- Helpers ------------------------------------------------------------------------------------------

-- The campus whose admins review a case: the given campus while it is live; otherwise null, the
-- open-market queue that super admins work (2.8).
create function private.review_campus(p_campus_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.campuses where id = p_campus_id and status = 'live';
$$;

-- Guard for admin functions (4.6.6): super admins pass; campus admins pass for an action open to them
-- (p_role 'campus_admin') on a case of their campus.
create function private.require_admin(p_role public.admin_role, p_campus_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
begin
  if not exists (select 1 from public.user_roles r
                 where r.user_id = v_uid
                   and (r.role = 'super_admin'
                        or (p_role = 'campus_admin' and r.role = 'campus_admin' and r.campus_id = p_campus_id))) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  return v_uid;
end;
$$;

-- Users ---------------------------------------------------------------------------------------------

-- SAF-1, SAF-2: one report per user per target, 10 a day. A listing reported by 3 different users is
-- hidden until an admin reviews it; locking the listing first makes concurrent reports count in turn
-- (4.18 #19).
create function public.report(p_target_type public.report_target, p_target_ref text, p_reason text,
                              p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_user();
  v_ref    text := lower(p_target_ref);
  v_user   uuid;
  v_campus uuid;
  v_report public.reports;
begin
  if not exists (select 1 from public.app_config c, jsonb_array_elements(c.value) r
                 where c.key = 'report_reasons' and r ->> 'id' = p_reason) then
    perform private.fail('VALIDATION_FAILED', 'reason');
  elsif char_length(p_note) > 1000 then
    perform private.fail('VALIDATION_FAILED', 'note');
  end if;

  -- The target as the reporter can see it, whose it is, and the campus it belongs to.
  if p_target_type = 'listing' and v_ref ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    select l.owner_id, l.campus_id into v_user, v_campus from public.listings l
    where l.id = v_ref::uuid and l.deleted_at is null and not l.hidden
      and (l.visibility = 'open' or l.campus_id = private.my_live_campus_id())
    for update;
  elsif p_target_type = 'user' and v_ref ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    select p.id, p.campus_id into v_user, v_campus from public.profiles p
    where p.id = v_ref::uuid and p.status <> 'deleted' and p.display_name is not null;
  elsif p_target_type = 'message' and v_ref ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}:[0-9]{1,18}$' then
    select m.sender_id, l.campus_id into v_user, v_campus
    from public.messages m
    join public.chats c on c.id = m.chat_id
    join public.listings l on l.id = c.listing_id
    where m.chat_id = split_part(v_ref, ':', 1)::uuid and m.seq = split_part(v_ref, ':', 2)::bigint
      and v_uid in (c.owner_id, c.member_id) and m.sender_id is not null;
  end if;
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  elsif v_user = v_uid then
    raise exception using errcode = 'P0001', message = 'SELF_ACTION';
  elsif (select count(*) from public.reports where reporter_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;

  insert into public.reports (reporter_id, target_type, target_ref, target_user_id, target_campus_id, reason, note)
  values (v_uid, p_target_type, v_ref, v_user, private.review_campus(v_campus), p_reason, nullif(btrim(p_note), ''))
  on conflict (reporter_id, target_type, target_ref) do nothing
  returning * into v_report;
  if not found then
    raise exception using errcode = 'P0001', message = 'ALREADY_EXISTS';
  end if;

  if p_target_type = 'listing'
     and (select count(*) from public.reports where target_type = 'listing' and target_ref = v_ref and status = 'open') >= 3 then
    update public.listings set hidden = true, hidden_reason = 'reported' where id = v_ref::uuid;
  end if;
  return to_jsonb(v_report);
end;
$$;

-- SAF-3: blocked users cannot message each other and do not see each other's listings (the listings
-- policy and the chat functions read the block list). Suspended users can still block.
create function public.block_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(true);
begin
  if p_user_id = v_uid then
    raise exception using errcode = 'P0001', message = 'SELF_ACTION';
  elsif not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_uid, p_user_id) on conflict do nothing;
end;
$$;

create function public.unblock_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(true);
begin
  if p_user_id = v_uid then
    raise exception using errcode = 'P0001', message = 'SELF_ACTION';
  end if;
  delete from public.blocks where blocker_id = v_uid and blocked_id = p_user_id;
end;
$$;

-- Admins --------------------------------------------------------------------------------------------
-- Every admin function checks the caller's role and campus and writes one admin_log row (6.10).

-- SAF-5: open reports by target, oldest first with their age, for the caller's campuses; super admins
-- see every campus and the open-market queue. ponytail: the 200 oldest cases and no paging; disputes
-- join with DB-14.
create function public.admin_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := private.require_user();
  v_super    boolean := exists (select 1 from public.user_roles where user_id = v_uid and role = 'super_admin');
  v_campuses uuid[] := array(select campus_id from public.user_roles where user_id = v_uid and role = 'campus_admin');
begin
  if not v_super and cardinality(v_campuses) = 0 then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  insert into private.admin_log (admin_id, operation, args) values (v_uid, 'admin_queue', '{}');
  return (
    select coalesce(jsonb_agg(to_jsonb(c) order by c.opened_at, c.case_id), '[]')
    from (
      select (array_agg(r.id order by r.created_at, r.id))[1] as case_id, 'report' as case_type,
             r.target_type, r.target_ref, r.target_user_id, r.target_campus_id,
             min(r.created_at) as opened_at,
             round(extract(epoch from now() - min(r.created_at)) / 3600, 1) as age_hours,
             count(*) as reports,
             array_agg(distinct r.reason) as reasons,
             (select p.display_name from public.profiles p where p.id = r.target_user_id) as target_user_name,
             (select jsonb_build_object('title', l.title, 'status', l.status, 'hidden', l.hidden,
                                        'hidden_reason', l.hidden_reason)
              from public.listings l
              where l.id = case when r.target_type = 'listing' then r.target_ref::uuid end) as listing
      from public.reports r
      where r.status = 'open' and (v_super or r.target_campus_id = any (v_campuses))
      group by r.target_type, r.target_ref, r.target_user_id, r.target_campus_id
      order by opened_at, case_id
      limit 200
    ) c);
end;
$$;

-- The private data of an open case, for the admins who review it (2.11, SAF-9): for a reported
-- message, the chat around it, hidden content included. The view is the logged call. Evidence and
-- check-ins join with DB-14.
create function public.admin_open_case_data(p_case_type text, p_case_id uuid, p_resource text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_report public.reports;
  v_uid    uuid;
  v_chat   uuid;
  v_seq    bigint;
begin
  select * into v_report from public.reports where id = p_case_id and p_case_type = 'report';
  v_uid := private.require_admin('campus_admin', v_report.target_campus_id);
  if v_report.id is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  elsif v_report.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  elsif p_resource is distinct from 'chat' or v_report.target_type <> 'message' then
    perform private.fail('VALIDATION_FAILED', 'resource');
  end if;

  v_chat := split_part(v_report.target_ref, ':', 1)::uuid;
  v_seq := split_part(v_report.target_ref, ':', 2)::bigint;
  insert into private.admin_log (admin_id, operation, args)
  values (v_uid, 'view', jsonb_build_object('resource', 'chat', 'chat_id', v_chat, 'case_type', 'report', 'case_id', p_case_id));
  return jsonb_build_object('chat_id', v_chat, 'reported_seq', v_seq, 'messages', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'seq', m.seq, 'sender_id', m.sender_id, 'kind', m.kind, 'body', coalesce(h.body, m.body),
             'image_path', coalesce(h.image_path, m.image_path), 'hidden', h.seq is not null, 'created_at', m.created_at)
           order by m.seq), '[]')
    from public.messages m
    left join private.hidden_messages h on h.chat_id = m.chat_id and h.seq = m.seq
    where m.chat_id = v_chat and m.seq between v_seq - 50 and v_seq + 50));
end;
$$;

-- Closes every open report on the case's target. Dismissing restores a listing that reports hid;
-- upholding with p_harassment gives the reported user the harassment penalty (1.7.1). Hiding content and
-- enforcement are their own calls.
create function public.admin_resolve_report(p_report_id uuid, p_outcome text, p_harassment boolean default false,
                                            p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_report public.reports;
  v_uid    uuid;
  v_rules  jsonb := (select value from public.app_config where key = 'rank_rules');
  v_count  int;
begin
  select * into v_report from public.reports where id = p_report_id for update;
  v_uid := private.require_admin('campus_admin', v_report.target_campus_id);
  if v_report.id is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  elsif v_report.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  elsif p_outcome is null or p_outcome not in ('actioned', 'dismissed') then
    perform private.fail('VALIDATION_FAILED', 'outcome');
  elsif coalesce(p_harassment, false) and p_outcome = 'dismissed' then
    perform private.fail('VALIDATION_FAILED', 'harassment');
  end if;

  update public.reports set status = p_outcome, resolved_at = now(), resolved_by = v_uid
  where target_type = v_report.target_type and target_ref = v_report.target_ref and status = 'open';
  get diagnostics v_count = row_count;
  if p_outcome = 'dismissed' and v_report.target_type = 'listing' then
    update public.listings set hidden = false, hidden_reason = null
    where id = v_report.target_ref::uuid and hidden_reason = 'reported';
  end if;
  if p_harassment then
    insert into public.penalties (user_id, reason, points, source_type, source_id, expires_at)
    values (v_report.target_user_id, 'harassment', (v_rules #>> '{penalties,harassment}')::int, 'report', p_report_id,
            now() + make_interval(days => (v_rules ->> 'penalty_window_days')::int))
    on conflict do nothing;
    perform private.mark_rank_dirty(v_report.target_user_id);
  end if;

  insert into private.admin_log (admin_id, operation, args)
  values (v_uid, 'admin_resolve_report', jsonb_build_object('report_id', p_report_id, 'outcome', p_outcome,
                                                            'harassment', p_harassment, 'note', p_note));
  return jsonb_build_object('resolved', v_count);
end;
$$;

-- Hides or restores a listing or a user's message (2.8). The owner still sees a hidden listing with
-- the reason; a hidden message loses its text and photo until a restore.
create function public.admin_set_hidden(p_target_type public.report_target, p_target_ref text, p_hidden boolean,
                                        p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ref    text := lower(p_target_ref);
  v_found  boolean := false;
  v_campus uuid;
  v_chat   uuid;
  v_seq    bigint;
  v_uid    uuid;
begin
  if p_target_type = 'listing' and v_ref ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    select campus_id into v_campus from public.listings where id = v_ref::uuid for update;
    v_found := found;
  elsif p_target_type = 'message' and v_ref ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}:[0-9]{1,18}$' then
    v_chat := split_part(v_ref, ':', 1)::uuid;
    v_seq := split_part(v_ref, ':', 2)::bigint;
    select l.campus_id into v_campus
    from public.messages m join public.chats c on c.id = m.chat_id join public.listings l on l.id = c.listing_id
    where m.chat_id = v_chat and m.seq = v_seq and m.sender_id is not null
    for update of m;
    v_found := found;
  end if;
  v_uid := private.require_admin('campus_admin', private.review_campus(v_campus));
  if not v_found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  elsif p_hidden is null then
    perform private.fail('VALIDATION_FAILED', 'hidden');
  elsif p_hidden and char_length(coalesce(btrim(p_reason), '')) not between 1 and 200 then
    perform private.fail('VALIDATION_FAILED', 'reason');
  end if;

  if p_target_type = 'listing' then
    update public.listings set hidden = p_hidden, hidden_reason = case when p_hidden then btrim(p_reason) end
    where id = v_ref::uuid;
  elsif p_hidden then
    insert into private.hidden_messages (chat_id, seq, body, image_path, hidden_by)
    select chat_id, seq, body, image_path, v_uid from public.messages where chat_id = v_chat and seq = v_seq
    on conflict do nothing;
    update public.messages set body = null, image_path = null, meta = coalesce(meta, '{}') || '{"hidden": true}'
    where chat_id = v_chat and seq = v_seq;
  else
    update public.messages m set body = h.body, image_path = h.image_path, meta = nullif(m.meta - 'hidden', '{}')
    from private.hidden_messages h
    where m.chat_id = v_chat and m.seq = v_seq and h.chat_id = m.chat_id and h.seq = m.seq;
    delete from private.hidden_messages where chat_id = v_chat and seq = v_seq;
  end if;

  insert into private.admin_log (admin_id, operation, args)
  values (v_uid, 'admin_set_hidden', jsonb_build_object('target_type', p_target_type, 'target_ref', v_ref,
                                                        'hidden', p_hidden, 'reason', p_reason));
  return jsonb_build_object('target_type', p_target_type, 'target_ref', v_ref, 'hidden', p_hidden);
end;
$$;

-- SAF-7: an action within the caller's authority (2.8). Campus admins warn, record content removals
-- and suspend for up to 7 days in their campus; longer suspensions and bans need a super admin.
-- Restrictions are P1. Effects follow from the enforcement_actions_effects trigger.
create function public.admin_enforce(p_user_id uuid, p_kind public.enforcement_kind, p_duration interval,
                                     p_reason_code text, p_policy_ref text, p_case_type text default null,
                                     p_case_id uuid default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_campus uuid := private.review_campus((select campus_id from public.profiles where id = p_user_id));
  v_uid    uuid := private.require_admin(case when p_kind = 'ban' or p_duration > interval '7 days'
                                              then 'super_admin' else 'campus_admin' end::public.admin_role, v_campus);
  v_action public.enforcement_actions;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and status <> 'deleted') then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  elsif p_user_id = v_uid then
    raise exception using errcode = 'P0001', message = 'SELF_ACTION';
  elsif p_kind is null or p_kind = 'restriction' then
    perform private.fail('VALIDATION_FAILED', 'kind');
  elsif (p_kind = 'suspension') <> (p_duration is not null)
        or p_duration not between interval '1 day' and interval '30 days' then
    perform private.fail('VALIDATION_FAILED', 'duration');
  elsif coalesce(btrim(p_reason_code), '') = '' then
    perform private.fail('VALIDATION_FAILED', 'reason_code');
  elsif coalesce(btrim(p_policy_ref), '') = '' then
    perform private.fail('VALIDATION_FAILED', 'policy_ref');
  elsif (p_case_type is null) <> (p_case_id is null) or p_case_type not in ('report', 'dispute')
        or (p_case_type = 'report' and not exists (select 1 from public.reports where id = p_case_id and target_user_id = p_user_id)) then
    perform private.fail('VALIDATION_FAILED', 'case');
  end if;

  insert into public.enforcement_actions (user_id, kind, reason_code, policy_ref, case_type, case_id, ends_at, decided_by, note)
  values (p_user_id, p_kind, btrim(p_reason_code), btrim(p_policy_ref), p_case_type, p_case_id,
          now() + p_duration, v_uid, nullif(btrim(p_note), ''))
  returning * into v_action;
  insert into private.admin_log (admin_id, operation, args)
  values (v_uid, 'admin_enforce', jsonb_build_object('user_id', p_user_id, 'kind', p_kind, 'duration', p_duration,
          'reason_code', p_reason_code, 'policy_ref', p_policy_ref, 'case_type', p_case_type, 'case_id', p_case_id, 'note', p_note));
  return to_jsonb(v_action);
end;
$$;

-- Suspensions and bans take effect on the account (4.15); a ban also keeps the email from signing up
-- again (2.8). The user hears about every action by push and in the notification center.
create function private.enforcement_effects() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'suspension' then
    update public.profiles set status = 'suspended', suspended_until = greatest(suspended_until, new.ends_at)
    where id = new.user_id and status in ('active', 'suspended');
  elsif new.kind = 'ban' then
    update public.profiles set status = 'banned', suspended_until = null where id = new.user_id and status <> 'deleted';
    insert into private.identity_tombstones (email_hmac, reason, blocked_until)
    select private.email_hmac(a.email), 'ban', null from private.accounts a
    where a.user_id = new.user_id and private.email_hmac(a.email) is not null
    on conflict (email_hmac) do update set reason = 'ban', blocked_until = null;
  end if;
  perform private.push(array[new.user_id], 'account',
    case new.kind when 'warning' then 'You received a warning'
                  when 'content_removal' then 'Your content was removed'
                  when 'suspension' then 'Your account is suspended'
                  when 'ban' then 'Your account is banned'
                  else 'Account notice' end,
    'See your account status for the reason.', jsonb_build_object('type', 'enforcement', 'action_id', new.id));
  return null;
end;
$$;
create trigger enforcement_actions_effects after insert on public.enforcement_actions
for each row execute function private.enforcement_effects();

-- Changes a rule value (6.10). A rank rules change queues every user for recompute (4.18 #22).
create function public.admin_set_config(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin('super_admin', null);
begin
  if p_value is null then
    perform private.fail('VALIDATION_FAILED', 'value');
  end if;
  update public.app_config set value = p_value, updated_by = v_uid, updated_at = now() where key = p_key;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if p_key = 'rank_rules' then
    perform private.mark_rank_dirty(variadic array(select id from public.profiles where status <> 'deleted'));
  end if;
  insert into private.admin_log (admin_id, operation, args)
  values (v_uid, 'admin_set_config', jsonb_build_object('key', p_key, 'value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end;
$$;

-- Jobs ----------------------------------------------------------------------------------------------

-- enforcement-lift: ends suspensions whose time is up, so the profile shows again (4.15).
create function private.enforcement_lift() returns int
language sql security definer set search_path = '' as $$
  with lifted as (
    update public.profiles set status = 'active', suspended_until = null
    where status = 'suspended' and suspended_until <= now()
    returning 1)
  select count(*)::int from lifted;
$$;
select cron.schedule('enforcement-lift', '*/15 * * * *', 'select private.enforcement_lift()');

-- Row-level security and grants ---------------------------------------------------------------------
-- Users read their own reports and enforcement actions (the account status page); writes go through
-- the functions.

alter table public.reports             enable row level security;
alter table public.enforcement_actions enable row level security;
create policy reports_select             on public.reports             for select to authenticated using (reporter_id = (select auth.uid()));
create policy enforcement_actions_select on public.enforcement_actions for select to authenticated using (user_id = (select auth.uid()));
revoke update, delete, truncate on public.enforcement_actions from public, anon, authenticated, service_role;
revoke update, delete, truncate on private.admin_log from public, anon, authenticated, service_role;

revoke execute on function
  private.append_only(), private.review_campus(uuid), private.require_admin(public.admin_role, uuid),
  private.enforcement_effects(), private.enforcement_lift()
from public, anon, authenticated;

revoke execute on function
  public.report(public.report_target, text, text, text), public.block_user(uuid), public.unblock_user(uuid),
  public.admin_queue(), public.admin_open_case_data(text, uuid, text),
  public.admin_resolve_report(uuid, text, boolean, text), public.admin_set_hidden(public.report_target, text, boolean, text),
  public.admin_enforce(uuid, public.enforcement_kind, interval, text, text, text, uuid, text),
  public.admin_set_config(text, jsonb)
from public, anon;
grant execute on function
  public.report(public.report_target, text, text, text), public.block_user(uuid), public.unblock_user(uuid),
  public.admin_queue(), public.admin_open_case_data(text, uuid, text),
  public.admin_resolve_report(uuid, text, boolean, text), public.admin_set_hidden(public.report_target, text, boolean, text),
  public.admin_enforce(uuid, public.enforcement_kind, interval, text, text, text, uuid, text),
  public.admin_set_config(text, jsonb)
to authenticated;
