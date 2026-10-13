-- RLS matrix for campus and identity tables (spec 4.6.4, 4.6.5, 4.23).
begin;
\ir _helpers.psql
select plan(19);
select tests.build_matrix();

-- my_live_campus_id: only active students of a live campus have one.
select tests.login_as(tests.user_id('alpha1'));
select is(private.my_live_campus_id(), (select campus_id from public.profiles where id = tests.user_id('alpha1')), 'student of a live campus has a live campus');
select tests.login_as(tests.user_id('alpha2'));
select isnt(private.my_live_campus_id(), null, 'subdomain email maps to the campus');
select tests.login_as(tests.user_id('gamma1'));
select is(private.my_live_campus_id(), null, 'waitlist student has no live campus');
select tests.login_as(tests.user_id('general1'));
select is(private.my_live_campus_id(), null, 'general user has no live campus');
select tests.login_as(tests.user_id('suspended'));
select is(private.my_live_campus_id(), null, 'suspended student has no live campus');
select tests.login_as(tests.user_id('banned'));
select is(private.my_live_campus_id(), null, 'banned student has no live campus');

-- Profiles: active, onboarded profiles are public to signed-in users; own row always.
select tests.login_as(tests.user_id('beta1'));
select set_eq(
  $$ select display_name from public.profiles where display_name is not null $$,
  array['alpha1', 'alpha2', 'beta1', 'gamma1', 'general1'],
  'others see active profiles at every campus, not suspended or banned ones'
);
select tests.login_as(tests.user_id('banned'));
select is((select count(*)::int from public.profiles where id = tests.user_id('banned')), 1, 'a banned user still sees their own profile');

reset role;
select tests.create_user('fresh@alpha.edu');
select tests.login_as(tests.user_id('alpha1'));
select is((select count(*)::int from public.profiles where display_name is null), 0, 'profiles before onboarding are hidden from others');

-- Writes go through functions only.
select tests.login_as(tests.user_id('alpha1'));
update public.profiles set tier = 'a_plus' where id = tests.user_id('alpha1');
select is((select tier::text from public.profiles where id = tests.user_id('alpha1')), 'b', 'users cannot update their profile directly');
select throws_ok(
  $$ insert into public.user_roles (user_id, role) values (tests.user_id('alpha1'), 'super_admin') $$,
  '42501', null, 'users cannot grant themselves a role'
);

-- Private identity data is out of reach.
select throws_ok($$ select * from private.accounts $$, '42501', null, 'accounts are not readable');

-- Own-row tables.
select tests.login_as(tests.user_id('alpha2'));
select set_eq($$ select user_id from public.user_settings $$, array[tests.user_id('alpha2')], 'settings: own row only');
select is_empty($$ select 1 from public.consents where user_id <> tests.user_id('alpha2') $$, 'consents: own row only');

-- Campus data.
select isnt_empty($$ select 1 from public.campuses where slug = 'gamma' $$, 'campuses are readable');
select is_empty($$ select 1 from public.campus_domains $$, 'campus domains are not readable');

reset role;
insert into public.app_config (key, value, public) values ('min_app_version', '"1.0.0"', true), ('rank_rules', '{}', false);
select tests.login_as(tests.user_id('alpha1'));
select set_eq($$ select key from public.app_config where key in ('min_app_version', 'rank_rules') $$, array['min_app_version'], 'only public config is readable');

select tests.login_anon();
select set_eq($$ select key from public.app_config where key in ('min_app_version', 'rank_rules') $$, array['min_app_version'], 'signed-out app reads public config');
select is_empty($$ select 1 from public.campuses $$, 'signed-out users read no campuses');

select * from finish();
rollback;
