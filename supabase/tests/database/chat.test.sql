-- Chats, messages, read state, leaving, Broadcast delivery and chat photo storage (spec 4.9, 5.3.5, 6.5).
begin;
\ir _helpers.psql
select plan(52);
select tests.build_matrix();

select tests.remember('desk', tests.create_listing_as('alpha1'));
select tests.remember('fan', tests.create_listing_as('general1', '{"title": "Box fan"}'));
select tests.remember('lamp', tests.create_listing_as('alpha1', '{"title": "Desk lamp"}'));

-- Opening a chat (CHT-1).
select tests.login_as(tests.user_id('alpha2'));
select is((public.get_or_create_chat(tests.id('desk')) ->> 'created')::boolean, true, 'opening a chat on a listing creates it');
select tests.remember('chat', (select id from public.chats where listing_id = tests.id('desk')));
select is(public.get_or_create_chat(tests.id('desk')), jsonb_build_object('chat_id', tests.id('chat'), 'created', false),
  'opening it again returns the same chat');
select is((select count(*)::int from public.chat_reads where chat_id = tests.id('chat')), 2, 'both sides get a read marker');
select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.get_or_create_chat(tests.id('desk')) $$, 'P0001', 'SELF_ACTION', 'owners do not chat with themselves');
select tests.login_as(tests.user_id('beta1'));
select throws_ok($$ select public.get_or_create_chat(tests.id('desk')) $$, 'P0001', 'NOT_FOUND', 'a campus listing is not reachable from another campus');
select is((public.get_or_create_chat(tests.id('fan')) ->> 'created')::boolean, true, 'an open-market listing is reachable from any campus');
reset role;
insert into public.blocks (blocker_id, blocked_id) values (tests.user_id('general1'), tests.user_id('gamma1'));
select tests.login_as(tests.user_id('gamma1'));
select throws_ok($$ select public.get_or_create_chat(tests.id('fan')) $$, 'P0001', 'BLOCKED', 'a block stops new chats both ways');
select tests.login_as(tests.user_id('suspended'));
select throws_ok($$ select public.get_or_create_chat(tests.id('desk')) $$, 'P0001', 'ACCOUNT_SUSPENDED', 'suspended users cannot open chats');

select tests.login_as(tests.user_id('alpha2'));
select tests.remember('lamp_chat', (public.get_or_create_chat(tests.id('lamp')) ->> 'chat_id')::uuid);
select tests.login_as(tests.user_id('alpha1'));
select public.close_listing(tests.id('lamp'));
select tests.login_as(tests.user_id('alpha2'));
select is((public.get_or_create_chat(tests.id('lamp')) ->> 'chat_id')::uuid, tests.id('lamp_chat'), 'an existing chat stays reachable after the listing closes');
reset role;
update public.chats set closed_at = now() where id = tests.id('lamp_chat');
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.get_or_create_chat(tests.id('lamp')) $$, 'P0001', 'INVALID_STATE', 'but no new chat starts on a closed listing');

-- Sending (CHT-2): per-chat sequence, retries, validation, filter and rate limit.
select is(public.send_message(tests.id('chat'), 'text', 'Is this still available?', null, tests.remember('m1', gen_random_uuid())) ->> 'seq', '1',
  'the first message gets seq 1');
select is(public.send_message(tests.id('chat'), 'text', 'Is this still available?', null, tests.id('m1')) ->> 'seq', '1',
  'a retry with the same client id returns the stored message');
select is((select count(*)::int from public.messages where chat_id = tests.id('chat')), 1, 'and stores nothing new');
select is((select last_read_seq::int from public.chat_reads where chat_id = tests.id('chat') and user_id = tests.user_id('alpha2')), 1,
  'sending marks the chat read for the sender');
select tests.login_as(tests.user_id('alpha1'));
select is(public.send_message(tests.id('chat'), 'text', 'Yes! When can you meet?', null, gen_random_uuid()) ->> 'seq', '2',
  'the reply gets the next seq');
