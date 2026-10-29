-- Profile creation on confirmation and complete_onboarding (spec 4.6.1, 6.3).
begin;
\ir _helpers.psql
select plan(28);
select tests.build_matrix();

-- Campus assignment by email domain.
create function tests.signup_campus(p_email text) returns text
language plpgsql as $$
declare
  v_id uuid := tests.create_user(p_email);
begin
  return (select c.slug from public.profiles p left join public.campuses c on c.id = p.campus_id where p.id = v_id);
end;
$$;

select is(tests.signup_campus('a@alpha.edu'), 'alpha', 'exact domain maps to the campus');
select is(tests.signup_campus('b@mail.cs.alpha.edu'), 'alpha', 'subdomain maps when the domain includes subdomains');
select is(tests.signup_campus('c@cs.beta.edu'), null, 'subdomain does not map when the domain excludes them');
select is(tests.signup_campus('d@fakealpha.edu'), null, 'a look-alike suffix does not map');
select is(tests.signup_campus('e@alpha.edu.evil.com'), null, 'a domain that only starts with the campus domain does not map');
select is(tests.signup_campus('F@GAMMA.EDU'), 'gamma', 'matching ignores case; waitlist schools still assign the campus');

-- Confirmation creates the rows; requesting a code alone does not.
create temp table pending as select tests.create_user('pending@alpha.edu', false) as id;
select is((select count(*)::int from public.profiles where id = (select id from pending)), 0, 'no profile before the email is confirmed');
update auth.users set email_confirmed_at = now() where id = (select id from pending);
select is((select count(*)::int from public.profiles where id = (select id from pending)), 1, 'profile created on confirmation');
select is((select email from private.accounts where user_id = (select id from pending)), 'pending@alpha.edu', 'account row holds the email');
select is((select count(*)::int from public.user_settings where user_id = (select id from pending)), 1, 'settings row created');
grant select on pending to authenticated;

-- complete_onboarding.
select tests.login_as((select id from pending));
select throws_ok($$ select public.complete_onboarding('no', 'starter_1', 'v1', true, false) $$, 'P0001', 'VALIDATION_FAILED', 'nickname too short');
select throws_ok($$ select public.complete_onboarding('has space', 'starter_1', 'v1', true, false) $$, 'P0001', 'VALIDATION_FAILED', 'nickname with a space');
select throws_ok($$ select public.complete_onboarding('ALPHA1', 'starter_1', 'v1', true, false) $$, 'P0001', 'ALREADY_EXISTS', 'nickname taken, ignoring case');
select throws_ok($$ select public.complete_onboarding('deleted_ab12', 'starter_1', 'v1', true, false) $$, 'P0001', 'PROHIBITED_CONTENT', 'reserved deleted_ prefix');
select throws_ok($$ select public.complete_onboarding('t_maple_23', 'starter_1', '', true, false) $$, 'P0001', 'VALIDATION_FAILED', 'terms must be accepted');
select throws_ok($$ select public.complete_onboarding('t_maple_23', 'starter_1', 'v1', true, false, null, 'Mars/Olympus') $$, 'P0001', 'VALIDATION_FAILED', 'unknown time zone');
select throws_ok($$ select public.complete_onboarding('t_maple_23', 'starter_99', 'v1', true, false) $$, 'P0001', 'VALIDATION_FAILED', 'unknown starter avatar');
select is((public.complete_onboarding('t_maple_23', 'starter_1', 'v1', true, false, '61820'))->>'zip', null, 'students onboard without a ZIP code');
select throws_ok($$ select public.complete_onboarding('t_maple_24', 'starter_1', 'v1', true, false) $$, 'P0001', 'INVALID_STATE', 'onboarding runs once');
select is((public.get_my_account())->'campus'->>'slug', 'alpha', 'get_my_account returns the campus');
select is(
  (public.get_my_account())->'avatar',
  '{"background": "bg_sky", "top": "top_hoodie_navy", "face": "face_smile", "head": "head_beanie"}'::jsonb,
  'the starter look is equipped and returned by get_my_account'
);
select is((select count(*)::int from public.inventory i join public.shop_items s on s.id = i.item_id
           where i.user_id = (select id from pending) and s.slot <> 'body'), 4, 'the starter items are owned');
select is((public.get_my_account()) ->> 'display_name', 't_maple_23', 'get_my_account returns the nickname');
select throws_ok(
  $$ insert into public.avatar_loadout (user_id, slot, item_id) select (select id from pending), 'frame', id from public.shop_items limit 1 $$,
  '42501', null, 'users cannot equip items directly'
);

reset role;
create temp table general as select tests.create_user('someone@example.com') as id;
grant select on general to authenticated;
select tests.login_as((select id from general));
select throws_ok($$ select public.complete_onboarding('t_someone', 'starter_1', 'v1', false, false, '99999') $$, 'P0001', 'ZIP_REQUIRED', 'general users need a known ZIP code');

select tests.login_as(tests.user_id('suspended'));
select lives_ok($$ select public.get_my_account() $$, 'suspended users can read their account');
select throws_ok($$ select public.complete_onboarding('t_other', 'starter_1', 'v1', true, false) $$, 'P0001', 'ACCOUNT_SUSPENDED', 'suspended users cannot write');

select tests.login_as(gen_random_uuid());
select throws_ok($$ select public.get_my_account() $$, 'P0001', 'AUTH_REQUIRED', 'a session without a profile is rejected');

select * from finish();
rollback;
