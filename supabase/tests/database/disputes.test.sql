-- No-show disputes (DSP-1 to DSP-7): the claim window and checks, the response, withdrawal, the move to
-- review, counter-claims, the admin decision with penalties, and who sees the evidence.
begin;
\ir _helpers.psql
select plan(19);
select tests.build_matrix();

insert into tests.matrix (name, id) values ('alpha_admin', tests.create_user('admin@alpha.edu'));
update public.profiles set display_name = 'alpha_admin' where id = tests.user_id('alpha_admin');
insert into public.user_roles (user_id, role, campus_id)
values (tests.user_id('alpha_admin'), 'campus_admin', (select campus_id from public.profiles where id = tests.user_id('alpha1')));

-- An accepted trade of a new listing whose meetup was an hour ago.
create function tests.accepted(p_seller text, p_buyer text) returns uuid
language plpgsql as $$
declare
  v_listing uuid := tests.create_listing_as(p_seller);
  v_trade   uuid;
begin
  perform tests.login_as(tests.user_id(p_buyer));
  v_trade := (public.propose_trade((public.get_or_create_chat(v_listing) ->> 'chat_id')::uuid,
    jsonb_build_object('item_ids', (select jsonb_agg(id) from public.items where listing_id = v_listing),
                       'total_cents', 4000, 'meet_at', now() + interval '1 day', 'place_text', 'Union'), gen_random_uuid()) ->> 'id')::uuid;
  perform tests.login_as(tests.user_id(p_seller));
  perform public.accept_trade(v_trade);
  perform set_config('role', 'none', true);
  update public.trades set meet_at = now() - interval '1 hour' where id = v_trade;
  return v_trade;
end;
$$;
create function tests.trade_status(p_trade text) returns text language sql as $$
  select status::text from public.trades where id = tests.id(p_trade);
$$;

-- Opening (DSP-1, DSP-3).
select tests.remember('t1', tests.accepted('alpha1', 'alpha2'));
update public.trades set meet_at = now() + interval '1 hour' where id = tests.id('t1');
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.open_dispute(tests.id('t1'), 'no_show', 'They never came') $$, 'P0001', 'WINDOW_CLOSED',
  'claims open 15 minutes after the meetup');
reset role;
update public.trades set meet_at = now() - interval '1 hour' where id = tests.id('t1');
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.open_dispute(tests.id('t1'), 'no_show', 'They never came', array[tests.id('t1') || '/' || tests.user_id('alpha1') || '/a.webp']) $$,
  'P0001', 'VALIDATION_FAILED', 'photos are the claimant''s own uploads');
select tests.remember('d1', (public.open_dispute(tests.id('t1'), 'no_show', 'They never came',
  array[tests.id('t1') || '/' || tests.user_id('alpha2') || '/a.webp']) ->> 'id')::uuid);
reset role;
select is(tests.trade_status('t1') || ' ' || (select status::text from public.disputes where id = tests.id('d1')), 'disputed awaiting_response',
  'a claim puts the trade in dispute');
select is((select payload ->> 'title' from public.notifications where user_id = tests.user_id('alpha1') and type = 'disputes'),
  'No-show reported', 'the other side is told');
select tests.login_as(tests.user_id('beta1'));
select throws_ok($$ select public.open_dispute(tests.id('t1'), 'no_show', 'x') $$, 'P0001', 'NOT_PARTY', 'only the two sides claim');
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.open_dispute(tests.id('t1'), 'no_show', 'Again') $$, 'P0001', 'ALREADY_EXISTS', 'once per side');

-- The response (DSP-5).
select throws_ok($$ select public.respond_dispute(tests.id('d1'), 'Me?') $$, 'P0001', 'FORBIDDEN', 'only the other side responds');
select tests.login_as(tests.user_id('alpha1'));
select is(public.respond_dispute(tests.id('d1'), 'I waited 30 minutes', array[tests.id('t1') || '/' || tests.user_id('alpha1') || '/b.webp']) ->> 'status',
  'under_review', 'a response sends the dispute to review');