select tests.login_as(tests.user_id('beta1'));
select throws_ok($$ select public.send_message(tests.id('chat'), 'text', 'hi', null, gen_random_uuid()) $$, 'P0001', 'NOT_PARTY',
  'outsiders cannot send');
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.send_message(tests.id('chat'), 'system', 'hi', null, gen_random_uuid()) $$, 'P0001', 'VALIDATION_FAILED',
  'users cannot send system messages');
select throws_ok($$ select public.send_message(tests.id('chat'), 'text', '   ', null, gen_random_uuid()) $$, 'P0001', 'VALIDATION_FAILED',
  'a text message needs text');
select throws_ok(format($$ select public.send_message(tests.id('chat'), 'image', null, '%s/%s/x.webp', gen_random_uuid()) $$,
                        tests.id('chat'), tests.user_id('alpha1')),
  'P0001', 'VALIDATION_FAILED', 'a photo must be the sender''s upload in this chat');
select is(public.send_message(tests.id('chat'), 'image', null, tests.id('chat') || '/' || tests.user_id('alpha2') || '/x.webp', gen_random_uuid()) ->> 'seq', '3',
  'a photo message');
select throws_ok($$ select public.send_message(tests.id('chat'), 'text', 'got any vapes?', null, gen_random_uuid()) $$, 'P0001', 'PROHIBITED_CONTENT',
  'prohibited words are blocked in chat');
select is((select count(*)::int from (select public.send_message(tests.id('chat'), 'text', 'msg ' || n, null, gen_random_uuid())
                                      from generate_series(1, 8) n) s), 8, 'up to 10 messages in 10 seconds');
select throws_ok($$ select public.send_message(tests.id('chat'), 'text', 'one more', null, gen_random_uuid()) $$, 'P0001', 'RATE_LIMITED',
  'the 11th within 10 seconds is refused');

-- History and gap fill.
select is((select array_agg(seq::int) from public.get_messages(tests.id('chat'), 9)), array[10, 11], 'after a seq: the newer messages, oldest first');
select is((select array_agg(seq::int) from public.get_messages(tests.id('chat'), null, 4, 2)), array[2, 3], 'before a seq: the latest older page, in order');
select is((select array_agg(seq::int) from public.get_messages(tests.id('chat'), null, null, 3)), array[9, 10, 11], 'no bounds: the latest page');
select tests.login_as(tests.user_id('beta1'));
select throws_ok($$ select public.get_messages(tests.id('chat')) $$, 'P0001', 'NOT_FOUND', 'outsiders cannot read the history');

-- Read state (CHT-4).
select tests.login_as(tests.user_id('alpha1'));
select is(public.unread_summary(), jsonb_build_object('total', 9, 'chats', jsonb_build_array(jsonb_build_object('chat_id', tests.id('chat'), 'unread', 9))),
  'unread counts the other side''s messages since the marker');
select is(public.mark_read(tests.id('chat'), 99), '{"last_read_seq": 11}', 'the marker stops at the last message');
select is(public.mark_read(tests.id('chat'), 5), '{"last_read_seq": 11}', 'and never moves back');
select is(public.unread_summary(), '{"total": 0, "chats": []}', 'nothing unread after reading');
select lives_ok($$ select public.set_chat_muted(tests.id('chat'), true) $$, 'a party can mute the chat');
select tests.login_as(tests.user_id('beta1'));
select throws_ok($$ select public.mark_read(tests.id('chat'), 1) $$, 'P0001', 'NOT_PARTY', 'outsiders have no read marker');
select throws_ok($$ select public.set_chat_muted(tests.id('chat'), true) $$, 'P0001', 'NOT_PARTY', 'or a mute switch');

