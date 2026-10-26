-- TST-2: races between real sessions (spec 4.18): two acceptances of one item, a confirmation against
-- the trades-advance job both ways, two completions of one pair, two opens of one chat, and accept
-- against withdraw, two awards near the daily points cap, and the 2nd and 3rd reports of a listing.
-- Dispute against the job joins with DB-14.
--
-- The other sessions are dblink connections, so their writes commit and their locks are real; they
-- set up their own users and listings and remove them at the end. A non-superuser may use dblink only
-- with a password login, so they connect over the network address this session came in on (the local
-- socket and loopback are trust logins); the local stack's postgres password is "postgres".
begin;
select plan(19);
create extension if not exists dblink with schema extensions;
-- Refusals in the other sessions are expected; dblink would print each as a notice.
set local client_min_messages = warning;

create function pg_temp.open(p_name text) returns void
language sql as $$
  select extensions.dblink_connect(p_name,
    format('host=%s dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
$$;
create function pg_temp.run(p_conn text, p_sql text) returns void
language sql as $$ select extensions.dblink_exec(p_conn, p_sql); $$;
create function pg_temp.value(p_conn text, p_sql text) returns text
language sql as $$ select v from extensions.dblink(p_conn, p_sql) as t(v text); $$;
-- Opens a transaction on the connection and makes the call in it, leaving the transaction open, so
-- its locks stay held until pg_temp.run(conn, 'commit').
create function pg_temp.hold(p_conn text, p_call text) returns void
language sql as $$ select pg_temp.run(p_conn, format('begin; do $h$ begin perform %s; end $h$', p_call)); $$;
-- Acts as the user for the rest of the connection's life.
create function pg_temp.act_as(p_conn text, p_user uuid) returns void
language sql as $$
  select pg_temp.run(p_conn, format($q$select set_config('request.jwt.claims', %L, false); set role authenticated$q$,
                                   json_build_object('sub', p_user, 'role', 'authenticated')));
$$;
-- Starts a statement without waiting for it; pg_temp.result collects its value or its error message.
create function pg_temp.start(p_conn text, p_sql text) returns void
language sql as $$ select extensions.dblink_send_query(p_conn, p_sql); $$;
create function pg_temp.result(p_conn text) returns text
language plpgsql as $$
declare
  v_value text;
begin
  select v into v_value from extensions.dblink_get_result(p_conn, false) as t(v text);
  if not found then
    -- The error code our functions raise, e.g. "ITEM_UNAVAILABLE" from "ERROR:  ITEM_UNAVAILABLE".
    v_value := substring(extensions.dblink_error_message(p_conn) from 'ERROR:\s+(\S+)');
  end if;
  perform 1 from extensions.dblink_get_result(p_conn, false) as t(v text);   -- clears the connection
  return v_value;
end;
$$;
-- True once the connection's session is waiting for a lock (within 2 seconds).
create function pg_temp.waiting(p_conn text) returns boolean
language plpgsql as $$
begin
  for i in 1 .. 100 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity a join pg_temp.pids p on p.pid = a.pid
               where p.conn = p_conn and a.wait_event_type = 'Lock') then
      return true;
    end if;
    perform pg_sleep(0.02);
  end loop;
  return false;
end;
$$;
create table pg_temp.pids (conn text primary key, pid int not null);
create table pg_temp.ids (name text primary key, id uuid not null);
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from pg_temp.ids where name = p_name; $$;

-- Race users have addresses starting with "race-"; this removes them and everything they made.
create function pg_temp.cleanup() returns void
language sql as $$
  select pg_temp.run('setup', $q$
    create temp table race_users on commit drop as
      select id from auth.users where email like 'race-%@illinois.edu';
    update public.items set status = 'available', reserved_trade_id = null, sold_at = null
    where listing_id in (select id from public.listings where owner_id in (select id from race_users));
    delete from public.reports where reporter_id in (select id from race_users) or target_user_id in (select id from race_users);
    delete from public.trades where seller_id in (select id from race_users);
    delete from public.chats where owner_id in (select id from race_users);
    delete from public.listings where owner_id in (select id from race_users);
    delete from public.profiles where id in (select id from race_users);
    delete from auth.users where id in (select id from race_users)$q$);
$$;

-- People and listings, committed by the setup connection. Fresh addresses each run.
select pg_temp.open('setup');
select pg_temp.cleanup();
insert into pg_temp.ids
select who, pg_temp.value('setup', format($q$
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', %L, now(), '{}', '{}', now(), now())
  returning id$q$, 'race-' || who || '-' || substr(md5(random()::text), 1, 8) || '@illinois.edu'))::uuid
from unnest(array['seller', 'buyer1', 'buyer2', 'buyer3', 'earner']) who;
select pg_temp.run('setup', format($q$update public.profiles set display_name = 'race_' || substr(md5(id::text), 1, 12)
                                    where id in (%L, %L, %L, %L)$q$,
                                    pg_temp.id('seller'), pg_temp.id('buyer1'), pg_temp.id('buyer2'), pg_temp.id('buyer3')));

do $$
declare
  c text;
begin
  foreach c in array array['seller1', 'seller2', 'buyer1', 'buyer2', 'buyer3', 'job'] loop
    perform pg_temp.open(c);
    insert into pg_temp.pids values (c, pg_temp.value(c, 'select pg_backend_pid()')::int);
  end loop;
end;
$$;
select pg_temp.act_as('seller1', pg_temp.id('seller')), pg_temp.act_as('seller2', pg_temp.id('seller')),
       pg_temp.act_as('buyer1', pg_temp.id('buyer1')), pg_temp.act_as('buyer2', pg_temp.id('buyer2')),
       pg_temp.act_as('buyer3', pg_temp.id('buyer3'));

-- A bundle of six items: one fought over, two for the job races, two for the pair race, one for
-- accept against withdraw.
insert into pg_temp.ids values ('sale', pg_temp.value('seller1', format($q$
  select public.create_listing(jsonb_build_object('kind', 'bundle', 'title', 'Race sale', 'category', 'furniture',
    'subcategory', 'desks', 'items', (select jsonb_agg(jsonb_build_object('name', n, 'price_cents', 1000, 'condition', 'good'))
                                      from unnest(array['A', 'B', 'C', 'D', 'E', 'F']) n),
    'photos', jsonb_build_array(jsonb_build_object('path', %L, 'thumb_path', %L, 'blurhash', 'L', 'bytes', 1, 'item_position', 1))),
    gen_random_uuid()) ->> 'id'$q$, pg_temp.id('seller') || '/race.webp', pg_temp.id('seller') || '/race_t.webp'))::uuid);
insert into pg_temp.ids
select 'item_' || n, pg_temp.value('setup', format($q$select id from public.items where listing_id = %L and name = %L$q$, pg_temp.id('sale'), n))::uuid
from unnest(array['A', 'B', 'C', 'D', 'E', 'F']) n;

create function pg_temp.propose(p_conn text, p_item text) returns uuid
language sql as $$
  select pg_temp.value(p_conn, format($q$
    select public.propose_trade((public.get_or_create_chat(%L) ->> 'chat_id')::uuid,
      jsonb_build_object('item_ids', jsonb_build_array(%L), 'total_cents', 1000, 'meet_at', now() + interval '1 day', 'place_text', 'Union'),
      gen_random_uuid()) ->> 'id'$q$, pg_temp.id('sale'), pg_temp.id(p_item)))::uuid;
$$;

-- 1. Two acceptances of one item (4.18 #2): the second waits for the first and reserves nothing.
insert into pg_temp.ids values ('t1', pg_temp.propose('buyer1', 'item_A')), ('t2', pg_temp.propose('buyer2', 'item_A'));
select pg_temp.hold('seller1', format('public.accept_trade(%L)', pg_temp.id('t1')));
select pg_temp.start('seller2', format('select public.accept_trade(%L) ->> %L', pg_temp.id('t2'), 'status'));
select ok(pg_temp.waiting('seller2'), 'a second acceptance of the same item waits for the first');
select pg_temp.run('seller1', 'commit');
select is(pg_temp.result('seller2'), 'ITEM_UNAVAILABLE', 'and then fails, since the item is reserved');
select is(pg_temp.value('setup', format($q$select (select reserved_trade_id from public.items where id = %L) || ' ' ||
                                          (select status from public.trades where id = %L)$q$, pg_temp.id('item_A'), pg_temp.id('t2'))),
  pg_temp.id('t1') || ' proposed', 'the item is reserved for the first trade only');

-- Accepted trades for the job races: due, with the buyer's confirmation from 73 hours ago.
create function pg_temp.due_trade(p_buyer text, p_item text) returns uuid
language plpgsql as $$
declare
  v_trade uuid := pg_temp.propose(p_buyer, p_item);
begin
  perform pg_temp.value('seller1', format('select public.accept_trade(%L) ->> %L', v_trade, 'id'));
  perform pg_temp.run('setup', format($q$
    update public.trades set meet_at = now() - interval '73 hours', next_check_at = now() - interval '1 minute' where id = %1$L;
    insert into public.trade_confirmations (trade_id, user_id) values (%1$L, %2$L)$q$, v_trade, pg_temp.id(p_buyer)));
  return v_trade;
end;
$$;
create function pg_temp.completions(p_trade uuid) returns text
language sql as $$
  select pg_temp.value('setup', format($q$select (select status from public.trades where id = %1$L) || ' ' ||
    (select count(*) from public.messages where meta ->> 'trade_id' = %1$L and meta ->> 'status' = 'completed')$q$, p_trade));
$$;

-- 2. The user confirms while the job runs (4.18 #4): the job skips the locked trade.
insert into pg_temp.ids values ('t3', pg_temp.due_trade('buyer1', 'item_B'));
select pg_temp.hold('seller1', format('public.confirm_trade(%L)', pg_temp.id('t3')));
select pg_temp.value('job', 'select private.trades_advance()');
select is(pg_temp.completions(pg_temp.id('t3')), 'accepted 0', 'the job passes over a trade a user is completing');
select pg_temp.run('seller1', 'commit');
select is(pg_temp.completions(pg_temp.id('t3')), 'completed 1', 'which completes once');

-- 3. The job completes while the user confirms: the user waits and is told it is done.
insert into pg_temp.ids values ('t4', pg_temp.due_trade('buyer2', 'item_C'));
select pg_temp.hold('job', 'private.trades_advance()');
select pg_temp.start('seller2', format('select public.confirm_trade(%L) ->> %L', pg_temp.id('t4'), 'completed'));
select ok(pg_temp.waiting('seller2'), 'a confirmation waits while the job holds the trade');
select pg_temp.run('job', 'commit');
select is(pg_temp.result('seller2'), 'true', 'and then reports the trade completed');
select is(pg_temp.completions(pg_temp.id('t4')), 'completed 1', 'which completed once');

-- 4. Two trades of one pair complete together (4.18 #6): the pair lock lets only one count.
insert into pg_temp.ids values ('t5', pg_temp.propose('buyer3', 'item_D')), ('t6', pg_temp.propose('buyer3', 'item_E'));
select pg_temp.value('seller1', format('select public.accept_trade(%L) ->> %L', pg_temp.id('t5'), 'id')),
       pg_temp.value('seller1', format('select public.accept_trade(%L) ->> %L', pg_temp.id('t6'), 'id'));
select pg_temp.run('setup', format($q$update public.trades set meet_at = now() - interval '1 hour' where id in (%1$L, %2$L);
  insert into public.trade_confirmations (trade_id, user_id) values (%1$L, %3$L), (%2$L, %3$L)$q$,
  pg_temp.id('t5'), pg_temp.id('t6'), pg_temp.id('buyer3')));
select pg_temp.hold('seller1', format('public.confirm_trade(%L)', pg_temp.id('t5')));
select pg_temp.start('seller2', format('select public.confirm_trade(%L) ->> %L', pg_temp.id('t6'), 'completed'));
select ok(pg_temp.waiting('seller2'), 'the second completion of a pair waits for the first');
select pg_temp.run('seller1', 'commit');
select pg_temp.result('seller2');
select is(pg_temp.value('setup', format($q$select string_agg((counted_seller or counted_buyer)::text, ' ' order by completed_at)
                                          from public.trades where id in (%L, %L)$q$, pg_temp.id('t5'), pg_temp.id('t6'))),
  'true false', 'and only the first counts');

-- 5. Accept against withdraw (4.18 #3): the withdrawal waits and finds the trade accepted.
insert into pg_temp.ids values ('t7', pg_temp.propose('buyer2', 'item_F'));
select pg_temp.hold('seller1', format('public.accept_trade(%L)', pg_temp.id('t7')));
select pg_temp.start('buyer2', format('select public.withdraw_trade(%L) ->> %L', pg_temp.id('t7'), 'status'));
select ok(pg_temp.waiting('buyer2'), 'a withdrawal waits for an acceptance in progress');
select pg_temp.run('seller1', 'commit');
select is(pg_temp.result('buyer2'), 'INVALID_STATE', 'and then fails, since the trade is accepted');

-- 6. One chat opened twice at once (4.18 #1).
insert into pg_temp.ids values ('lamp', pg_temp.value('seller1', format($q$
  select public.create_listing(jsonb_build_object('kind', 'item', 'title', 'Race lamp', 'category', 'furniture', 'subcategory', 'desks',
    'items', jsonb_build_array(jsonb_build_object('name', 'Lamp', 'price_cents', 500, 'condition', 'good')),
    'photos', jsonb_build_array(jsonb_build_object('path', %L, 'thumb_path', %L, 'blurhash', 'L', 'bytes', 1, 'item_position', 1))),
    gen_random_uuid()) ->> 'id'$q$, pg_temp.id('seller') || '/lamp.webp', pg_temp.id('seller') || '/lamp_t.webp'))::uuid);
select pg_temp.act_as('seller2', pg_temp.id('buyer1'));
select pg_temp.hold('buyer1', format('public.get_or_create_chat(%L)', pg_temp.id('lamp')));
select pg_temp.start('seller2', format('select public.get_or_create_chat(%L) ->> %L', pg_temp.id('lamp'), 'created'));
select ok(pg_temp.waiting('seller2'), 'a second open of the same chat waits for the first');
select pg_temp.run('buyer1', 'commit');
select is(pg_temp.result('seller2') || ' ' || pg_temp.value('setup', format($q$select count(*) from public.chats where listing_id = %L$q$, pg_temp.id('lamp'))),
  'false 1', 'opening one chat twice at once gives one chat');

-- 7. Two awards near the daily cap (4.18 #7): the wallet lock makes the second see the first.
select pg_temp.value('setup', format('select private.award_points(%L, %L, %L, 190)', pg_temp.id('earner'), 'checkin', 'race-base'));
select pg_temp.hold('setup', format('private.award_points(%L, %L, %L)', pg_temp.id('earner'), 'review', 'race-a'));
select pg_temp.start('job', format('select private.award_points(%L, %L, %L)', pg_temp.id('earner'), 'review', 'race-b'));
select ok(pg_temp.waiting('job'), 'a second award waits for the first');
select pg_temp.run('setup', 'commit');
select is(pg_temp.result('job') || ' ' || pg_temp.value('setup', format($q$select balance from public.wallets where user_id = %L$q$, pg_temp.id('earner'))),
  '0 200', 'and then earns nothing past the cap');

-- 8. The 2nd and 3rd reports of a listing at once (4.18 #19): the listing lock makes the 3rd count the 2nd.
select pg_temp.value('buyer1', format($q$select public.report('listing', %L, 'scam') ->> 'status'$q$, pg_temp.id('lamp')));
select pg_temp.hold('buyer2', format($q$public.report('listing', %L, 'scam')$q$, pg_temp.id('lamp')));
select pg_temp.start('buyer3', format($q$select public.report('listing', %L, 'scam') ->> 'status'$q$, pg_temp.id('lamp')));
select ok(pg_temp.waiting('buyer3'), 'a third report waits for the second');
select pg_temp.run('buyer2', 'commit');
select is(pg_temp.result('buyer3') || ' ' || pg_temp.value('setup', format($q$select hidden::text from public.listings where id = %L$q$, pg_temp.id('lamp'))),
  'open true', 'and then counts it and hides the listing');

-- Remove everything the connections made, including what a failed earlier run left behind.
select pg_temp.cleanup();
select is(pg_temp.value('setup', $q$select count(*) from auth.users where email like 'race-%@illinois.edu'$q$), '0',
  'the race data is removed');
select extensions.dblink_disconnect(c) from unnest(extensions.dblink_get_connections()) c;

select * from finish();
rollback;
