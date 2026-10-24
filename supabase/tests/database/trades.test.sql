-- Trades: propose, accept with all-or-none reservation, decline, withdraw, cancel, confirm, completion
-- with counted flags, wanted-listing offers, my_trades and leaving (spec 4.10, 5.2, 6.6).
begin;
\ir _helpers.psql
select plan(53);
select tests.build_matrix();

insert into public.meetup_spots (campus_id, name, lat, lng)
select id, 'Union', 40, -88 from public.campuses where slug = 'alpha' returning tests.remember('spot', id);
insert into public.meetup_spots (campus_id, name, lat, lng)
select id, 'Library', 41, -87 from public.campuses where slug = 'beta' returning tests.remember('beta_spot', id);

-- A proposal for the given items; keys in p_extra replace the defaults.
create function tests.proposal(p_items text[], p_total int, p_extra jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object('item_ids', (select jsonb_agg(tests.id(n)) from unnest(p_items) n), 'total_cents', p_total,
                            'meet_at', now() + interval '1 day', 'spot_id', tests.id('spot')) || p_extra;
$$;
-- Proposes in the caller's chat on a listing and remembers the trade.
create function tests.propose(p_name text, p_listing text, p_proposal jsonb) returns uuid
language sql as $$
  select tests.remember(p_name, (public.propose_trade((public.get_or_create_chat(tests.id(p_listing)) ->> 'chat_id')::uuid,
                                                      p_proposal, gen_random_uuid()) ->> 'id')::uuid);
$$;
create function tests.status(p_trade text) returns text
language sql as $$ select status::text from public.trades where id = tests.id(p_trade); $$;
create function tests.item_status(p_item text) returns text
language sql as $$ select status::text from public.items where id = tests.id(p_item); $$;

-- An open move-out sale with three items, so a buyer from another campus can take part.
select tests.remember('sale', tests.create_listing_as('alpha1', '{"kind": "bundle", "visibility": "open", "title": "Move-out sale",
  "items": [{"name": "Lamp", "price_cents": 800, "condition": "good"}, {"name": "Rug", "price_cents": 2000, "condition": "fair"},
            {"name": "Fan", "price_cents": 0, "condition": "good"}]}'));
select tests.remember(lower(name), id) from public.items where listing_id = tests.id('sale');
select tests.remember('desk', tests.create_listing_as('alpha1', '{"visibility": "open", "title": "IKEA desk"}'));
select tests.remember('desk_item', id) from public.items where listing_id = tests.id('desk');
select tests.remember('chair', tests.create_listing_as('alpha1', '{"visibility": "open", "title": "Free chair",
  "items": [{"name": "Chair", "price_cents": 0, "condition": "good"}]}'));
select tests.remember('chair_item', id) from public.items where listing_id = tests.id('chair');
select tests.remember('want', tests.create_listing_as('alpha1', '{"kind": "wanted", "title": "Looking for a mini fridge",
  "category": "appliances", "subcategory": "mini_fridges", "items": [], "photos": [], "budget_cents": 6000}'));

-- Proposing (TRD-1).
select tests.login_as(tests.user_id('alpha2'));
select tests.remember('sale_chat', (public.get_or_create_chat(tests.id('sale')) ->> 'chat_id')::uuid);
select tests.remember('t1_req', gen_random_uuid());
select is(public.propose_trade(tests.id('sale_chat'), tests.proposal(array['lamp', 'rug'], 2500, '{"role": "buyer"}'), tests.id('t1_req')) ->> 'status',
  'proposed', 'a buyer proposes two items of a move-out sale');
select tests.remember('t1', (select id from public.trades where request_id = tests.id('t1_req')));
select is((select seller_id || ' ' || buyer_id from public.trades where id = tests.id('t1')), tests.user_id('alpha1') || ' ' || tests.user_id('alpha2'),
  'the listing owner is the seller');
select is((select array_agg(name || ' ' || price_cents order by line) from public.trade_items where trade_id = tests.id('t1')), array['Lamp 800', 'Rug 2000'],
  'item names and prices are copied into the trade');
select is(public.propose_trade(tests.id('sale_chat'), tests.proposal(array['lamp', 'rug'], 2500), tests.id('t1_req')) ->> 'id', tests.id('t1')::text,
  'a retry with the same request id returns the same trade');
select is((select meta from public.messages where chat_id = tests.id('sale_chat') order by seq desc limit 1),
  jsonb_build_object('event', 'trade', 'trade_id', tests.id('t1'), 'status', 'proposed'), 'the proposal appears as a card in the chat');
select is(tests.item_status('lamp'), 'available', 'proposals do not reserve');
select throws_ok($$ select public.propose_trade(tests.id('sale_chat'), tests.proposal(array['fan'], 0, '{"spot_id": null}'), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'a proposal needs a spot or a place');
select throws_ok($$ select public.propose_trade(tests.id('sale_chat'), tests.proposal(array['fan'], 0, jsonb_build_object('meet_at', now() - interval '1 hour')), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'the meetup time must be in the future');
select throws_ok($$ select public.propose_trade(tests.id('sale_chat'), tests.proposal(array['fan'], 0, jsonb_build_object('spot_id', tests.id('beta_spot'))), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'the spot must belong to the listing''s campus');
select tests.propose('t_place', 'sale', tests.proposal(array['fan'], 0, '{"spot_id": null, "place_text": "Green St Starbucks"}'));
select is((select place_text from public.trades where id = tests.id('t_place')), 'Green St Starbucks', 'a typed place works instead of a spot');
select throws_ok($$ select public.propose_trade(tests.id('sale_chat'), tests.proposal(array['desk_item'], 4000), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'items must belong to the chat''s listing');
select throws_ok($$ select public.propose_trade(tests.id('sale_chat'), tests.proposal(array['fan'], 0, '{"role": "seller"}'), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'the role must match the caller''s side');
select tests.login_as(tests.user_id('beta1'));
select throws_ok($$ select public.propose_trade(tests.id('sale_chat'), tests.proposal(array['fan'], 0), gen_random_uuid()) $$,
  'P0001', 'NOT_PARTY', 'outsiders cannot propose in the chat');
select lives_ok($$ select tests.propose('t2', 'sale', tests.proposal(array['rug', 'fan'], 1500)) $$, 'another buyer proposes an overlapping set');

-- Accepting (TRD-2, TRD-3).
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.accept_trade(tests.id('t1')) $$, 'P0001', 'INVALID_STATE', 'the proposer cannot accept their own proposal');
select tests.login_as(tests.user_id('alpha1'));
select is(public.accept_trade(tests.id('t1')) ->> 'status', 'accepted', 'the seller accepts');
select is((select array_agg(status::text || ' ' || (reserved_trade_id = tests.id('t1'))) from public.items where id in (tests.id('lamp'), tests.id('rug'))),
  array['reserved true', 'reserved true'], 'acceptance reserves every item of the trade');
select is(public.accept_trade(tests.id('t1')) ->> 'status', 'accepted', 'a repeated tap returns the accepted trade');
select throws_ok($$ select public.accept_trade(tests.id('t2')) $$, 'P0001', 'ITEM_UNAVAILABLE', 'a proposal with a reserved item cannot be accepted');
select is(tests.item_status('fan'), 'available', 'and nothing of it is reserved');
select is(public.decline_trade(tests.id('t2')) ->> 'status', 'declined', 'the seller declines');
select throws_ok($$ select public.decline_trade(tests.id('t1')) $$, 'P0001', 'INVALID_STATE', 'an accepted trade cannot be declined');

select tests.login_as(tests.user_id('beta1'));
select tests.propose('t3', 'sale', tests.proposal(array['fan'], 0));
select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.withdraw_trade(tests.id('t3')) $$, 'P0001', 'FORBIDDEN', 'only the proposer withdraws');
select tests.login_as(tests.user_id('beta1'));
select is(public.withdraw_trade(tests.id('t3')) ->> 'status', 'withdrawn', 'the proposer withdraws');
select is(public.withdraw_trade(tests.id('t3')) ->> 'status', 'withdrawn', 'withdrawing again returns the same trade');

-- Leaving waits for open trades (CHT-7).
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.leave_chat(tests.id('sale_chat')) $$, 'P0001', 'INVALID_STATE', 'a chat with an accepted trade cannot be left');

-- Completing (TRD-4, 4.10.4).
select throws_ok($$ select public.confirm_trade(tests.id('t1')) $$, 'P0001', 'WINDOW_CLOSED', 'confirming opens 30 minutes before the meetup');
reset role;
update public.trades set meet_at = now() - interval '1 hour' where id = tests.id('t1');
select tests.login_as(tests.user_id('alpha2'));
select is(public.confirm_trade(tests.id('t1')) ->> 'completed', 'false', 'the first confirmation does not complete the trade');
select is((select next_check_at from public.trades where id = tests.id('t1')), now() - interval '1 hour' + interval '72 hours',
  'it completes on its own 72 hours after the meetup unless the other side acts');
select lives_ok($$ select public.confirm_trade(tests.id('t1')) $$, 'confirming twice is harmless');
select is((select count(*)::int from public.trade_confirmations where trade_id = tests.id('t1')), 1, 'and records one confirmation');
select tests.login_as(tests.user_id('alpha1'));
select is(public.confirm_trade(tests.id('t1')) ->> 'completed', 'true', 'the second confirmation completes the trade');
select is((select array_agg(status::text order by position) from public.items where listing_id = tests.id('sale')), array['sold', 'sold', 'available'],
  'its items are sold and the rest stay available');
select is((select counted_seller and counted_buyer from public.trades where id = tests.id('t1')), true, 'a paid trade counts for both sides');
select tests.login_as(tests.user_id('alpha2'));
select tests.propose('t4', 'sale', tests.proposal(array['fan'], 500, jsonb_build_object('meet_at', now() + interval '10 minutes')));
select tests.login_as(tests.user_id('alpha1'));
select public.accept_trade(tests.id('t4'));
select public.confirm_trade(tests.id('t4'));
select tests.login_as(tests.user_id('alpha2'));
select public.confirm_trade(tests.id('t4'));
select is((select status::text || ' ' || counted_seller || ' ' || counted_buyer from public.trades where id = tests.id('t4')), 'completed false false',
  'the same pair counts once per 7 days');
select tests.login_as(tests.user_id('beta1'));
select tests.propose('t5', 'chair', tests.proposal(array['chair_item'], 0, jsonb_build_object('meet_at', now() + interval '10 minutes')));
select tests.login_as(tests.user_id('alpha1'));
select public.accept_trade(tests.id('t5'));
select public.confirm_trade(tests.id('t5'));
select tests.login_as(tests.user_id('beta1'));
select public.confirm_trade(tests.id('t5'));
select is((select counted_seller || ' ' || counted_buyer from public.trades where id = tests.id('t5')), 'true false',
  'a free trade counts for the giver only');
select is(tests.item_status('chair_item') || ' ' || (select status::text from public.listings where id = tests.id('chair')), 'sold sold_out',
  'selling the last item sells out the listing');

-- Cancelling (TRD-6).
select tests.propose('t6', 'desk', tests.proposal(array['desk_item'], 4000));
select tests.login_as(tests.user_id('alpha1'));
select public.accept_trade(tests.id('t6'));
select throws_ok($$ select public.cancel_trade(tests.id('t6'), ' ') $$, 'P0001', 'VALIDATION_FAILED', 'cancelling needs a reason');
select is(public.cancel_trade(tests.id('t6'), 'Sold it to a friend') ->> 'late_cancel_penalty', 'false', 'cancelling a day ahead carries no penalty');
select is(tests.item_status('desk_item'), 'available', 'and releases the items');
select is(public.cancel_trade(tests.id('t6'), 'Sold it to a friend') ->> 'late_cancel_penalty', 'false', 'cancelling again returns the same result');
select tests.login_as(tests.user_id('beta1'));
select tests.propose('t7', 'desk', tests.proposal(array['desk_item'], 4000, jsonb_build_object('meet_at', now() + interval '1 hour')));
select tests.login_as(tests.user_id('alpha1'));
select public.accept_trade(tests.id('t7'));
select tests.login_as(tests.user_id('beta1'));
select is(public.cancel_trade(tests.id('t7'), 'Can''t make it') ->> 'late_cancel_penalty', 'true', 'cancelling within 2 hours of the meetup is a late cancel');

-- Expiry and closed listings.
select tests.propose('t8', 'desk', tests.proposal(array['desk_item'], 4000));
reset role;
update public.trades set proposed_at = now() - interval '49 hours' where id = tests.id('t8');
select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.accept_trade(tests.id('t8')) $$, 'P0001', 'INVALID_STATE', 'a proposal older than 48 hours cannot be accepted');
select public.close_listing(tests.id('desk'));
select tests.login_as(tests.user_id('beta1'));
select throws_ok($$ select public.propose_trade((public.get_or_create_chat(tests.id('desk')) ->> 'chat_id')::uuid, tests.proposal(array['desk_item'], 4000), gen_random_uuid()) $$,
  'P0001', 'INVALID_STATE', 'a closed listing takes no proposals');

-- Offers on a wanted request: the responder is the seller and nothing is reserved.
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.propose_trade((public.get_or_create_chat(tests.id('want')) ->> 'chat_id')::uuid, tests.proposal(null, 5000), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'an offer describes the offered item');
select tests.propose('t9', 'want', tests.proposal(null, 5000, '{"role": "seller", "offer_items": [{"name": "Mini fridge, 3.2 cu ft", "price_cents": 5000}]}'));
select is((select seller_id || ' ' || buyer_id from public.trades where id = tests.id('t9')), tests.user_id('alpha2') || ' ' || tests.user_id('alpha1'),
  'on a wanted request the responder is the seller');
select tests.login_as(tests.user_id('alpha1'));
select is(public.accept_trade(tests.id('t9')) ->> 'status', 'accepted', 'the requester accepts the offer');

-- Visibility and history.
select tests.login_as(tests.user_id('gamma1'));
select is_empty($$ select 1 from public.trades union all select 1 from public.trade_items union all select 1 from public.trade_confirmations $$,
  'outsiders see no trades');
select tests.login_as(tests.user_id('alpha2'));
update public.trades set total_cents = 1 where id = tests.id('t1');
select is((select total_cents from public.trades where id = tests.id('t1')), 2500, 'parties cannot edit a trade directly');
select is((select jsonb_agg(r -> 'partner' ->> 'display_name') from jsonb_array_elements(public.my_trades('completed') -> 'rows') r), '["alpha1", "alpha1"]',
  'my trades lists completed trades with the other side');
select is(jsonb_array_length(public.my_trades('completed', null, 1) -> 'rows') || ' ' ||
          jsonb_array_length(public.my_trades('completed', public.my_trades('completed', null, 1) -> 'next_cursor', 1) -> 'rows'), '1 1',
  'and pages with the cursor');
select throws_ok($$ select public.my_trades('everything') $$, 'P0001', 'VALIDATION_FAILED', 'unknown status groups are rejected');
select public.withdraw_trade(tests.id('t_place'));
select lives_ok($$ select public.leave_chat(tests.id('sale_chat')) $$, 'a chat can be left once its trades are closed');

select * from finish();
rollback;
