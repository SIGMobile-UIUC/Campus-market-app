-- Events (INS-1, INS-2, spec 4.17.4) and the daily-maintenance job (4.19).
begin;
\ir _helpers.psql
select plan(11);
select tests.build_matrix();

insert into public.consents (user_id, analytics, personalized_ads, policy_version)
values (tests.user_id('alpha1'), true, false, 'v1'), (tests.user_id('alpha2'), false, false, 'v1');
create function tests.event(p_name text, p_props jsonb default '{}', p_id uuid default gen_random_uuid(),
                            p_at timestamptz default now()) returns jsonb language sql as $$
  select jsonb_build_object('event_id', p_id, 'session_id', '00000000-0000-4000-8000-000000000001', 'name', p_name,
                            'occurred_at', p_at, 'screen', 'home', 'props', p_props);
$$;
select tests.remember('e1', gen_random_uuid());

select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.log_events(jsonb_build_array(tests.event('sell_start'))) $$, 'P0001', 'FORBIDDEN',
  'nothing is stored without analytics consent');

select tests.login_as(tests.user_id('alpha1'));
select is(public.log_events(jsonb_build_array(
  tests.event('sell_start', '{"kind": "item"}', tests.id('e1'), now() - interval '30 days'),
  tests.event('search', '{"term": "  Mini FRIDGE "}'),
  tests.event('search', '{"term": "call me 217-555-0134"}'),
  tests.event('made_up_event'),
  tests.event('sell_start', '{"secret": 1}'))) ->> 'accepted', '3', 'events outside the catalog are skipped');
select is(public.log_events(jsonb_build_array(tests.event('sell_start', '{"kind": "item"}', tests.id('e1')))) ->> 'accepted', '0',
  'a retried event is stored once');
reset role;
select is((select array_agg(e.props ->> 'term' order by e.props ->> 'term' nulls last) from private.events e where e.name = 'search'),
  array['mini fridge', null], 'search terms are cleaned and identifying ones dropped');
select is((select analytics_id from private.events where event_id = tests.id('e1')),
          (select analytics_id from private.accounts where user_id = tests.user_id('alpha1')), 'events carry the analytics id');
select is((select occurred_at >= received_at - interval '7 days' and account_type = 'student' from private.events where event_id = tests.id('e1')),
  true, 'client time is clamped to the last 7 days and the account type added');

insert into private.events (event_id, occurred_at, analytics_id, session_id, account_type, name)
select gen_random_uuid(), now(), (select analytics_id from private.accounts where user_id = tests.user_id('alpha1')), gen_random_uuid(), 'student', 'screen_view'
from generate_series(1, 1000);
select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.log_events(jsonb_build_array(tests.event('sell_start'))) $$, 'P0001', 'RATE_LIMITED', '1,000 events an hour');

-- daily-maintenance.
reset role;
update private.events set received_at = now() - interval '13 months' where name = 'screen_view';
update private.events set received_at = now() - interval '31 days' where name = 'search';
select tests.create_user('never-confirmed@example.com', false);
update auth.users set created_at = now() - interval '2 days' where email = 'never-confirmed@example.com';
update public.wallets set balance = balance + 5 where user_id = tests.user_id('beta1');
insert into public.penalties (user_id, reason, points, source_type, source_id, expires_at)
values (tests.user_id('gamma1'), 'late_cancel', 1, 'trade', gen_random_uuid(), now() - interval '1 hour');
delete from private.rank_dirty;
create temp table run as select private.daily_maintenance() r;
select is((select (r ->> 'events_deleted')::int >= 1000 and (r ->> 'unconfirmed_users')::int >= 1 from run), true,
  'old events and unconfirmed sign-ups are deleted');
select is((select count(*)::int from private.events where name = 'search' and props ? 'term'), 0, 'search terms are blanked after 30 days');
select is((select (r ->> 'wallet_mismatches')::int >= 1 from run), true, 'a wallet that differs from its ledger is reported');
select ok(exists (select 1 from private.rank_dirty where user_id = tests.user_id('gamma1')), 'an expired penalty queues a regrade');

select * from finish();
rollback;
