-- Safety and moderation (SAF-1 to SAF-9): reports and automatic hiding, blocks, the admin queue and case
-- data, hiding, report resolution, enforcement and its effects, config changes and the admin log.
begin;
\ir _helpers.psql
select plan(44);
select tests.build_matrix();

-- A campus admin of alpha, a super admin and one more alpha student.
insert into tests.matrix (name, id) values
  ('alpha_admin', tests.create_user('admin@alpha.edu')),
  ('super', tests.create_user('super@example.com')),
  ('alpha3', tests.create_user('alpha3@alpha.edu'));
update public.profiles p set display_name = m.name from tests.matrix m
where p.id = m.id and m.name in ('alpha_admin', 'super', 'alpha3');
insert into public.user_roles (user_id, role, campus_id) values
  (tests.user_id('alpha_admin'), 'campus_admin', (select campus_id from public.profiles where id = tests.user_id('alpha1'))),
  (tests.user_id('super'), 'super_admin', null);

-- Report targets that are not uuids, like chat_id:seq.
create table tests.refs (name text primary key, ref text not null);
grant select, insert on tests.refs to authenticated;
create function tests.ref(p_name text) returns text language sql stable as $$ select ref from tests.refs where name = p_name; $$;
create function tests.queue() returns text[] language sql as $$
  select array_agg(c ->> 'target_type' order by c ->> 'target_type') from jsonb_array_elements(public.admin_queue()) c;
$$;

select tests.remember('desk', tests.create_listing_as('alpha1'));
select tests.remember('lamp', tests.create_listing_as('alpha1', '{"visibility": "open", "title": "Desk lamp"}'));
select tests.remember('gen', tests.create_listing_as('general1', '{"visibility": "open", "title": "Bike"}'));
select tests.login_as(tests.user_id('alpha2'));
select tests.remember('chat', (public.get_or_create_chat(tests.id('desk')) ->> 'chat_id')::uuid);
insert into tests.refs values ('message', tests.id('chat') || ':' ||
  (public.send_message(tests.id('chat'), 'text', 'You are an idiot', null, gen_random_uuid()) ->> 'seq'));

-- Reports (SAF-1).
select is((public.report('listing', tests.id('desk')::text, 'scam') ->> 'target_user_id')::uuid, tests.user_id('alpha1'),
  'a report records whose listing it is');
select throws_ok($$ select public.report('listing', tests.id('desk')::text, 'spam') $$, 'P0001', 'ALREADY_EXISTS', 'one report per user per target');
select throws_ok($$ select public.report('listing', tests.id('desk')::text, 'rude') $$, 'P0001', 'VALIDATION_FAILED', 'reasons come from the list');
select throws_ok($$ select public.report('message', tests.ref('message'), 'harassment') $$, 'P0001', 'SELF_ACTION', 'not your own message');
select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.report('listing', tests.id('desk')::text, 'scam') $$, 'P0001', 'SELF_ACTION', 'not your own listing');
select tests.remember('message_report', (public.report('message', tests.ref('message'), 'harassment') ->> 'id')::uuid);
select tests.login_as(tests.user_id('beta1'));
select throws_ok($$ select public.report('listing', tests.id('desk')::text, 'scam') $$, 'P0001', 'NOT_FOUND', 'only listings the reporter can see');
select throws_ok($$ select public.report('message', tests.ref('message'), 'harassment') $$, 'P0001', 'NOT_FOUND', 'only messages in your own chats');
select tests.remember('user_report', (public.report('user', tests.user_id('alpha1')::text, 'harassment', 'Rude at the meetup') ->> 'id')::uuid);
select is((select target_campus_id from public.reports where id = tests.id('user_report')),
          (select campus_id from public.profiles where id = tests.user_id('alpha1')), 'a user report goes to their campus');
select tests.remember('gen_report', (public.report('listing', tests.id('gen')::text, 'prohibited_item') ->> 'id')::uuid);
select is((select target_campus_id from public.reports where id = tests.id('gen_report')), null,
  'a general user''s listing goes to the open-market queue');