select tests.login_as(tests.user_id('alpha2'));
select is((select array_agg(kind::text order by kind::text) from public.dispute_evidence), array['photo', 'photo', 'statement'],
  'both sides see all the evidence');
select throws_ok($$ select public.withdraw_dispute(tests.id('d1')) $$, 'P0001', 'INVALID_STATE', 'no withdrawal after a response');

-- Evidence photos: the parties and the reviewing admins read them.
reset role;
insert into storage.objects (bucket_id, name, owner) values ('dispute-evidence', tests.id('t1') || '/' || tests.user_id('alpha2') || '/a.webp', tests.user_id('alpha2'));
select tests.login_as(tests.user_id('alpha1'));
select is((select count(*)::int from storage.objects where bucket_id = 'dispute-evidence'), 1, 'the other side reads the photo');
select tests.login_as(tests.user_id('alpha3'));
select is((select count(*)::int from storage.objects where bucket_id = 'dispute-evidence'), 0, 'nobody else does');

-- The decision (DSP-6, DSP-7).
select tests.login_as(tests.user_id('alpha_admin'));
select is((select c ->> 'case_type' from jsonb_array_elements(public.admin_queue()) c where c ->> 'case_id' = tests.id('d1')::text),
  'dispute', 'disputes under review are in the queue');
select is(jsonb_array_length(public.admin_open_case_data('dispute', tests.id('d1'), 'evidence') -> 'evidence'), 3,
  'the case shows the evidence');
select public.admin_resolve_dispute(tests.id('d1'), 'upheld', false, 'No sign of the seller');
reset role;
select is(tests.trade_status('t1') || ' ' || (select string_agg(status::text, ',') from public.items where listing_id = (select listing_id from public.trades where id = tests.id('t1')))
          || ' ' || (select reason::text from public.penalties where source_id = tests.id('d1') and user_id = tests.user_id('alpha1')),
  'failed available no_show', 'upheld: the trade fails, its items return and the other side gets a no-show penalty');
select tests.login_as(tests.user_id('alpha_admin'));
select throws_ok($$ select public.admin_resolve_dispute(tests.id('d1'), 'rejected') $$, 'P0001', 'INVALID_STATE', 'decided once');

-- Withdrawal returns the trade to accepted.
select tests.remember('t2', tests.accepted('alpha1', 'alpha2'));
select tests.login_as(tests.user_id('alpha2'));
select public.withdraw_dispute((public.open_dispute(tests.id('t2'), 'no_show', 'Not here') ->> 'id')::uuid);
reset role;
select is(tests.trade_status('t2'), 'accepted', 'withdrawing the only claim puts the trade back');

-- Counter-claims: the deadline sends both to review, and the trade settles after the last decision.
select tests.remember('t3', tests.accepted('alpha1', 'alpha2'));
select tests.login_as(tests.user_id('alpha2'));
select tests.remember('d3', (public.open_dispute(tests.id('t3'), 'no_show', 'Not here') ->> 'id')::uuid);
select tests.login_as(tests.user_id('alpha1'));
select tests.remember('d4', (public.open_dispute(tests.id('t3'), 'no_show', 'You were not here either') ->> 'id')::uuid);
reset role;
update public.disputes set response_due_at = now() - interval '1 minute' where trade_id = tests.id('t3');
select is(private.disputes_advance(), 2, 'unanswered claims go to review at the deadline');
select tests.login_as(tests.user_id('alpha_admin'));
select public.admin_resolve_dispute(tests.id('d3'), 'rejected', true);
select public.admin_resolve_dispute(tests.id('d4'), 'rejected');
reset role;
select is(tests.trade_status('t3') || ' ' || (select reason::text from public.penalties where source_id = tests.id('d3')),
  'cancelled bad_faith', 'rejected claims cancel the trade, and a knowingly false one costs the claimant');

select * from finish();
rollback;