-- Row-level security: the two parties only, and no direct writes.
select is_empty($$ select 1 from public.chats where id = tests.id('chat')
                   union all select 1 from public.messages where chat_id = tests.id('chat')
                   union all select 1 from public.chat_reads where chat_id = tests.id('chat') $$,
  'outsiders see nothing of the chat');
select tests.login_as(tests.user_id('alpha2'));
select is((select count(*)::int from public.chat_reads where chat_id = tests.id('chat')), 2, 'a party sees both read markers (read receipts)');
select throws_ok(format($$ insert into public.messages (chat_id, seq, sender_id, kind, body, client_id)
                           values ('%s', 99, '%s', 'text', 'x', gen_random_uuid()) $$, tests.id('chat'), tests.user_id('alpha2')),
  '42501', null, 'messages are written only through send_message');

-- Broadcast topics and delivery (4.9).
select ok(private.can_join_topic('chat:' || tests.id('chat')) and private.can_join_topic('user:' || tests.user_id('alpha2')),
  'a party joins the chat topic and their own user topic');
select tests.login_as(tests.user_id('beta1'));
select ok(not private.can_join_topic('chat:' || tests.id('chat')) and not private.can_join_topic('user:' || tests.user_id('alpha2'))
          and not private.can_join_topic('chat:not-a-uuid'),
  'nobody else joins them');
reset role;
select is((select count(*)::int from realtime.messages where topic = 'chat:' || tests.id('chat') and event = 'message'), 11,
  'each message is broadcast to the chat topic');
select is((select count(*)::int from realtime.messages where topic = 'user:' || tests.user_id('alpha1') and event = 'badge'
             and payload ->> 'chat_id' = tests.id('chat')::text), 11,
  'and a badge event goes to each party');
select is((select count(*)::int from realtime.messages where topic = 'chat:' || tests.id('chat') and event = 'read'), 1,
  'a read receipt is broadcast when the marker moves');

-- Chat photos: a party uploads under their own folder of the chat; both parties read.
select tests.login_as(tests.user_id('alpha2'));
select lives_ok(format($$ insert into storage.objects (bucket_id, name) values ('chat-images', '%s/%s/x.webp') $$, tests.id('chat'), tests.user_id('alpha2')),
  'a party uploads into their folder of the chat');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('chat-images', '%s/%s/y.webp') $$, tests.id('chat'), tests.user_id('alpha1')),
  '42501', null, 'not into the other side''s folder');
select tests.login_as(tests.user_id('beta1'));
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('chat-images', '%s/%s/z.webp') $$, tests.id('chat'), tests.user_id('beta1')),
  '42501', null, 'outsiders cannot upload into the chat');
select is_empty($$ select 1 from storage.objects where bucket_id = 'chat-images' $$, 'or read its photos');
select tests.login_as(tests.user_id('alpha1'));
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'chat-images' and name like tests.id('chat') || '/%' $$,
  'the other party reads them');

-- Leaving (CHT-7, CHT-8).
select tests.login_as(tests.user_id('alpha2'));
select ok((public.leave_chat(tests.id('chat')) ->> 'purge_after') is null, 'the first side leaves; nothing is purged yet');
select is((select meta ->> 'event' from public.messages where chat_id = tests.id('chat') order by seq desc limit 1), 'left',
  'the other side sees "left the chat"');
select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.send_message(tests.id('chat'), 'text', 'still there?', null, gen_random_uuid()) $$, 'P0001', 'INVALID_STATE',
  'and can no longer send');
select is((public.leave_chat(tests.id('chat')) ->> 'purge_after')::timestamptz, (select closed_at + interval '7 days' from public.chats where id = tests.id('chat')),
  'when the second side leaves, the chat is purged 7 days later');
select tests.login_as(tests.user_id('alpha2'));
select isnt((public.get_or_create_chat(tests.id('desk')) ->> 'chat_id')::uuid, tests.id('chat'), 'contacting the owner again starts a new chat');

select * from finish();
rollback;
