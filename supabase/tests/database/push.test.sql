-- Push notifications (CHT-5, spec 4.16): token registration, what each event sends to Expo through the
-- pg_net queue (nothing leaves the database in a test, since the queue rolls back), preferences, mutes
-- and lock-screen previews, and the receipts job.
begin;
\ir _helpers.psql
select plan(25);
select tests.build_matrix();

-- The Expo messages queued since the last mark.
create table tests.queue_mark (id bigint);
create function tests.mark() returns void language sql as $$
  delete from tests.queue_mark;
  insert into tests.queue_mark select coalesce(max(id), 0) from net.http_request_queue;
$$;
create function tests.pushed() returns jsonb language sql as $$
  select coalesce(jsonb_agg(m - 'sound' order by q.id, n), '[]')
  from net.http_request_queue q, jsonb_array_elements(convert_from(q.body, 'utf8')::jsonb) with ordinality x(m, n)
  where q.url like 'https://exp.host/--/api/v2/push/send%' and q.id > (select id from tests.queue_mark);
$$;
create function tests.titles() returns text language sql as $$
  select coalesce(string_agg((m ->> 'to') || ': ' || (m ->> 'title'), ' | ' order by m ->> 'to'), '')
  from jsonb_array_elements(tests.pushed()) m;
$$;

-- Tokens.
select tests.login_as(tests.user_id('alpha1'));
select lives_ok($$ select public.register_push_token('ExponentPushToken[a1]', 'android') $$, 'a device registers its token');
select throws_ok($$ select public.register_push_token('not-a-token', 'android') $$, 'P0001', 'VALIDATION_FAILED', 'only Expo tokens are accepted');
select tests.login_as(tests.user_id('alpha2'));
select public.register_push_token('ExponentPushToken[a1]', 'android');
reset role;
select is((select user_id from public.push_tokens where token = 'ExponentPushToken[a1]'), tests.user_id('alpha2'),
  'a token follows the newest sign-in on the device');
select tests.login_as(tests.user_id('alpha1'));
select public.unregister_push_token('ExponentPushToken[a1]');
reset role;
select is((select count(*)::int from public.push_tokens where token = 'ExponentPushToken[a1]'), 1, 'nobody removes another user''s token');
select tests.login_as(tests.user_id('alpha2'));
select public.unregister_push_token('ExponentPushToken[a1]');
select public.register_push_token('ExponentPushToken[a2]', 'android');
select tests.login_as(tests.user_id('alpha1'));
select public.register_push_token('ExponentPushToken[a1]', 'android');
select is((select array_agg(token) from public.push_tokens), array['ExponentPushToken[a1]'], 'users see only their own tokens');

-- Chat messages (pref "chats").
select tests.remember('desk', tests.create_listing_as('alpha1'));
select tests.login_as(tests.user_id('alpha2'));
select tests.remember('chat', (public.get_or_create_chat(tests.id('desk')) ->> 'chat_id')::uuid);
reset role;
select tests.mark();
select tests.login_as(tests.user_id('alpha2'));
select public.send_message(tests.id('chat'), 'text', 'Is this still available?', null, gen_random_uuid());
reset role;
select is(tests.pushed(), jsonb_build_array(jsonb_build_object('to', 'ExponentPushToken[a1]', 'title', 'alpha2',
  'body', 'Is this still available?', 'data', jsonb_build_object('type', 'chat', 'chat_id', tests.id('chat')))),
  'a message is pushed to the other side, from the sender, with its text');
select is((select count(*)::int from public.notifications where user_id = tests.user_id('alpha1')), 0,
  'chat messages stay out of the notification log');

insert into public.user_settings (user_id, lock_screen_preview) values (tests.user_id('alpha1'), false)
on conflict (user_id) do update set lock_screen_preview = false;
select tests.mark();
select tests.login_as(tests.user_id('alpha2'));
select public.send_message(tests.id('chat'), 'text', 'My number is 555-0100', null, gen_random_uuid());
reset role;
select is(tests.pushed() -> 0 ->> 'body', 'New message', 'with lock-screen previews off the text stays out of the push');

update public.chat_reads set muted = true where chat_id = tests.id('chat') and user_id = tests.user_id('alpha1');
select tests.mark();
select tests.login_as(tests.user_id('alpha2'));
select public.send_message(tests.id('chat'), 'text', 'Hello?', null, gen_random_uuid());
reset role;
select is(tests.pushed(), '[]', 'a muted chat sends nothing');

