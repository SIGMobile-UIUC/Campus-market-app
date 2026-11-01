-- Public profile (ACC-4) and public counts: who can be seen, what is shown, reply time and offer counts.
begin;
\ir _helpers.psql
select plan(7);
select tests.build_matrix();

-- alpha1 owns a listing and answers three chats after 10, 20 and 60 minutes; alpha2 reviews them.
select tests.remember('desk', tests.create_listing_as('alpha1'));
do $$
declare
  v_chat uuid;
  v_minutes int;
begin
  foreach v_minutes in array array[10, 20, 60] loop
    insert into public.chats (listing_id, owner_id, member_id, created_at)
    values (tests.id('desk'), tests.user_id('alpha1'), tests.user_id('alpha2'), now() - interval '2 days')
    returning id into v_chat;
    insert into public.messages (chat_id, seq, sender_id, kind, body, client_id, created_at) values
      (v_chat, 1, tests.user_id('alpha2'), 'text', 'Hi', gen_random_uuid(), now() - interval '1 day'),
      (v_chat, 2, tests.user_id('alpha1'), 'text', 'Hello', gen_random_uuid(), now() - interval '1 day' + make_interval(mins => v_minutes));
    update public.chats set closed_at = now() where id = v_chat;
  end loop;
end;
$$;
with t as (
  insert into public.trades (request_id, listing_id, chat_id, seller_id, buyer_id, proposed_by, status, total_cents, meet_at)
  select gen_random_uuid(), tests.id('desk'), c.id, tests.user_id('alpha1'), tests.user_id('alpha2'), tests.user_id('alpha2'),
         'completed', 4000, now() - interval '1 day'
  from public.chats c limit 1
  returning id)
insert into public.reviews (trade_id, reviewer_id, reviewee_id, rating, tags)
select id, tests.user_id('alpha2'), tests.user_id('alpha1'), 4, array['on_time', 'rude'] from t;
insert into public.rank_stats (user_id, counted_trades, distinct_partners, reviews_count, rating_bayes, penalty_points,
                               account_age_days, score, tier, next_tier_progress)
values (tests.user_id('alpha1'), 4, 3, 2, 4.5, 0, 30, 0, 'b', 0);

select tests.login_as(tests.user_id('beta1'));
select is(public.public_profile(tests.user_id('alpha1')) - 'member_since' - 'avatar' - 'tags' - 'id',
  jsonb_build_object('display_name', 'alpha1', 'tier', 'b', 'campus', jsonb_build_object('short_name', null, 'name', 'Alpha University'),
                     'trades', 4, 'reply_minutes', 20),
  'anyone signed in sees the nickname, grade, school, trade count and median reply time');
select is(public.public_profile(tests.user_id('alpha1')) -> 'tags', '{"on_time": 1}', 'positive review tags only');
select is(public.public_profile(tests.user_id('alpha1')) ? 'email', false, 'never the email');
select throws_ok($$ select public.public_profile(tests.user_id('suspended')) $$, 'P0001', 'NOT_FOUND', 'suspended accounts are hidden');
reset role;
insert into public.blocks (blocker_id, blocked_id) values (tests.user_id('alpha1'), tests.user_id('beta1'));
select tests.login_as(tests.user_id('beta1'));
select throws_ok($$ select public.public_profile(tests.user_id('alpha1')) $$, 'P0001', 'NOT_FOUND', 'a block hides the profile both ways');

-- Offers on a request: declined and withdrawn ones do not count.
reset role;
select tests.remember('want', tests.create_listing_as('alpha2', '{"kind": "wanted", "title": "Need a lamp", "budget_cents": 1500, "items": [], "photos": []}'));
create function tests.offer(p_status public.trade_status) returns void language sql as $$
  insert into public.trades (request_id, listing_id, chat_id, seller_id, buyer_id, proposed_by, status, total_cents, meet_at)
  select gen_random_uuid(), tests.id('want'), c.id, tests.user_id('alpha1'), tests.user_id('alpha2'), tests.user_id('alpha1'), p_status, 1000, now()
  from public.chats c limit 1;
$$;
select tests.offer('proposed'), tests.offer('accepted'), tests.offer('declined'), tests.offer('withdrawn');
select tests.login_as(tests.user_id('beta1'));
select is((select offers from public.offer_counts(array[tests.id('want'), tests.id('desk')])), 2, 'offers count proposals still standing');
reset role;
select is(private.reply_minutes(tests.user_id('alpha2')), null, 'no reply time below 3 chats');

select * from finish();
rollback;