-- Automatic hiding (SAF-2).
select tests.remember('lamp_report', (public.report('listing', tests.id('lamp')::text, 'scam') ->> 'id')::uuid);
select tests.login_as(tests.user_id('general1'));
select public.report('listing', tests.id('lamp')::text, 'scam');
reset role;
select is((select hidden from public.listings where id = tests.id('lamp')), false, 'two reports do not hide a listing');
select tests.login_as(tests.user_id('alpha2'));
select public.report('listing', tests.id('lamp')::text, 'spam');
reset role;
select is((select hidden_reason from public.listings where id = tests.id('lamp') and hidden), 'reported',
  'three reporters hide it until an admin reviews it');

insert into public.reports (reporter_id, target_type, target_ref, target_user_id, reason, status)
select tests.user_id('alpha3'), 'user', gen_random_uuid()::text, tests.user_id('general1'), 'spam', 'dismissed'
from generate_series(1, 10);
select tests.login_as(tests.user_id('alpha3'));
select throws_ok($$ select public.report('user', tests.user_id('alpha1')::text, 'spam') $$, 'P0001', 'RATE_LIMITED', '10 reports a day');

-- Blocks (SAF-3).
select throws_ok($$ select public.block_user(tests.user_id('alpha3')) $$, 'P0001', 'SELF_ACTION', 'not yourself');
select public.block_user(tests.user_id('alpha1'));
select is_empty($$ select 1 from public.listings where id = tests.id('desk') $$, 'a blocked user''s listings are hidden');
select public.unblock_user(tests.user_id('alpha1'));
select isnt_empty($$ select 1 from public.listings where id = tests.id('desk') $$, 'and show again after unblocking');

-- The queue and case data (SAF-5, SAF-9).
select throws_ok($$ select public.admin_queue() $$, 'P0001', 'FORBIDDEN', 'the queue is for admins');
select tests.login_as(tests.user_id('alpha_admin'));
select is(tests.queue(), array['listing', 'listing', 'message', 'user'], 'a campus admin sees the cases of their campus');
select is((select (c ->> 'reports')::int from jsonb_array_elements(public.admin_queue()) c where c ->> 'target_ref' = tests.id('lamp')::text),
  3, 'one case per target, with its report count');
select is(public.admin_open_case_data('report', tests.id('message_report'), 'chat') #>> '{messages,0,body}', 'You are an idiot',
  'admins open the reported chat');
select throws_ok($$ select public.admin_open_case_data('report', tests.id('gen_report'), 'chat') $$, 'P0001', 'FORBIDDEN',
  'only for cases of their campus');
select tests.login_as(tests.user_id('super'));
select is(tests.queue(), array['listing', 'listing', 'listing', 'message', 'user'], 'super admins also see the open-market queue');

-- Hiding (2.8).
select tests.login_as(tests.user_id('alpha_admin'));
select public.admin_set_hidden('message', tests.ref('message'), true, 'Abusive');
reset role;
select is((select coalesce(body, 'none') || ' ' || (meta ->> 'hidden') from public.messages
           where chat_id = tests.id('chat') and sender_id = tests.user_id('alpha2')), 'none true', 'a hidden message loses its text');
select tests.login_as(tests.user_id('alpha_admin'));
select is(public.admin_open_case_data('report', tests.id('message_report'), 'chat') #>> '{messages,0,hidden}', 'true',
  'the case still shows what it said');
select public.admin_set_hidden('message', tests.ref('message'), false);
reset role;
select is((select body from public.messages where chat_id = tests.id('chat') and sender_id = tests.user_id('alpha2')),
  'You are an idiot', 'restoring brings it back');
select tests.login_as(tests.user_id('alpha_admin'));
select throws_ok($$ select public.admin_set_hidden('listing', tests.id('desk')::text, true) $$, 'P0001', 'VALIDATION_FAILED',
  'hiding needs a reason');

-- Resolving reports.
select is((public.admin_resolve_report(tests.id('lamp_report'), 'dismissed') ->> 'resolved')::int, 3,
  'resolving closes every report on the target');
reset role;
select is((select hidden from public.listings where id = tests.id('lamp')), false, 'dismissing restores a listing that reports hid');
select tests.login_as(tests.user_id('alpha_admin'));
select throws_ok($$ select public.admin_resolve_report(tests.id('lamp_report'), 'actioned') $$, 'P0001', 'INVALID_STATE', 'once');
select throws_ok($$ select public.admin_resolve_report(tests.id('gen_report'), 'actioned') $$, 'P0001', 'FORBIDDEN',
  'open-market cases are for super admins');
