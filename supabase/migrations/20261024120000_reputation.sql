-- DB-11: reviews, penalties and trust grades. submit_review, the late-cancel penalty in cancel_trade,
-- rank marking at completion, and the rank-recompute job that reads app_config.rank_rules and copies
-- the grade to profiles.tier (spec 1.7.1, 1.7.3, 4.12, 5.3.7, 5.3.8, 6.7). Point awards join with DB-12;
-- dispute penalties with DB-14.

create type public.penalty_reason as enum ('no_show', 'harassment', 'late_cancel', 'bad_faith');

create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  trade_id    uuid not null references public.trades on delete restrict,
  reviewer_id uuid not null references public.profiles,
  reviewee_id uuid not null references public.profiles,
  rating      smallint not null check (rating between 1 and 5),
  tags        text[] not null default '{}',
  comment     text check (char_length(comment) <= 500),
  created_at  timestamptz not null default now(),
  unique (trade_id, reviewer_id),
  check (reviewer_id <> reviewee_id)
);

create table public.penalties (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles,
  reason      public.penalty_reason not null,
  points      smallint not null check (points > 0),
  source_type text not null,             -- 'dispute', 'trade', 'report'
  source_id   uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,               -- set when an appeal overturns it
  unique (user_id, reason, source_type, source_id)
);

-- Own row only (and admins later). ponytail: trade count and rating for other people's profiles come
-- with the public profile, copied to profiles like tier.
create table public.rank_stats (
  user_id            uuid primary key references public.profiles on delete cascade,
  counted_trades     integer not null,
  distinct_partners  integer not null,
  reviews_count      integer not null,
  rating_bayes       numeric(4, 3) not null,
  penalty_points     integer not null,       -- active, last 90 days
  account_age_days   integer not null,
  score              numeric not null,
  tier               public.tier not null,
  next_tier_progress numeric(4, 3) not null, -- 0 to 1, the least-met requirement of the next grade
  top_percentile     numeric(5, 4),          -- P2, among A+ users
  computed_at        timestamptz not null default now()
);

-- Users waiting for a recompute; removing a profile removes its entry.
create table private.rank_dirty (
  user_id   uuid primary key references public.profiles on delete cascade,
  marked_at timestamptz not null default now()
);

create index reviews_reviewee_idx on public.reviews (reviewee_id);
create index penalties_user_idx on public.penalties (user_id, expires_at);

-- Section 1.7.3; the app reads the labels.
insert into public.app_config (key, value, public) values ('review_tags', '{
  "positive": [
    {"id": "on_time", "label": "On time"},
    {"id": "as_described", "label": "Item as described"},
    {"id": "friendly", "label": "Friendly"},
    {"id": "fast_replies", "label": "Fast replies"},
    {"id": "fair_price", "label": "Fair price"}
  ],
  "negative": [
    {"id": "late", "label": "Late"},
    {"id": "not_as_described", "label": "Item not as described"},
    {"id": "rude", "label": "Rude"},
    {"id": "slow_replies", "label": "Slow replies"},
    {"id": "pushy_price", "label": "Pushy about price"}
  ]
}', true)
on conflict (key) do nothing;

-- Helpers ------------------------------------------------------------------------------------------

create function private.mark_rank_dirty(variadic p_users uuid[]) returns void
language sql security definer set search_path = '' as $$
  insert into private.rank_dirty (user_id) select distinct unnest(p_users)
  on conflict (user_id) do update set marked_at = now();
$$;

-- The grade for a user's inputs (1.7.1, 4.12): C at the C penalty threshold; otherwise B− at the B−
-- penalty threshold or a rating below the B− rating after enough reviews; otherwise the highest grade
-- whose every requirement holds; B otherwise. Progress is the least-met requirement of the next grade.
create function private.rank_grade(p_trades int, p_partners int, p_reviews int, p_rating numeric, p_age_days int,
                                   p_penalty int, p_rules jsonb, out tier public.tier, out progress numeric)
language plpgsql stable set search_path = '' as $$
declare
  g    jsonb;
  next jsonb;