update public.chat_reads set muted = false where chat_id = tests.id('chat') and user_id = tests.user_id('alpha1');
update public.user_settings set push_prefs = '{"chats": false}' where user_id = tests.user_id('alpha1');
select tests.mark();
select tests.login_as(tests.user_id('alpha2'));
select public.send_message(tests.id('chat'), 'image', null, tests.id('chat') || '/' || tests.user_id('alpha2') || '/x.webp', gen_random_uuid());
reset role;
select is(tests.pushed(), '[]', 'turning chats off stops chat pushes');
update public.user_settings set push_prefs = '{}', lock_screen_preview = true where user_id = tests.user_id('alpha1');

-- Trade steps (pref "trades"), to whoever did not take them.
select tests.mark();
select tests.login_as(tests.user_id('alpha2'));
select tests.remember('t1', (public.propose_trade(tests.id('chat'),
  jsonb_build_object('item_ids', (select jsonb_agg(id) from public.items where listing_id = tests.id('desk')), 'total_cents', 4000,
                     'meet_at', now() + interval '1 day', 'place_text', 'Union'), gen_random_uuid()) ->> 'id')::uuid);
reset role;
select is(tests.titles(), 'ExponentPushToken[a1]: New trade proposal', 'a proposal goes to the other side only, with no chat push for its card');
select is(tests.pushed() -> 0 -> 'data', jsonb_build_object('type', 'trade', 'trade_id', tests.id('t1'), 'chat_id', tests.id('chat')),
  'and opens the trade');
select is((select type || ' ' || (payload ->> 'title') from public.notifications where user_id = tests.user_id('alpha1')), 'trades New trade proposal',
  'and is logged for the notification center');
select tests.mark();
select tests.login_as(tests.user_id('alpha1'));
select public.accept_trade(tests.id('t1'));
reset role;
select is(tests.titles(), 'ExponentPushToken[a2]: Trade accepted', 'the proposer hears the trade was accepted');
update public.trades set meet_at = now() - interval '1 hour' where id = tests.id('t1');
select tests.mark();
select tests.login_as(tests.user_id('alpha2'));
select public.confirm_trade(tests.id('t1'));
reset role;
select is(tests.titles(), 'ExponentPushToken[a1]: alpha2 marked the trade completed', 'the first confirmation asks the other side');
select tests.mark();
select tests.login_as(tests.user_id('alpha1'));
select public.confirm_trade(tests.id('t1'));
reset role;
select is(tests.titles(), 'ExponentPushToken[a1]: Trade completed | ExponentPushToken[a2]: Trade completed',
  'completion goes to both sides, without another confirmation push');

-- Reviews.
select tests.mark();
select tests.login_as(tests.user_id('alpha2'));
select public.submit_review(tests.id('t1'), 5, '{on_time}', null);
reset role;
select is(tests.pushed() -> 0 ->> 'body', 'alpha2 gave you 5 stars', 'a review is pushed to the reviewee');
select tests.login_as(tests.user_id('alpha2'));
select is((select count(*)::int from public.notifications), 2, 'users see only their own notifications');

-- Receipts: Expo answers a send with tickets, then reports receipts for the tickets.
reset role;
insert into private.push_requests (request_id, kind, tokens) values (900000001, 'send', array['ExponentPushToken[a1]', 'ExponentPushToken[a2]']);
insert into net._http_response (id, status_code, content)
values (900000001, 200, '{"data": [{"status": "ok", "id": "ticket-1"}, {"status": "error", "details": {"error": "DeviceNotRegistered"}}]}');
select private.push_receipts();
select is((select token from private.push_tickets where ticket_id = 'ticket-1'), 'ExponentPushToken[a1]', 'an accepted message leaves a ticket');
select is((select count(*)::int from public.push_tokens where token = 'ExponentPushToken[a2]'), 0,
  'a token Expo reports as not registered is removed at once');
select is((select count(*)::int from private.push_requests where kind = 'receipts'), 0, 'receipts wait until a ticket is 15 minutes old');
update private.push_tickets set created_at = now() - interval '20 minutes' where ticket_id = 'ticket-1';
select private.push_receipts();
select is((select tickets from private.push_requests where kind = 'receipts'), array['ticket-1'], 'then the receipt is asked for');
insert into net._http_response (id, status_code, content)
select request_id, 200, '{"data": {"ticket-1": {"status": "error", "details": {"error": "DeviceNotRegistered"}}}}'
from private.push_requests where kind = 'receipts';
select is(private.push_receipts(), '{"checked": 1, "removed_tokens": 1}', 'and a not-registered receipt removes the token');
select is((select count(*)::int from private.push_tickets where ticket_id = 'ticket-1'), 0, 'checked tickets are cleared');
select is((select schedule from cron.job where jobname = 'push-receipts'), '*/15 * * * *', 'receipts are checked every 15 minutes');

select * from finish();
rollback;