select public.admin_resolve_report(tests.id('user_report'), 'actioned', true, 'Confirmed by both sides');
reset role;
select is((select points::int from public.penalties where user_id = tests.user_id('alpha1') and reason = 'harassment'), 3,
  'upheld harassment is a 3-point penalty');

-- Enforcement (SAF-7).
select tests.login_as(tests.user_id('alpha_admin'));
select public.admin_enforce(tests.user_id('alpha1'), 'suspension', '3 days', 'harassment', '2.8', 'report', tests.id('user_report'));
reset role;
select is((select status || ' ' || (suspended_until > now() + interval '2 days') from public.profiles where id = tests.user_id('alpha1')),
  'suspended true', 'a suspension takes effect');
select is((select payload ->> 'title' from public.notifications where user_id = tests.user_id('alpha1') and type = 'account'),
  'Your account is suspended', 'and the user is told');
select tests.login_as(tests.user_id('alpha_admin'));
select throws_ok($$ select public.admin_enforce(tests.user_id('alpha2'), 'suspension', '14 days', 'fraud', '2.8') $$,
  'P0001', 'FORBIDDEN', 'campus admins suspend for up to 7 days');
select throws_ok($$ select public.admin_enforce(tests.user_id('alpha2'), 'ban', null, 'fraud', '2.8') $$, 'P0001', 'FORBIDDEN',
  'and do not ban');
select throws_ok($$ select public.admin_enforce(tests.user_id('beta1'), 'warning', null, 'spam', '2.8') $$, 'P0001', 'FORBIDDEN',
  'only users of their campus');
select tests.login_as(tests.user_id('super'));
select throws_ok($$ select public.admin_enforce(tests.user_id('alpha2'), 'restriction', '3 days', 'spam', '2.8') $$,
  'P0001', 'VALIDATION_FAILED', 'restrictions are P1');
select public.admin_enforce(tests.user_id('alpha2'), 'ban', null, 'fraud', '2.8');
reset role;
select is((select status::text from public.profiles where id = tests.user_id('alpha2')) || ' ' ||
          exists (select 1 from private.identity_tombstones where email_hmac = private.email_hmac('alpha2@cs.alpha.edu') and blocked_until is null),
  'banned true', 'a ban closes the account and keeps the email from signing up again');
select throws_ok($$ update public.enforcement_actions set note = 'edited' $$, 'P0001', 'enforcement_actions is append-only',
  'enforcement actions are append-only');
select tests.login_as(tests.user_id('alpha1'));
select is((select array_agg(kind::text) from public.enforcement_actions), array['suspension'], 'users see their own actions');
reset role;
update public.profiles set suspended_until = now() - interval '1 minute' where id = tests.user_id('alpha1');
select private.enforcement_lift();
select is((select status::text from public.profiles where id = tests.user_id('alpha1')), 'active', 'the lift job ends suspensions on time');

-- Config (6.10).
select tests.login_as(tests.user_id('alpha_admin'));
select throws_ok($$ select public.admin_set_config('rank_rules', '{}') $$, 'P0001', 'FORBIDDEN', 'config is for super admins');
select tests.login_as(tests.user_id('super'));
select throws_ok($$ select public.admin_set_config('no_such_key', '{}') $$, 'P0001', 'NOT_FOUND', 'only existing keys');
reset role;
delete from private.rank_dirty;
select set_config('tests.rank_rules', (select value::text from public.app_config where key = 'rank_rules'), true);
select tests.login_as(tests.user_id('super'));
select public.admin_set_config('rank_rules', current_setting('tests.rank_rules')::jsonb);
reset role;
select is((select count(*)::int from private.rank_dirty d join tests.matrix m on m.id = d.user_id), 10,
  'a rank rules change queues every user for recompute');

-- The admin log (SAF-9): one row per successful admin call.
select is((select array_agg(operation order by id) from private.admin_log where admin_id = tests.user_id('alpha_admin')),
  array['admin_queue', 'admin_queue', 'view', 'admin_set_hidden', 'view', 'admin_set_hidden', 'admin_resolve_report',
        'admin_resolve_report', 'admin_enforce'], 'every admin call is logged');

select * from finish();
rollback;
