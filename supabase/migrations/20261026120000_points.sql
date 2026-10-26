-- DB-12: wallets, the points ledger, earning and spending (spec 1.7.2, 2.5, 4.13, 5.3.9, 6.8). award_points
-- with the daily cap and per-source limits; trade, review and check-in awards; the item shop with
-- purchase_item and equip_item. Reversals join with disputes (DB-14); pets are P1.

create type public.ledger_kind as enum ('earn', 'spend', 'reversal', 'refund', 'correction');

create table public.wallets (
  user_id    uuid primary key references public.profiles on delete cascade,
  balance    integer not null default 0,     -- may be negative after reversals
  updated_at timestamptz not null default now()
);

create table public.points_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles on delete cascade,
  kind          public.ledger_kind not null,
  source        text not null,               -- e.g. trade_seller, checkin, shop
  ref_id        text not null,               -- idempotency reference within the source
  delta         integer not null check (delta <> 0),
  balance_after integer not null,
  reversal_of   bigint unique references public.points_ledger,
  actor_id      uuid references public.profiles,   -- admin for corrections and reversals
  note          text,
  created_at    timestamptz not null default now(),
  unique (user_id, source, ref_id),
  check ((kind = 'reversal') = (reversal_of is not null)),
  check (kind not in ('earn', 'refund') or delta > 0),
  check (kind <> 'spend' or delta < 0)
);

create table public.purchases (
  id         uuid primary key,                    -- client purchase id, makes retries idempotent
  user_id    uuid not null references public.profiles on delete cascade,
  item_id    uuid not null references public.shop_items,
  price      integer not null,
  ledger_id  bigint not null unique references public.points_ledger,
  created_at timestamptz not null default now()
);

create table public.checkins (
  user_id    uuid not null references public.profiles on delete cascade,
  local_date date not null,
  streak     integer not null,
  primary key (user_id, local_date)
);

create index points_ledger_user_idx on public.points_ledger (user_id, id desc);

