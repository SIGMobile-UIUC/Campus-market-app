-- Points: wallets, earning with the daily cap and per-source limits, trade, review and check-in awards,
-- the shop and the avatar loadout (spec 1.7.2, 2.5, 4.13, 6.8).
begin;
\ir _helpers.psql
select plan(29);
select tests.build_matrix();

create function tests.balance(p_name text) returns int language sql as $$
  select balance from public.wallets where user_id = tests.user_id(p_name);
$$;
create function tests.award(p_name text, p_source text, p_ref text, p_points int default null) returns int language sql as $$
  select private.award_points(tests.user_id(p_name), p_source, p_ref, p_points);
$$;
create function tests.item(p_sku text) returns uuid language sql as $$ select id from public.shop_items where sku = p_sku; $$;

-- A completed trade of one listing; returns the seller's confirm_trade result.
create function tests.complete(p_seller text, p_buyer text, p_extra jsonb default '{}') returns jsonb
language plpgsql as $$
declare
  v_listing uuid := tests.create_listing_as(p_seller, p_extra);
  v_trade   uuid;
  v_result  jsonb;
begin
  perform tests.login_as(tests.user_id(p_buyer));
  v_trade := (public.propose_trade((public.get_or_create_chat(v_listing) ->> 'chat_id')::uuid,
    jsonb_build_object('item_ids', (select jsonb_agg(id) from public.items where listing_id = v_listing),
                       'total_cents', (select sum(price_cents) from public.items where listing_id = v_listing),
                       'meet_at', now() + interval '1 day', 'place_text', 'Union'), gen_random_uuid()) ->> 'id')::uuid;
  perform tests.login_as(tests.user_id(p_seller));
  perform public.accept_trade(v_trade);
  perform set_config('role', 'none', true);
  update public.trades set meet_at = now() - interval '1 hour' where id = v_trade;
  perform tests.login_as(tests.user_id(p_buyer));
  perform public.confirm_trade(v_trade);
  perform tests.login_as(tests.user_id(p_seller));
  v_result := public.confirm_trade(v_trade);
  perform set_config('role', 'none', true);
  perform tests.remember('trade_' || p_seller || '_' || p_buyer, v_trade);
  return v_result;
end;
$$;

select is((select count(*)::int from public.wallets w join tests.matrix m on m.id = w.user_id), 7, 'every profile has a wallet');
select is((select count(*)::int from public.inventory i join public.shop_items s on s.id = i.item_id
           where i.user_id = tests.user_id('alpha1') and s.slot = 'body'),
          (select count(*)::int from public.shop_items where slot = 'body'), 'every account owns every body');

-- Trades (1.7.2): a paid trade pays the seller 50 and the buyer 30, plus 100 for each side's first counted trade.
select is((tests.complete('alpha1', 'alpha2') ->> 'points_awarded')::int, 150, 'completing a paid trade reports what the completer earned');
select is(tests.balance('alpha1') || ' ' || tests.balance('alpha2'), '150 130', 'seller 50 + 100, buyer 30 + 100');
select is((select string_agg(source, ',' order by source) from public.points_ledger where user_id = tests.user_id('alpha1')),
  'first_trade,trade_seller', 'each award is a ledger row');
select tests.complete('alpha1', 'general1', '{"visibility": "open", "title": "Free lamp",
  "items": [{"name": "Lamp", "price_cents": 0, "condition": "good"}]}');
select is(tests.balance('alpha1') || ' ' || tests.balance('general1'), '180 0', 'a free trade pays the giver 30 and the receiver nothing');

-- Limits (4.13.2). alpha1 has 80 toward the cap: the first-trade bonus does not use it up.
select is(tests.award('alpha1', 'checkin', 'fill', 110) + tests.award('alpha1', 'review', 'r1'), 120,
  'earning continues up to the daily cap');
select is(tests.award('alpha1', 'review', 'r2'), 0, 'the daily cap is 200');
select is(tests.award('gamma1', 'checkin', 'c1', 200) + tests.award('gamma1', 'first_trade', 'first'), 300,
  'the first-trade bonus is paid past the cap');
