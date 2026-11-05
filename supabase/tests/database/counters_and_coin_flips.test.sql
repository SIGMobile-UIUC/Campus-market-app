-- Counter offers (TRD-2) and coin flips (CHT-9).
begin;
\ir _helpers.psql
select plan(10);
select tests.build_matrix();

-- alpha2 asks about alpha1's desk and proposes $40; alpha1 counters with $45.
select tests.remember('l1', tests.create_listing_as('alpha1'));
select tests.login_as(tests.user_id('alpha2'));
select tests.remember('c1', (public.get_or_create_chat(tests.id('l1')) ->> 'chat_id')::uuid);
create temp table proposal as
select jsonb_build_object('item_ids', (select jsonb_agg(id) from public.items where listing_id = tests.id('l1')),
                          'total_cents', 4000, 'meet_at', now() + interval '1 day', 'place_text', 'Union') as p;
select tests.remember('t1', (public.propose_trade(tests.id('c1'), (select p from proposal), gen_random_uuid()) ->> 'id')::uuid);

select tests.login_as(tests.user_id('alpha1'));
select tests.remember('r1', gen_random_uuid());
select tests.remember('t2', (public.counter_trade(tests.id('t1'), (select p || '{"total_cents": 4500}' from proposal), tests.id('r1')) ->> 'id')::uuid);
select is((select status::text from public.trades where id = tests.id('t1')), 'declined', 'a counter offer declines the proposal');
select is((select status::text || ' ' || total_cents || ' ' || (proposed_by = tests.user_id('alpha1')) from public.trades where id = tests.id('t2')),
  'proposed 4500 true', 'and proposes the new terms in the same chat');
select is((public.counter_trade(tests.id('t1'), (select p || '{"total_cents": 4500}' from proposal), tests.id('r1')) ->> 'id')::uuid,
  tests.id('t2'), 'a retry returns the same counter offer');

-- Coin flips.
select tests.login_as(tests.user_id('alpha2'));
select tests.remember('f1', public.propose_coin_flip(tests.id('c1')));
select is(public.propose_coin_flip(tests.id('c1')), tests.id('f1'), 'a chat has one open flip at a time');
select throws_ok($$ select public.call_coin_flip(tests.id('f1'), 'heads') $$, 'P0001', 'INVALID_STATE',
  'the proposer cannot call their own flip');

select tests.login_as(tests.user_id('beta1'));
select throws_ok($$ select public.propose_coin_flip(tests.id('c1')) $$, 'P0001', 'NOT_PARTY', 'only the chat parties flip');

select tests.login_as(tests.user_id('alpha1'));
select ok(public.call_coin_flip(tests.id('f1'), 'heads') in ('heads', 'tails'), 'the other side calls and gets a result');
select ok((select meta ->> 'status' = 'flipped' and meta ->> 'call' = 'heads' and meta ->> 'result' in ('heads', 'tails')
           from public.messages where chat_id = tests.id('c1') order by seq desc limit 1),
  'the result is posted to the chat');

select tests.remember('f2', public.propose_coin_flip(tests.id('c1')));
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.cancel_coin_flip(tests.id('f2')) $$, 'P0001', 'INVALID_STATE', 'only the proposer cancels');
select tests.login_as(tests.user_id('alpha1'));
select lives_ok($$ select public.cancel_coin_flip(tests.id('f2')) $$, 'the proposer cancels an open flip');

select * from finish();
rollback;
