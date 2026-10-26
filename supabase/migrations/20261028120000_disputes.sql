-- DB-14: no-show disputes (spec 1.6.7, 2.7, 4.11, 5.3.7, 6.7): a claim with a statement and photos from
-- the dispute-evidence bucket, the response within 48 hours, withdrawal, the move to review at the
-- deadline, and the admin decision with its penalties; disputes join the admin queue and case data.
-- GPS check-ins and the automatic rule are P1. Point reversals come with appeals (P1): a disputed
-- trade never completed, so it has no awards to reverse.

create type public.dispute_type   as enum ('no_show');   -- escrow adds shipping claims (Part 7)
create type public.dispute_status as enum ('awaiting_response', 'under_review', 'upheld', 'rejected', 'withdrawn',
                                           'overturned');
create type public.evidence_kind  as enum ('photo', 'statement');   -- GPS check-ins are P1

create table public.disputes (
  id               uuid primary key default gen_random_uuid(),
  trade_id         uuid not null references public.trades on delete restrict,
  type             public.dispute_type not null,
  opened_by        uuid not null references public.profiles,
  against_id       uuid not null references public.profiles,
  review_campus_id uuid references public.campuses,     -- null: the open-market queue (super admins)
  status           public.dispute_status not null default 'awaiting_response',
  statement        text not null check (char_length(statement) between 1 and 2000),
  opened_at        timestamptz not null default now(),
  response_due_at  timestamptz not null,
  resolved_at      timestamptz,
  resolved_by      uuid references public.profiles,
  resolution_note  text,
  bad_faith        boolean not null default false,
  unique (trade_id, opened_by, type),
  check (opened_by <> against_id)
);
create index disputes_status_due_idx on public.disputes (status, response_due_at);