-- Every profile has a wallet; existing ones get theirs here.
create function private.create_wallet() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.wallets (user_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
create trigger profiles_wallet after insert on public.profiles for each row execute function private.create_wallet();
insert into public.wallets (user_id) select id from public.profiles on conflict do nothing;

-- Shop items for sale, priced by rarity (1.7.2). Starter items stay granted only (active = false).
insert into public.shop_items (sku, slot, name, rarity, price, min_tier, asset_key) values
  ('bg_sand',          'background', 'Sand',         'common', 150,  null,     'bg_sand'),
  ('bg_slate',         'background', 'Slate',        'common', 150,  null,     'bg_slate'),
  ('bg_night',         'background', 'Night sky',    'rare',   400,  null,     'bg_night'),
  ('bg_gold',          'background', 'Gold',         'epic',   1000, 'b_plus', 'bg_gold'),
  ('top_hoodie_black', 'top',        'Black hoodie', 'common', 150,  null,     'top_hoodie_black'),
  ('top_tee_yellow',   'top',        'Yellow tee',   'common', 150,  null,     'top_tee_yellow'),
  ('top_sweater_navy', 'top',        'Navy sweater', 'rare',   400,  null,     'top_sweater_navy'),
  ('top_hoodie_gold',  'top',        'Gold hoodie',  'epic',   1000, 'b_plus', 'top_hoodie_gold')
on conflict (sku) do nothing;

-- Earning ------------------------------------------------------------------------------------------

-- Awards p_source points (or p_points) to the user once per p_ref, within the source's daily limit and
-- the daily cap, both counted from the user's local midnight (4.13.2). Sources outside the cap neither
-- stop at it nor use it up. The wallet row lock serializes a user's awards, so the limits hold under
-- concurrency. A negative balance is paid down first.
create function private.award_points(p_user uuid, p_source text, p_ref text, p_points int default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_rules        jsonb := (select value from public.app_config where key = 'points_rules');
  v_rule         jsonb := v_rules -> 'earn' -> p_source;
  v_grant        int := coalesce(p_points, (v_rule ->> 'points')::int);
  v_balance      int;
  v_day          timestamptz;
  v_today        int;
  v_source_today int;
begin
  if coalesce(v_grant, 0) <= 0 then
    return 0;
  end if;
  select w.balance, date_trunc('day', now() at time zone p.timezone) at time zone p.timezone
  into v_balance, v_day
  from public.wallets w join public.profiles p on p.id = w.user_id
  where w.user_id = p_user
  for update of w;

  select coalesce(sum(delta) filter (where kind = 'earn'
                                       and not coalesce((v_rules -> 'earn' -> source ->> 'outside_cap')::boolean, false)), 0),
         count(*) filter (where kind = 'earn' and source = p_source)
  into v_today, v_source_today
  from public.points_ledger where user_id = p_user and created_at >= v_day;

  if (v_rule ->> 'max_per_day') is not null and v_source_today >= (v_rule ->> 'max_per_day')::int then
    return 0;
  end if;
  if not coalesce((v_rule ->> 'outside_cap')::boolean, false) then
    v_grant := least(v_grant, greatest((v_rules ->> 'daily_cap')::int - v_today, 0));
  end if;
  if v_grant = 0 then
    return 0;
  end if;

  insert into public.points_ledger (user_id, kind, source, ref_id, delta, balance_after)
  values (p_user, 'earn', p_source, p_ref, v_grant, v_balance + v_grant)
  on conflict (user_id, source, ref_id) do nothing;
  if not found then
    return 0;
  end if;
  update public.wallets set balance = balance + v_grant, updated_at = now() where user_id = p_user;
  return v_grant;
end;
$$;

-- What the user earned in the current transaction, for the points_awarded of a call.
create function private.points_awarded_now(p_user uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(delta), 0)::int from public.points_ledger
  where user_id = p_user and kind = 'earn' and created_at = now();
$$;

-- Counted trades earn (1.7.2): the seller 50 for a paid trade, the giver 30 for a free one, the buyer 30;
-- each side's first counted trade adds 100 outside the cap. Runs when completion sets the counted flags.
create function private.award_trade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.counted_seller and not old.counted_seller then
    perform private.award_points(new.seller_id,
                                 case when new.total_cents > 0 then 'trade_seller' else 'trade_giver' end, new.id::text);
    perform private.award_points(new.seller_id, 'first_trade', 'first');
  end if;
  if new.counted_buyer and not old.counted_buyer then
    perform private.award_points(new.buyer_id, 'trade_buyer', new.id::text);
    perform private.award_points(new.buyer_id, 'first_trade', 'first');
  end if;
  return null;
end;
$$;
create trigger trades_award after update of counted_seller, counted_buyer on public.trades
for each row execute function private.award_trade();

-- A written review earns 10, once per trade.
create function private.award_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.award_points(new.reviewer_id, 'review', new.trade_id::text);
  return null;
end;
$$;
create trigger reviews_award after insert on public.reviews for each row execute function private.award_review();

-- PTS-7: one check-in per local day; 5 points, 20 more on every 7th day in a row.
create function public.check_in() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_user();
  v_rule   jsonb := (select value -> 'earn' -> 'checkin' from public.app_config where key = 'points_rules');
  v_today  date := (select (now() at time zone timezone)::date from public.profiles where id = v_uid);
  v_streak int;
begin
  insert into public.checkins (user_id, local_date, streak)
  values (v_uid, v_today,
          coalesce((select streak from public.checkins where user_id = v_uid and local_date = v_today - 1), 0) + 1)
  on conflict do nothing
  returning streak into v_streak;
  if not found then
    return jsonb_build_object('checked_in', false, 'points_awarded', 0,
      'streak', (select streak from public.checkins where user_id = v_uid and local_date = v_today));
  end if;
  return jsonb_build_object('checked_in', true, 'streak', v_streak,
    'points_awarded', private.award_points(v_uid, 'checkin', v_today::text,
      (v_rule ->> 'points')::int
        + case when v_streak % (v_rule ->> 'streak_every')::int = 0 then (v_rule ->> 'streak_bonus')::int else 0 end));
end;
$$;

-- Spending -----------------------------------------------------------------------------------------

-- PTS-5: buys a shop item. A retried purchase id returns the stored purchase; the balance check also
-- refuses while the balance is negative (4.13.3); a non-consumable already owned fails, and the inventory
-- key stops two concurrent purchases of one.
create function public.purchase_item(p_item_id uuid, p_purchase_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := private.require_user();
  v_item     public.shop_items;
  v_profile  public.profiles;
  v_balance  int;
  v_ledger   bigint;
  v_purchase public.purchases;
begin
  if p_purchase_id is null then
    perform private.fail('VALIDATION_FAILED', 'purchase_id');
  end if;
  select * into v_purchase from public.purchases where id = p_purchase_id and user_id = v_uid;
  if found then
    return jsonb_build_object('purchase', to_jsonb(v_purchase),
                              'balance', (select balance from public.wallets where user_id = v_uid));
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  select * into v_item from public.shop_items where id = p_item_id;
  if not found or not v_item.active or now() < coalesce(v_item.available_from, '-infinity')
     or now() > coalesce(v_item.available_until, 'infinity')
     or (v_item.campus_id is not null and v_item.campus_id is distinct from v_profile.campus_id) then
    raise exception using errcode = 'P0001', message = 'ITEM_NOT_FOR_SALE';
  elsif v_item.min_tier is not null and v_profile.tier < v_item.min_tier then
    raise exception using errcode = 'P0001', message = 'TIER_REQUIRED';
  elsif not v_item.consumable and exists (select 1 from public.inventory where user_id = v_uid and item_id = p_item_id) then
    raise exception using errcode = 'P0001', message = 'ALREADY_OWNED';
  end if;

  update public.wallets set balance = balance - v_item.price, updated_at = now()
  where user_id = v_uid and balance >= v_item.price
  returning balance into v_balance;
  if not found then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_POINTS';
  end if;
  insert into public.points_ledger (user_id, kind, source, ref_id, delta, balance_after)
  values (v_uid, 'spend', 'shop', p_purchase_id::text, -v_item.price, v_balance)
  returning id into v_ledger;
  insert into public.purchases (id, user_id, item_id, price, ledger_id)
  values (p_purchase_id, v_uid, p_item_id, v_item.price, v_ledger)
  returning * into v_purchase;
  if v_item.consumable then
    insert into public.inventory (user_id, item_id) values (v_uid, p_item_id)
    on conflict (user_id, item_id) do update set quantity = public.inventory.quantity + 1;
  else
    begin
      insert into public.inventory (user_id, item_id) values (v_uid, p_item_id);
    exception when unique_violation then
      raise exception using errcode = 'P0001', message = 'ALREADY_OWNED';
    end;
  end if;
  return jsonb_build_object('purchase', to_jsonb(v_purchase), 'balance', v_balance);
end;
$$;

-- PTS-6: one owned item per slot; a null item takes the slot off. Returns the loadout by slot.
create function public.equip_item(p_slot public.item_slot, p_item_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(true);
begin
  if p_slot = 'pet_treat' then
    perform private.fail('VALIDATION_FAILED', 'slot');
  end if;
  if p_item_id is null then
    delete from public.avatar_loadout where user_id = v_uid and slot = p_slot;
  else
    if not exists (select 1 from public.inventory where user_id = v_uid and item_id = p_item_id and quantity > 0) then
      raise exception using errcode = 'P0001', message = 'FORBIDDEN';
    elsif (select slot from public.shop_items where id = p_item_id) is distinct from p_slot then
      perform private.fail('VALIDATION_FAILED', 'slot');
    end if;
    insert into public.avatar_loadout (user_id, slot, item_id) values (v_uid, p_slot, p_item_id)
    on conflict (user_id, slot) do update set item_id = excluded.item_id;
  end if;
  return coalesce((select jsonb_object_agg(l.slot, i.asset_key) from public.avatar_loadout l
                   join public.shop_items i on i.id = l.item_id where l.user_id = v_uid), '{}');
end;
$$;

-- Reading ------------------------------------------------------------------------------------------

-- A definer so the cap comes from the rules, which stay server-side. earned_today is what counts
-- toward the cap.
create function public.get_wallet() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select p.id, p.timezone from public.profiles p where p.id = private.require_user(true)),
       rules as (select value from public.app_config where key = 'points_rules')
  select jsonb_build_object(
    'balance', coalesce((select w.balance from public.wallets w, me where w.user_id = me.id), 0),
    'earned_today', coalesce((select sum(l.delta) from public.points_ledger l, me, rules
                              where l.user_id = me.id and l.kind = 'earn'
                                and not coalesce((rules.value -> 'earn' -> l.source ->> 'outside_cap')::boolean, false)
                                and l.created_at >= date_trunc('day', now() at time zone me.timezone) at time zone me.timezone), 0),
    'daily_cap', (select (value ->> 'daily_cap')::int from rules));
$$;

-- Newest first; the cursor is the last row's id.
create function public.points_history(p_cursor bigint default null, p_limit int default 30) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('rows', coalesce(jsonb_agg(r order by r.id desc), '[]'),
                            'next_cursor', case when count(*) = least(greatest(coalesce(p_limit, 30), 1), 100) then min(r.id) end)
  from (
    select l.id, l.kind, l.source, l.delta, l.balance_after, l.created_at,
           case l.source
             when 'trade_seller' then 'Sold an item'
             when 'trade_buyer'  then 'Bought an item'
             when 'trade_giver'  then 'Gave an item away'
             when 'first_trade'  then 'First trade bonus'
             when 'review'       then 'Wrote a review'
             when 'checkin'      then 'Daily check-in'
             when 'shop'         then 'Shop purchase'
             else initcap(replace(l.source, '_', ' '))
           end as label
    from public.points_ledger l
    where l.user_id = (select auth.uid()) and (p_cursor is null or l.id < p_cursor)
    order by l.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100)
  ) r;
$$;

-- points_awarded now reports what the call earned (replaces DB-9 and DB-11).
create or replace function public.confirm_trade(p_trade_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user();
  v_trade     public.trades := private.party_trade(p_trade_id, v_uid);
  v_completed boolean := false;
begin
  if v_trade.status = 'completed' then
    return jsonb_build_object('trade', private.trade_json(p_trade_id), 'completed', true, 'points_awarded', private.points_awarded_now(v_uid));
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
  return jsonb_build_object('trade', private.trade_json(p_trade_id), 'completed', v_completed, 'points_awarded', private.points_awarded_now(v_uid));
end;
$$;

create or replace function public.submit_review(p_trade_id uuid, p_rating int, p_tags text[], p_comment text) returns jsonb
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
  return jsonb_build_object('review', to_jsonb(v_review), 'points_awarded', private.points_awarded_now(v_uid));
end;
$$;

-- Row-level security and grants ---------------------------------------------------------------------
-- Users read their own wallet, ledger, purchases and check-ins; every write goes through the functions.

alter table public.wallets       enable row level security;
alter table public.points_ledger enable row level security;
alter table public.purchases     enable row level security;
alter table public.checkins      enable row level security;
create policy wallets_select       on public.wallets       for select to authenticated using (user_id = (select auth.uid()));
create policy points_ledger_select on public.points_ledger for select to authenticated using (user_id = (select auth.uid()));
create policy purchases_select     on public.purchases     for select to authenticated using (user_id = (select auth.uid()));
create policy checkins_select      on public.checkins      for select to authenticated using (user_id = (select auth.uid()));

revoke execute on function
  private.create_wallet(), private.award_points(uuid, text, text, int), private.points_awarded_now(uuid),
  private.award_trade(), private.award_review()
from public, anon, authenticated;

revoke execute on function
  public.check_in(), public.purchase_item(uuid, uuid), public.equip_item(public.item_slot, uuid),
  public.get_wallet(), public.points_history(bigint, int)
from public, anon;
grant execute on function
  public.check_in(), public.purchase_item(uuid, uuid), public.equip_item(public.item_slot, uuid),
  public.get_wallet(), public.points_history(bigint, int)
to authenticated;