select is(tests.award('beta1', 'trade_giver', 'g1') + tests.award('beta1', 'trade_giver', 'g2') + tests.award('beta1', 'trade_giver', 'g3')
          + tests.award('beta1', 'trade_giver', 'g4'), 90, 'a source with a daily limit pays at most that many times');
select is(tests.award('suspended', 'review', 'same') + tests.award('suspended', 'review', 'same'), 10, 'the same reference pays once');

-- Reviews. points_awarded counts this transaction's earnings, so the reviewer has earned nothing else here.
select tests.login_as(tests.user_id('general1'));
select is((public.submit_review(tests.id('trade_alpha1_general1'), 5, '{}', null) ->> 'points_awarded')::int, 10, 'a review earns 10');

-- Check-ins (PTS-7).
select tests.login_as(tests.user_id('general1'));
select is(public.check_in() - 'streak', '{"checked_in": true, "points_awarded": 5}', 'a check-in earns 5');
select is(public.check_in(), '{"checked_in": false, "streak": 1, "points_awarded": 0}', 'once per local day');
reset role;
insert into public.checkins (user_id, local_date, streak)
select id, (now() at time zone timezone)::date - 1, 6 from public.profiles where id = tests.user_id('beta1');
select tests.login_as(tests.user_id('beta1'));
select is(public.check_in(), '{"checked_in": true, "streak": 7, "points_awarded": 25}', 'every 7th day in a row adds 20');

-- The shop (PTS-5, 4.13.3).
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.purchase_item(tests.item('bg_gold'), gen_random_uuid()) $$, 'P0001', 'TIER_REQUIRED', 'grade-gated items need the grade');
select throws_ok($$ select public.purchase_item(tests.item('bg_sky'), gen_random_uuid()) $$, 'P0001', 'ITEM_NOT_FOR_SALE', 'starter items are not sold');
select tests.login_as(tests.user_id('alpha1'));
select tests.remember('buy', gen_random_uuid());
select is((public.purchase_item(tests.item('bg_sand'), tests.id('buy')) ->> 'balance')::int, 150, 'a purchase spends the price');
select is((public.purchase_item(tests.item('bg_sand'), tests.id('buy')) ->> 'balance')::int, 150, 'a retried purchase is not charged again');
select throws_ok($$ select public.purchase_item(tests.item('bg_sand'), gen_random_uuid()) $$, 'P0001', 'ALREADY_OWNED', 'an owned item is not sold twice');
select throws_ok($$ select public.purchase_item(tests.item('bg_night'), gen_random_uuid()) $$, 'P0001', 'INSUFFICIENT_POINTS',
  'spending needs the full price');
reset role;
update public.wallets set balance = -10 where user_id = tests.user_id('general1');
select is(tests.award('general1', 'review', 'pay-down') + tests.balance('general1'), 10, 'new earnings pay a negative balance down first');

-- The avatar (PTS-6).
select tests.login_as(tests.user_id('alpha1'));
select is(public.equip_item('background', tests.item('bg_sand')) ->> 'background', 'bg_sand', 'an owned item is equipped in its slot');
select throws_ok($$ select public.equip_item('background', tests.item('bg_slate')) $$, 'P0001', 'FORBIDDEN', 'only owned items');
select throws_ok($$ select public.equip_item('top', tests.item('bg_sand')) $$, 'P0001', 'VALIDATION_FAILED', 'only in their own slot');
select is(public.equip_item('background', null) ? 'background', false, 'a slot can be emptied');

-- Reading (PTS-1).
select is((select count(distinct user_id)::int from public.wallets) + (select count(distinct user_id)::int from public.points_ledger), 2,
  'users read only their own wallet and ledger');
select is(public.get_wallet(), '{"balance": 150, "daily_cap": 200, "earned_today": 200}', 'the wallet shows balance and today''s earnings');
select is((select array_agg(r ->> 'label') from jsonb_array_elements(public.points_history(null, 2) -> 'rows') r),
  array['Shop purchase', 'Wrote a review'], 'history lists the newest changes with labels');

select * from finish();
rollback;