create table public.dispute_evidence (
  id         uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes on delete cascade,
  user_id    uuid not null references public.profiles,
  kind       public.evidence_kind not null,
  photo_path text,
  body       text check (char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  check ((kind = 'photo') = (photo_path is not null) and (kind = 'statement') = (body is not null))
);
create index dispute_evidence_dispute_idx on public.dispute_evidence (dispute_id);

-- Evidence photos (DSP-3): private and up to 400 KB like the other photos. A party uploads under
-- {trade_id}/{own id}/; the parties and the admins of an open dispute on the trade read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dispute-evidence', 'dispute-evidence', false, 409600, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

create function private.can_see_evidence(p_trade_id text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_trade_id !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (select 1 from public.trades t where t.id = p_trade_id::uuid and auth.uid() in (t.seller_id, t.buyer_id))
      or exists (select 1 from public.disputes d join public.user_roles r on r.user_id = auth.uid()
                 where d.trade_id = p_trade_id::uuid and d.status in ('awaiting_response', 'under_review')
                   and (r.role = 'super_admin' or (r.role = 'campus_admin' and r.campus_id = d.review_campus_id)));
end;
$$;

-- An admin can write only under their own id, which no dispute function accepts.
create policy dispute_evidence_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'dispute-evidence'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and private.can_see_evidence((storage.foldername(name))[1])
);
create policy dispute_evidence_read on storage.objects for select to authenticated
using (bucket_id = 'dispute-evidence' and private.can_see_evidence((storage.foldername(name))[1]));

-- Helpers ------------------------------------------------------------------------------------------

-- Evidence photos are the caller's own uploads for the trade, at most 5 per statement.
create function private.check_evidence_photos(p_trade_id uuid, p_uid uuid, p_paths text[]) returns void
language plpgsql set search_path = '' as $$
begin
  if cardinality(p_paths) > 5
     or exists (select 1 from unnest(p_paths) p where p is null or p not like p_trade_id || '/' || p_uid || '/%') then
    perform private.fail('VALIDATION_FAILED', 'photo_paths');
  end if;
end;
$$;

-- Once a trade's last open dispute closes (5.2), the trade fails if a claim was upheld, is cancelled if
-- one was rejected, and goes back to accepted when every claim was withdrawn. A closed trade releases
-- its items. The caller holds the trade lock.
create function private.settle_trade(p_trade_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.trade_status;
begin
  if exists (select 1 from public.disputes where trade_id = p_trade_id and status in ('awaiting_response', 'under_review')) then
    return;
  end if;
  v_status := case when exists (select 1 from public.disputes where trade_id = p_trade_id and status = 'upheld') then 'failed'
                   when exists (select 1 from public.disputes where trade_id = p_trade_id and status = 'rejected') then 'cancelled'
                   else 'accepted' end::public.trade_status;
  if v_status = 'accepted' then
    update public.trades set status = 'accepted' where id = p_trade_id and status = 'disputed';
    update public.trades set next_check_at = private.next_check(p_trade_id) where id = p_trade_id;
  else
    update public.items set status = 'available', reserved_trade_id = null where reserved_trade_id = p_trade_id;
    update public.trades set status = v_status, closed_at = now(), next_check_at = null where id = p_trade_id and status = 'disputed';
  end if;
  perform private.trade_event(p_trade_id, null);
end;
$$;

-- Users ---------------------------------------------------------------------------------------------

-- DSP-1: either side of an accepted meetup trade claims a no-show from 15 minutes to 48 hours after the
-- meetup, and both sides can claim against each other. The trade row lock keeps a claim and a
-- completion from crossing; the trades job never completes a trade inside the claim window (4.18 #5).
create function public.open_dispute(p_trade_id uuid, p_type public.dispute_type, p_statement text,
                                    p_photo_paths text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_trade   public.trades := private.party_trade(p_trade_id, v_uid);
  v_dispute public.disputes;
begin
  if v_trade.status not in ('accepted', 'disputed') then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  elsif now() not between v_trade.meet_at + interval '15 minutes' and v_trade.meet_at + interval '48 hours' then
    raise exception using errcode = 'P0001', message = 'WINDOW_CLOSED';
  elsif char_length(coalesce(btrim(p_statement), '')) not between 1 and 2000 then
    perform private.fail('VALIDATION_FAILED', 'statement');
  end if;
  perform private.check_evidence_photos(p_trade_id, v_uid, coalesce(p_photo_paths, '{}'));

  insert into public.disputes (trade_id, type, opened_by, against_id, review_campus_id, statement, response_due_at)
  values (p_trade_id, p_type, v_uid, case when v_uid = v_trade.seller_id then v_trade.buyer_id else v_trade.seller_id end,
          private.review_campus((select campus_id from public.listings where id = v_trade.listing_id)),
          btrim(p_statement), now() + interval '48 hours')
  on conflict (trade_id, opened_by, type) do nothing
  returning * into v_dispute;
  if not found then
    raise exception using errcode = 'P0001', message = 'ALREADY_EXISTS';
  end if;
  insert into public.dispute_evidence (dispute_id, user_id, kind, photo_path)
  select v_dispute.id, v_uid, 'photo', p from unnest(p_photo_paths) p;
  if v_trade.status = 'accepted' then
    update public.trades set status = 'disputed', next_check_at = null where id = p_trade_id;
    perform private.trade_event(p_trade_id, v_uid);
  end if;
  return to_jsonb(v_dispute);
end;
$$;

-- DSP-5: the other side answers once, within 48 hours, with a statement and photos; the dispute then
-- goes to review. Suspended users can still answer.
create function public.respond_dispute(p_dispute_id uuid, p_statement text, p_photo_paths text[] default '{}')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user(true);
  v_dispute public.disputes;
begin
  select * into v_dispute from public.disputes where id = p_dispute_id for update;
  if not found or v_dispute.against_id <> v_uid then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  elsif v_dispute.status <> 'awaiting_response' or now() > v_dispute.response_due_at then
    raise exception using errcode = 'P0001', message = 'WINDOW_CLOSED';
  elsif char_length(coalesce(btrim(p_statement), '')) not between 1 and 2000 then
    perform private.fail('VALIDATION_FAILED', 'statement');
  end if;
  perform private.check_evidence_photos(v_dispute.trade_id, v_uid, coalesce(p_photo_paths, '{}'));

  insert into public.dispute_evidence (dispute_id, user_id, kind, body) values (p_dispute_id, v_uid, 'statement', btrim(p_statement));
  insert into public.dispute_evidence (dispute_id, user_id, kind, photo_path)
  select p_dispute_id, v_uid, 'photo', p from unnest(p_photo_paths) p;
  update public.disputes set status = 'under_review' where id = p_dispute_id returning * into v_dispute;
  return to_jsonb(v_dispute);
end;
$$;

-- The claimant withdraws before the other side answers; the trade settles.
create function public.withdraw_dispute(p_dispute_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user(true);
  v_dispute public.disputes;
begin
  select * into v_dispute from public.disputes where id = p_dispute_id;
  if not found or v_dispute.opened_by <> v_uid then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  perform private.party_trade(v_dispute.trade_id, v_uid);
  update public.disputes set status = 'withdrawn', resolved_at = now()
  where id = p_dispute_id and status = 'awaiting_response'
  returning * into v_dispute;
  if not found then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  perform private.settle_trade(v_dispute.trade_id);
  return to_jsonb(v_dispute);
end;
$$;

-- Admins --------------------------------------------------------------------------------------------

-- DSP-6, DSP-7: an admin upholds or rejects a claim under review. Upheld: a no-show penalty for the
-- other side; rejected as knowingly false: a bad-faith penalty for the claimant. The conditional update
-- and the penalty key keep a second decision from doubling anything (4.18 #20).
create function public.admin_resolve_dispute(p_dispute_id uuid, p_outcome public.dispute_status,
                                             p_bad_faith boolean default false, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_dispute public.disputes;
  v_uid     uuid;
  v_rules   jsonb := (select value from public.app_config where key = 'rank_rules');
begin
  select * into v_dispute from public.disputes where id = p_dispute_id;
  v_uid := private.require_admin('campus_admin', v_dispute.review_campus_id);
  if v_dispute.id is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  elsif p_outcome is null or p_outcome not in ('upheld', 'rejected') then
    perform private.fail('VALIDATION_FAILED', 'outcome');
  elsif coalesce(p_bad_faith, false) and p_outcome = 'upheld' then
    perform private.fail('VALIDATION_FAILED', 'bad_faith');
  end if;

  perform 1 from public.trades where id = v_dispute.trade_id for update;
  update public.disputes
  set status = p_outcome, bad_faith = coalesce(p_bad_faith, false), resolved_at = now(), resolved_by = v_uid,
      resolution_note = nullif(btrim(p_note), '')
  where id = p_dispute_id and status = 'under_review'
  returning * into v_dispute;
  if not found then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  if p_outcome = 'upheld' or v_dispute.bad_faith then
    insert into public.penalties (user_id, reason, points, source_type, source_id, expires_at)
    select u, r, (v_rules #>> array['penalties', r::text])::int, 'dispute', p_dispute_id,
           now() + make_interval(days => (v_rules ->> 'penalty_window_days')::int)
    from (select case when p_outcome = 'upheld' then v_dispute.against_id else v_dispute.opened_by end as u,
                 case when p_outcome = 'upheld' then 'no_show' else 'bad_faith' end::public.penalty_reason as r) x
    on conflict do nothing;
  end if;
  perform private.mark_rank_dirty(v_dispute.opened_by, v_dispute.against_id);
  perform private.settle_trade(v_dispute.trade_id);

  insert into private.admin_log (admin_id, operation, args)
  values (v_uid, 'admin_resolve_dispute', jsonb_build_object('dispute_id', p_dispute_id, 'outcome', p_outcome,
                                                             'bad_faith', p_bad_faith, 'note', p_note));
  return to_jsonb(v_dispute);
end;
$$;

-- The queue (replaces DB-13): open reports by target and disputes under review, oldest first.
create or replace function public.admin_queue() returns jsonb
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
      select * from (
        select (array_agg(r.id order by r.created_at, r.id))[1] as case_id, 'report' as case_type,
               r.target_type::text as target_type, r.target_ref, r.target_user_id, r.target_campus_id,
               min(r.created_at) as opened_at, count(*) as reports, array_agg(distinct r.reason) as reasons
        from public.reports r
        where r.status = 'open' and (v_super or r.target_campus_id = any (v_campuses))
        group by r.target_type, r.target_ref, r.target_user_id, r.target_campus_id
        union all
        select d.id, 'dispute', 'trade', d.trade_id::text, d.against_id, d.review_campus_id,
               d.opened_at, 1, array[d.type::text]
        from public.disputes d
        where d.status = 'under_review' and (v_super or d.review_campus_id = any (v_campuses))
        order by opened_at, case_id
        limit 200
      ) q
      cross join lateral (
        select round(extract(epoch from now() - q.opened_at) / 3600, 1) as age_hours,
               (select p.display_name from public.profiles p where p.id = q.target_user_id) as target_user_name,
               (select jsonb_build_object('title', l.title, 'status', l.status, 'hidden', l.hidden,
                                          'hidden_reason', l.hidden_reason)
                from public.listings l
                where l.id = case when q.target_type = 'listing' then q.target_ref::uuid end) as listing
      ) x
    ) c);
end;
$$;

-- Case data (replaces DB-13): for a reported message, the chat around it; for a dispute, its evidence
-- with both statements, or the trade's chat (2.7). The view is the logged call.
create or replace function public.admin_open_case_data(p_case_type text, p_case_id uuid, p_resource text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_campus uuid;
  v_open   boolean;
  v_chat   uuid;
  v_seq    bigint;
  v_uid    uuid;
begin
  if p_case_type = 'report' then
    select r.target_campus_id, r.status = 'open',
           case when r.target_type = 'message' then split_part(r.target_ref, ':', 1)::uuid end,
           case when r.target_type = 'message' then split_part(r.target_ref, ':', 2)::bigint end
    into v_campus, v_open, v_chat, v_seq
    from public.reports r where r.id = p_case_id;
  elsif p_case_type = 'dispute' then
    select d.review_campus_id, d.status in ('awaiting_response', 'under_review'), t.chat_id
    into v_campus, v_open, v_chat
    from public.disputes d join public.trades t on t.id = d.trade_id where d.id = p_case_id;
  end if;
  v_uid := private.require_admin('campus_admin', v_campus);
  if v_open is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  elsif not v_open then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  elsif not coalesce(p_resource = 'chat' and v_chat is not null or p_resource = 'evidence' and p_case_type = 'dispute', false) then
    perform private.fail('VALIDATION_FAILED', 'resource');
  end if;

  insert into private.admin_log (admin_id, operation, args)
  values (v_uid, 'view', jsonb_build_object('resource', p_resource, 'case_type', p_case_type, 'case_id', p_case_id));
  if p_resource = 'evidence' then
    return (
      select jsonb_build_object('statement', d.statement, 'opened_by', d.opened_by, 'against_id', d.against_id,
               'evidence', coalesce((select jsonb_agg(to_jsonb(e) - 'dispute_id' order by e.created_at)
                                     from public.dispute_evidence e where e.dispute_id = d.id), '[]'))
      from public.disputes d where d.id = p_case_id);
  end if;
  return jsonb_build_object('chat_id', v_chat, 'reported_seq', v_seq, 'messages', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'seq', m.seq, 'sender_id', m.sender_id, 'kind', m.kind, 'body', coalesce(h.body, m.body),
             'image_path', coalesce(h.image_path, m.image_path), 'hidden', h.seq is not null, 'created_at', m.created_at)
           order by m.seq), '[]')
    from (select * from public.messages
          where chat_id = v_chat and (v_seq is null or seq between v_seq - 50 and v_seq + 50)
          order by seq desc limit 200) m
    left join private.hidden_messages h on h.chat_id = m.chat_id and h.seq = m.seq));
end;
$$;

-- Notifications -------------------------------------------------------------------------------------

-- Dispute steps (pref "disputes", CHT-5): a claim and a withdrawal go to the other side, a decision to
-- both.
create function private.push_dispute() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_title text;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return null;
  end if;
  v_title := case when tg_op = 'INSERT' then 'No-show reported'
                  when new.status = 'withdrawn' then 'No-show claim withdrawn'
                  when new.status = 'upheld' then 'No-show claim upheld'
                  when new.status = 'rejected' then 'No-show claim rejected' end;
  if v_title is null then
    return null;
  end if;
  perform private.push(case when new.status in ('upheld', 'rejected') then array[new.opened_by, new.against_id]
                            else array[new.against_id] end,
                       'disputes', v_title,
                       case when tg_op = 'INSERT' then 'You have 48 hours to respond' else 'See the trade for details' end,
                       jsonb_build_object('type', 'dispute', 'dispute_id', new.id, 'trade_id', new.trade_id));
  return null;
end;
$$;
create trigger disputes_push after insert or update of status on public.disputes
for each row execute function private.push_dispute();

-- Trade steps (replaces FN-1): a trade leaving a dispute is announced by the dispute's own push.
create or replace function private.push_trade() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor     uuid;
  v_title     text;
  v_users     uuid[];
  v_listing   text;
begin
  if tg_op = 'UPDATE' and (new.status = old.status or old.status = 'disputed') then
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

-- Jobs ----------------------------------------------------------------------------------------------

-- At the deadline a claim without an answer goes to review (DSP-5); it runs in the trades-advance job.
create function private.disputes_advance() returns int
language sql security definer set search_path = '' as $$
  with moved as (
    update public.disputes set status = 'under_review'
    where status = 'awaiting_response' and response_due_at <= now()
    returning 1)
  select count(*)::int from moved;
$$;
select cron.schedule('trades-advance', '*/5 * * * *', 'select private.trades_advance(), private.disputes_advance()');

-- Row-level security and grants ---------------------------------------------------------------------
-- The parties read the trade's disputes and both sides' evidence; writes go through the functions.

alter table public.disputes         enable row level security;
alter table public.dispute_evidence enable row level security;
create policy disputes_select on public.disputes for select to authenticated
using ((select auth.uid()) in (opened_by, against_id));
create policy dispute_evidence_select on public.dispute_evidence for select to authenticated
using (exists (select 1 from public.disputes d where d.id = dispute_id));

revoke execute on function
  private.can_see_evidence(text), private.check_evidence_photos(uuid, uuid, text[]), private.settle_trade(uuid),
  private.push_dispute(), private.disputes_advance()
from public, anon, authenticated;
grant execute on function private.can_see_evidence(text) to authenticated;

revoke execute on function
  public.open_dispute(uuid, public.dispute_type, text, text[]), public.respond_dispute(uuid, text, text[]),
  public.withdraw_dispute(uuid), public.admin_resolve_dispute(uuid, public.dispute_status, boolean, text)
from public, anon;
grant execute on function
  public.open_dispute(uuid, public.dispute_type, text, text[]), public.respond_dispute(uuid, text, text[]),
  public.withdraw_dispute(uuid), public.admin_resolve_dispute(uuid, public.dispute_status, boolean, text)
to authenticated;
