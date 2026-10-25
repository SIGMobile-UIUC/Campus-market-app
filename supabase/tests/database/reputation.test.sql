-- Reviews, penalties and trust grades: the grade rule, submit_review, the late-cancel penalty and the
-- rank-recompute job (spec 1.7.1, 4.12, 6.7).
begin;
\ir _helpers.psql
select plan(30);
select tests.build_matrix();

-- The grade rule with the configured values (1.7.1).
create function tests.grade(p_trades int, p_partners int, p_reviews int, p_rating numeric, p_age int, p_penalty int)
returns text language sql as $$
  select g.tier || ' ' || g.progress
  from private.rank_grade(p_trades, p_partners, p_reviews, p_rating, p_age, p_penalty,
                          (select value from public.app_config where key = 'rank_rules')) g;
$$;
select is(tests.grade(0, 0, 0, 4.0, 0, 0), 'b 0.000', 'everyone starts at B');
select is(tests.grade(200, 100, 50, 4.9, 400, 6), 'c 0', '6 penalty points make C whatever else holds');
select is(tests.grade(200, 100, 50, 4.9, 400, 3), 'b_minus 0', '3 penalty points make B−');
select is(tests.grade(0, 0, 5, 3.9, 0, 0), 'b_minus 0.000', 'a rating below 4.0 after 5 reviews makes B−');
select is(tests.grade(0, 0, 4, 3.9, 0, 0) like 'b %', true, 'but not before 5 reviews');
select is(tests.grade(10, 7, 5, 4.3, 30, 2) like 'b_plus %', true, 'B+ when every requirement is met exactly');
select is(tests.grade(10, 6, 5, 4.3, 30, 2) like 'b %', true, 'one requirement short stays B');
select is(tests.grade(30, 20, 20, 4.5, 90, 2) like 'b_plus %', true, 'A− needs at most 1 penalty point');
select is(tests.grade(150, 90, 100, 4.75, 365, 0), 'a_plus 1', 'A+ at its thresholds, with nothing further to reach');
select is(tests.grade(5, 7, 5, 4.3, 30, 0), 'b 0.500', 'progress is the least-met requirement of the next grade');

-- A completed trade between two matrix users; returns its id.
create function tests.completed_trade(p_seller text, p_buyer text, p_title text) returns uuid
language plpgsql as $$
declare
  v_listing uuid := tests.create_listing_as(p_seller, jsonb_build_object('title', p_title));
  v_trade   uuid;
begin
  perform tests.login_as(tests.user_id(p_buyer));
  v_trade := (public.propose_trade((public.get_or_create_chat(v_listing) ->> 'chat_id')::uuid,
    jsonb_build_object('item_ids', (select jsonb_agg(id) from public.items where listing_id = v_listing), 'total_cents', 4000,
                       'meet_at', now() + interval '1 day', 'place_text', 'Union'), gen_random_uuid()) ->> 'id')::uuid;
  perform tests.login_as(tests.user_id(p_seller));
  perform public.accept_trade(v_trade);
  perform set_config('role', 'none', true);
  update public.trades set meet_at = now() - interval '1 hour' where id = v_trade;
  perform tests.login_as(tests.user_id(p_buyer));
  perform public.confirm_trade(v_trade);
  perform tests.login_as(tests.user_id(p_seller));
  perform public.confirm_trade(v_trade);
  perform set_config('role', 'none', true);
  return v_trade;
end;
$$;
select tests.remember('t1', tests.completed_trade('alpha1', 'alpha2', 'Desk lamp'));
select is((select count(*)::int from private.rank_dirty where user_id in (tests.user_id('alpha1'), tests.user_id('alpha2'))), 2,
  'completing a trade queues both sides for recompute');

-- Reviews (REP-1).
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.submit_review(tests.id('t1'), 6, '{}', null) $$, 'P0001', 'VALIDATION_FAILED', 'ratings are 1 to 5');
select throws_ok($$ select public.submit_review(tests.id('t1'), 5, '{on_time,great_guy}', null) $$, 'P0001', 'VALIDATION_FAILED',
  'tags come from the configured list');
select is((public.submit_review(tests.id('t1'), 5, '{on_time,friendly}', 'Smooth pickup') -> 'review' ->> 'reviewee_id')::uuid,
  tests.user_id('alpha1'), 'a buyer reviews the seller');
