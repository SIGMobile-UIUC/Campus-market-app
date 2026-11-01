-- Nickname changes (APP-22, spec 4.13.3): free in the first week, then 300 points and a 30-day cooldown.
begin;
\ir _helpers.psql
select plan(6);
select tests.build_matrix();

select tests.login_as(tests.user_id('alpha1'));
select is(public.change_display_name('maple_23', gen_random_uuid()) ->> 'points_spent', '0', 'the first change in the first week is free');
select throws_ok($$ select public.change_display_name('maple_24', gen_random_uuid()) $$, 'P0001', 'COOLDOWN_ACTIVE', 'then once per 30 days');
reset role;
update public.profiles set display_name_changed_at = now() - interval '31 days' where id = tests.user_id('alpha1');
select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.change_display_name('maple_24', gen_random_uuid()) $$, 'P0001', 'INSUFFICIENT_POINTS', 'later changes cost points');
reset role;
update public.wallets set balance = 500 where user_id = tests.user_id('alpha1');
select tests.remember('req', gen_random_uuid());
select tests.login_as(tests.user_id('alpha1'));
select is(public.change_display_name('maple_24', tests.id('req')) - 'display_name', '{"points_spent": 300, "balance": 200}', '300 points');
select is(public.change_display_name('maple_25', tests.id('req')) ->> 'display_name', 'maple_24', 'a retried request changes nothing more');
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.change_display_name('MAPLE_24', gen_random_uuid()) $$, 'P0001', 'ALREADY_EXISTS', 'names are unique regardless of case');

select * from finish();
rollback;