begin
  if p_penalty >= (p_rules ->> 'c_penalty_points')::int then
    tier := 'c';
  elsif p_penalty >= (p_rules #>> '{b_minus,penalty_points}')::int
        or (p_reviews >= (p_rules #>> '{b_minus,min_reviews}')::int and p_rating < (p_rules #>> '{b_minus,rating_below}')::numeric) then
    tier := 'b_minus';
  else
    tier := 'b';
    for g in select * from jsonb_array_elements(p_rules -> 'grades') loop
      if p_trades >= (g ->> 'trades')::int and p_partners >= (g ->> 'partners')::int
         and p_rating >= (g ->> 'rating')::numeric and p_age_days >= (g ->> 'age_days')::int
         and p_penalty <= (g ->> 'max_penalty')::int then
        tier := greatest(tier, (g ->> 'grade')::public.tier);
      end if;
    end loop;
  end if;

  select x into next from jsonb_array_elements(p_rules -> 'grades') x
  where (x ->> 'grade')::public.tier > tier order by (x ->> 'grade')::public.tier limit 1;
  progress := case
    when next is null then 1
    when p_penalty > (next ->> 'max_penalty')::int then 0
    else round(least(1,
      p_trades::numeric / greatest((next ->> 'trades')::int, 1),
      p_partners::numeric / greatest((next ->> 'partners')::int, 1),
      p_rating / (next ->> 'rating')::numeric,
      p_age_days::numeric / greatest((next ->> 'age_days')::int, 1)), 3)
  end;
end;
$$;

-- Rebuilds rank_stats from source for due users and copies the grade to profiles.tier (4.12). Due:
-- marked dirty, or a penalty expired or an account-age threshold passed since the last computation,
-- since those change a grade without any event. Recomputing from source gives the same answer however
-- often it runs.
create function private.rank_recompute() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_rules jsonb := (select value from public.app_config where key = 'rank_rules');
  v_user  uuid;
  v_count int := 0;
  v_stats record;
  v_grade record;
  v_reply numeric;
  v_rating numeric;
begin
  if not pg_try_advisory_xact_lock(hashtext('rank-recompute')) then
    return 0;
  end if;

  insert into private.rank_dirty (user_id)
  select s.user_id from public.rank_stats s
  where exists (select 1 from public.penalties p
                where p.user_id = s.user_id and p.expires_at > s.computed_at and p.expires_at <= now())
     or exists (select 1 from public.profiles pr, jsonb_array_elements(v_rules -> 'grades') g
                where pr.id = s.user_id
                  and pr.created_at + make_interval(days => (g ->> 'age_days')::int) between s.computed_at and now())
  on conflict (user_id) do nothing;

  -- ponytail: 500 users per run; loop within the run if that is ever short.
  for v_user in select user_id from private.rank_dirty order by marked_at limit 500 for update skip locked loop
    -- One bad row must not hold back the rest; it stays queued and warns on every run.
    begin
      select
        count(*) filter (where t.counted)::int as counted_trades,
        count(distinct t.partner) filter (where t.counted)::int as distinct_partners,
        (select count(*)::int from public.reviews r where r.reviewee_id = v_user) as reviews_count,
        (select coalesce(sum(r.rating), 0) from public.reviews r where r.reviewee_id = v_user) as rating_sum,
        (select coalesce(sum(p.points), 0)::int from public.penalties p
         where p.user_id = v_user and p.revoked_at is null and p.expires_at > now()) as penalty_points,
        (select extract(day from now() - pr.created_at)::int from public.profiles pr where pr.id = v_user) as age_days
      into v_stats
      from (select case when tr.seller_id = v_user then tr.buyer_id else tr.seller_id end as partner,
                   (tr.seller_id = v_user and tr.counted_seller) or (tr.buyer_id = v_user and tr.counted_buyer) as counted
            from public.trades tr
            where tr.status = 'completed' and v_user in (tr.seller_id, tr.buyer_id)) t;

      -- Median minutes to the first reply as the listing owner over 90 days (the score's reply factor).
      select percentile_cont(0.5) within group (order by extract(epoch from first_reply - first_ask) / 60) into v_reply
      from (select (select min(m.created_at) from public.messages m where m.chat_id = c.id and m.sender_id = c.member_id) as first_ask,
                   (select min(m.created_at) from public.messages m where m.chat_id = c.id and m.sender_id = c.owner_id) as first_reply
            from public.chats c
            where c.owner_id = v_user and c.created_at > now() - interval '90 days') x
      where first_reply > first_ask;

      -- Bayesian rating: (prior x weight + sum of ratings) / (weight + reviews).
      v_rating := ((v_rules ->> 'rating_prior')::numeric * (v_rules ->> 'rating_weight')::numeric + v_stats.rating_sum)
                  / ((v_rules ->> 'rating_weight')::numeric + v_stats.reviews_count);
      select * into v_grade from private.rank_grade(v_stats.counted_trades, v_stats.distinct_partners, v_stats.reviews_count,
                                                    v_rating, v_stats.age_days, v_stats.penalty_points, v_rules);

      insert into public.rank_stats (user_id, counted_trades, distinct_partners, reviews_count, rating_bayes, penalty_points,
                                     account_age_days, score, tier, next_tier_progress, computed_at)
      values (v_user, v_stats.counted_trades, v_stats.distinct_partners, v_stats.reviews_count, round(v_rating, 3),
              v_stats.penalty_points, v_stats.age_days,
              v_stats.counted_trades * v_rating
                * case when v_reply <= (v_rules #>> '{reply_factor,fast_minutes}')::numeric
                       then (v_rules #>> '{reply_factor,fast}')::numeric else (v_rules #>> '{reply_factor,default}')::numeric end,
              v_grade.tier, v_grade.progress, now())
      on conflict (user_id) do update set
        counted_trades = excluded.counted_trades, distinct_partners = excluded.distinct_partners,
        reviews_count = excluded.reviews_count, rating_bayes = excluded.rating_bayes,
        penalty_points = excluded.penalty_points, account_age_days = excluded.account_age_days, score = excluded.score,
        tier = excluded.tier, next_tier_progress = excluded.next_tier_progress, computed_at = excluded.computed_at;
      update public.profiles set tier = v_grade.tier where id = v_user and tier is distinct from v_grade.tier;
      delete from private.rank_dirty where user_id = v_user;
      v_count := v_count + 1;
    exception when others then
      raise warning 'rank-recompute: user % failed: %', v_user, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

-- Completion (replaces DB-9): both sides are marked for recompute.
create or replace function private.complete_trade(p_trade_id uuid, p_actor uuid) returns boolean
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

  perform private.mark_rank_dirty(v_trade.seller_id, v_trade.buyer_id);
  perform private.trade_event(p_trade_id, p_actor);
  return true;
end;
$$;

-- Cancel (replaces DB-9): a late cancel records the canceller's penalty, once per trade.
create or replace function public.cancel_trade(p_trade_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user(true);
  v_trade public.trades := private.party_trade(p_trade_id, v_uid);
  v_rules jsonb := (select value from public.app_config where key = 'rank_rules');
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
  if now() > v_trade.meet_at - interval '2 hours' then
    insert into public.penalties (user_id, reason, points, source_type, source_id, expires_at)
    values (v_uid, 'late_cancel', (v_rules #>> '{penalties,late_cancel}')::int, 'trade', p_trade_id,
            now() + make_interval(days => (v_rules ->> 'penalty_window_days')::int))
    on conflict do nothing;
    perform private.mark_rank_dirty(v_uid);
  end if;
  perform private.trade_event(p_trade_id, v_uid);
  return jsonb_build_object('trade', private.trade_json(p_trade_id),
                            'late_cancel_penalty', now() > v_trade.meet_at - interval '2 hours');
end;
$$;

-- REP-1: each side reviews a completed trade once, within 14 days, with tags from the configured list.
-- points_awarded stays 0 until DB-12.
create function public.submit_review(p_trade_id uuid, p_rating int, p_tags text[], p_comment text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_user();
  v_trade  public.trades := private.party_trade(p_trade_id, v_uid);
  v_tags   text[] := coalesce(p_tags, '{}');
  v_review public.reviews;
begin
  if v_trade.status <> 'completed' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  elsif now() > v_trade.completed_at + interval '14 days' then
    raise exception using errcode = 'P0001', message = 'WINDOW_CLOSED';
  end if;
  if coalesce(p_rating, 0) not between 1 and 5 then
    perform private.fail('VALIDATION_FAILED', 'rating');
  end if;
  if cardinality(v_tags) <> (select count(distinct t) from unnest(v_tags) t)
     or exists (select 1 from unnest(v_tags) t
                where t not in (select x ->> 'id' from public.app_config c,
                                     jsonb_array_elements((c.value -> 'positive') || (c.value -> 'negative')) x
                                where c.key = 'review_tags')) then
    perform private.fail('VALIDATION_FAILED', 'tags');
  end if;
  if char_length(p_comment) > 500 then
    perform private.fail('VALIDATION_FAILED', 'comment');
  elsif private.prohibited_term(p_comment) is not null then
    perform private.fail('PROHIBITED_CONTENT', 'comment');
  end if;

  insert into public.reviews (trade_id, reviewer_id, reviewee_id, rating, tags, comment)
  values (p_trade_id, v_uid, case when v_uid = v_trade.seller_id then v_trade.buyer_id else v_trade.seller_id end,
          p_rating, v_tags, nullif(btrim(p_comment), ''))
  on conflict (trade_id, reviewer_id) do nothing
  returning * into v_review;
  if not found then
    raise exception using errcode = 'P0001', message = 'ALREADY_EXISTS';
  end if;
  perform private.mark_rank_dirty(v_review.reviewee_id);
  return jsonb_build_object('review', to_jsonb(v_review), 'points_awarded', 0);
end;
$$;

-- Row-level security -------------------------------------------------------------------------------
-- No write policies: reviews come through submit_review, penalties and grades from the server.

alter table public.reviews    enable row level security;
alter table public.penalties  enable row level security;
alter table public.rank_stats enable row level security;

create policy reviews_select on public.reviews for select to authenticated
using ((select auth.uid()) in (reviewer_id, reviewee_id));
create policy penalties_select on public.penalties for select to authenticated
using (user_id = (select auth.uid()));
create policy rank_stats_select on public.rank_stats for select to authenticated
using (user_id = (select auth.uid()));

-- Grants and schedule ------------------------------------------------------------------------------

revoke execute on function
  private.mark_rank_dirty(uuid[]),
  private.rank_grade(int, int, int, numeric, int, int, jsonb),
  private.rank_recompute()
from public, anon, authenticated;

revoke execute on function public.submit_review(uuid, int, text[], text) from public, anon;
grant execute on function public.submit_review(uuid, int, text[], text) to authenticated;

select cron.schedule('rank-recompute', '*/5 * * * *', 'select private.rank_recompute()');