select throws_ok($$ select public.submit_review(tests.id('t1'), 4, '{}', null) $$, 'P0001', 'ALREADY_EXISTS', 'once per trade');
select tests.login_as(tests.user_id('beta1'));
select throws_ok($$ select public.submit_review(tests.id('t1'), 1, '{rude}', null) $$, 'P0001', 'NOT_PARTY', 'outsiders cannot review');
select is_empty($$ select 1 from public.reviews $$, 'or read reviews');
reset role;
update public.trades set completed_at = now() - interval '15 days' where id = tests.id('t1');
select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.submit_review(tests.id('t1'), 5, '{}', null) $$, 'P0001', 'WINDOW_CLOSED', 'reviews close after 14 days');
select isnt_empty($$ select 1 from public.reviews where reviewee_id = tests.user_id('alpha1') $$, 'the reviewee reads their review');

-- Late cancels (TRD-6, 1.7.1): 1 penalty point for the canceller, once per trade.
select tests.remember('lamp', tests.create_listing_as('alpha1', '{"title": "Floor lamp"}'));
select tests.login_as(tests.user_id('alpha2'));
select tests.remember('t2', (public.propose_trade((public.get_or_create_chat(tests.id('lamp')) ->> 'chat_id')::uuid,
  jsonb_build_object('item_ids', (select jsonb_agg(id) from public.items where listing_id = tests.id('lamp')), 'total_cents', 1000,
                     'meet_at', now() + interval '1 hour', 'place_text', 'Union'), gen_random_uuid()) ->> 'id')::uuid);
select tests.login_as(tests.user_id('alpha1'));
select public.accept_trade(tests.id('t2'));
select tests.login_as(tests.user_id('alpha2'));
select public.cancel_trade(tests.id('t2'), 'Plans changed');
select public.cancel_trade(tests.id('t2'), 'Plans changed');
select is((select string_agg(reason || ' ' || points, ',') from public.penalties where source_id = tests.id('t2')), 'late_cancel 1',
  'a late cancel gives the canceller one penalty point, once');
select is((select count(*)::int from public.penalties), 1, 'users see their own penalties');

-- The rank-recompute job (4.12).
reset role;
select private.rank_recompute();
select is((select counted_trades || ' ' || reviews_count || ' ' || rating_bayes || ' ' || tier from public.rank_stats
           where user_id = tests.user_id('alpha1')), '1 1 4.091 b', 'recompute counts trades and the Bayesian rating');
select is_empty($$ select 1 from private.rank_dirty where user_id in (tests.user_id('alpha1'), tests.user_id('alpha2')) $$,
  'and clears the queue');
insert into public.penalties (user_id, reason, points, source_type, source_id, expires_at)
values (tests.user_id('alpha2'), 'no_show', 3, 'dispute', gen_random_uuid(), now() + interval '90 days'),
       (tests.user_id('alpha2'), 'harassment', 3, 'dispute', gen_random_uuid(), now() + interval '90 days');
select private.mark_rank_dirty(tests.user_id('alpha2'));
select private.rank_recompute();
select is((select tier::text from public.profiles where id = tests.user_id('alpha2')), 'c', 'the grade is copied to the profile');
-- Penalties that expire change the grade without any event.
update public.penalties set expires_at = now() - interval '1 minute' where user_id = tests.user_id('alpha2') and reason <> 'late_cancel';
update public.rank_stats set computed_at = now() - interval '1 hour' where user_id = tests.user_id('alpha2');
select private.rank_recompute();
select is((select tier::text from public.profiles where id = tests.user_id('alpha2')), 'b', 'an expired penalty is noticed and lifts the grade');
-- So does reaching an account-age threshold.
update public.profiles set created_at = now() - interval '31 days' where id = tests.user_id('alpha1');
update public.rank_stats set computed_at = now() - interval '2 days' where user_id = tests.user_id('alpha1');
select private.rank_recompute();
select is((select account_age_days from public.rank_stats where user_id = tests.user_id('alpha1')), 31,
  'passing an account-age threshold triggers a recompute');
select is((select schedule from cron.job where jobname = 'rank-recompute'), '*/5 * * * *', 'the job runs every 5 minutes');
-- A removed profile leaves nothing in the queue for the job to trip over.
select tests.remember('gone', tests.create_user('gone@alpha.edu'));
select private.mark_rank_dirty(tests.id('gone'));
delete from public.profiles where id = tests.id('gone');
select is_empty($$ select 1 from private.rank_dirty where user_id = tests.id('gone') $$, 'removing a profile removes its queue entry');

select tests.login_as(tests.user_id('alpha2'));
select is((select array_agg(user_id) from public.rank_stats), array[tests.user_id('alpha2')], 'users read only their own grade details');
select throws_ok($$ select private.rank_recompute() $$, '42501', null, 'users cannot run the job');

select * from finish();
rollback;
