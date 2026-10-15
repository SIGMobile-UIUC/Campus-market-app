-- create_listing, update_listing, close/reopen/delete, mark_sold_elsewhere and the listing triggers
-- (spec 4.7, 5.2, 5.3.4, 6.4).
begin;
\ir _helpers.psql
select plan(45);
select tests.build_matrix();

-- Area, visibility and market by owner.
select tests.remember('desk', tests.create_listing_as('alpha1'));
select is((select area_label || ' ' || visibility from public.listings where id = tests.id('desk')), 'Alpha University campus', 'students post to their campus by default, labeled with the campus');
select tests.remember('gen', tests.create_listing_as('general1'));
select is((select area_label || ' ' || visibility || ' ' || zip from public.listings where id = tests.id('gen')), 'Champaign, IL open 61820', 'general users post to the open market around their ZIP code');
select tests.remember('wait', tests.create_listing_as('gamma1'));
select is((select area_label || ' ' || visibility from public.listings where id = tests.id('wait')), 'Gamma University open', 'waitlist students post to the open market with their school as the area');

select tests.login_as(tests.user_id('general1'));
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('general1'), '{"visibility": "campus"}'), gen_random_uuid()) $$,
  'P0001', 'CAMPUS_REQUIRED', 'campus-only posting needs a live campus');
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('general1'), '{"zip": "99999"}'), gen_random_uuid()) $$,
  'P0001', 'ZIP_REQUIRED', 'an unknown ZIP code is rejected');

-- Shape by kind.
select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"items": [
    {"name": "A", "price_cents": 100, "condition": "good"}, {"name": "B", "price_cents": 100, "condition": "good"}]}'), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'an item listing has exactly one item');
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"kind": "bundle"}'), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'a move-out sale needs at least two items');
select lives_ok($$ select tests.remember('sale', (public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"kind": "bundle", "title": "Move-out sale", "items": [
    {"name": "Lamp", "price_cents": 500, "condition": "good"}, {"name": "Rug", "price_cents": 1500, "condition": "fair"},
    {"name": "Fan", "price_cents": 0, "condition": "like_new"}]}'), gen_random_uuid()) ->> 'id')::uuid) $$,
  'a move-out sale with three items');
select is((select count(*)::int from public.items where listing_id = tests.id('sale')), 3, 'each item of the sale is stored');
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"kind": "wanted", "photos": []}'), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'a wanted request has no items');
select lives_ok($$ select tests.remember('wanted', (public.create_listing(tests.listing_payload(tests.user_id('alpha1'),
    '{"kind": "wanted", "title": "Looking for a mini fridge", "category": "appliances", "subcategory": "mini_fridges", "items": [], "photos": [], "budget_cents": 6000}'),
    gen_random_uuid()) ->> 'id')::uuid) $$,
  'a wanted request with a budget');
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"budget_cents": 100}'), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'only wanted requests have a budget');
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"subcategory": "tickets"}'), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'the subcategory must belong to the category');
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"payment_methods": ["bitcoin"]}'), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'unknown payment methods are rejected');

-- Photos are the caller's own uploads.
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"photos": []}'), gen_random_uuid()) $$,
  'P0001', 'VALIDATION_FAILED', 'an item listing needs a photo');
select throws_ok(format($$ select public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"photos": [
    {"path": "%1$s/x.webp", "thumb_path": "%1$s/x_t.webp", "blurhash": "L", "bytes": 1, "item_position": 1}]}'), gen_random_uuid()) $$, tests.user_id('alpha2')),
  'P0001', 'VALIDATION_FAILED', 'photos from another user''s folder are rejected');

-- Prohibited words, without blocking ordinary listings that share a word.
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"title": "JUUL pods, unopened"}'), gen_random_uuid()) $$,
  'P0001', 'PROHIBITED_CONTENT', 'a prohibited word in the title is blocked');
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"items": [{"name": "Concert tickets", "price_cents": 100, "condition": "new"}]}'), gen_random_uuid()) $$,
  'P0001', 'PROHIBITED_CONTENT', 'a prohibited phrase in an item name is blocked');
select lives_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"title": "Wine glasses and Ticket to Ride"}'), gen_random_uuid()) $$,
  'ordinary items that share a word are allowed');

-- Retries and limits.
select tests.remember('req', gen_random_uuid());
select is(
  (select count(distinct (public.create_listing(tests.listing_payload(tests.user_id('alpha1'), '{"title": "Retry me"}'), tests.id('req')) ->> 'id'))::int
   from generate_series(1, 2)),
  1, 'a retried request returns the same listing'
);
reset role;
update public.app_config set value = '{"listings_per_day": {"student": 20, "general": 2}}' where key = 'limits';
select tests.create_listing_as('general1', '{"title": "Second today"}');
select tests.login_as(tests.user_id('general1'));
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('general1')), gen_random_uuid()) $$,
  'P0001', 'LIMIT_REACHED', 'the daily posting limit holds');
select tests.login_as(tests.user_id('suspended'));
select throws_ok($$ select public.create_listing(tests.listing_payload(tests.user_id('suspended')), gen_random_uuid()) $$,
  'P0001', 'ACCOUNT_SUSPENDED', 'suspended users cannot post');

-- Editing.
select tests.login_as(tests.user_id('alpha1'));
select is(
  (public.update_listing(tests.id('desk'), '{"title": "Standing desk", "items": [{"position": 1, "price_cents": 3500}]}') #>> '{items,0,price_cents}'),
  '3500', 'the owner edits title and price'
);
select throws_ok($$ select public.update_listing(tests.id('desk'), '{"title": "Nicotine pouches"}') $$,
  'P0001', 'PROHIBITED_CONTENT', 'edits pass the word filter too');
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.update_listing(tests.id('desk'), '{"title": "Mine now"}') $$, 'P0001', 'FORBIDDEN', 'others cannot edit');
select throws_ok($$ select public.update_listing(gen_random_uuid(), '{"title": "Nothing"}') $$, 'P0001', 'NOT_FOUND', 'a missing listing is not found');

reset role;
update public.items set status = 'reserved', reserved_trade_id = gen_random_uuid() where listing_id = tests.id('sale') and position = 1;
select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.update_listing(tests.id('sale'), '{"items": [{"position": 1, "price_cents": 100}]}') $$,
  'P0001', 'ITEM_UNAVAILABLE', 'a reserved item''s price cannot change');
select throws_ok($$ select public.update_listing(tests.id('sale'), '{"items": [{"position": 1, "remove": true}]}') $$,
  'P0001', 'ITEM_UNAVAILABLE', 'a reserved item cannot be removed');
select is(
  jsonb_array_length(public.update_listing(tests.id('sale'), '{"items": [{"position": 4, "name": "Mirror", "price_cents": 800, "condition": "good"}]}') -> 'items'),
  4, 'items can be added to a sale while another is reserved'
);
select throws_ok($$ do $do$ begin
    perform public.update_listing(tests.id('desk'), '{"items": [{"position": 2, "name": "Chair", "price_cents": 800, "condition": "good"}]}');
    set constraints all immediate;
  end $do$ $$,
  'P0001', 'VALIDATION_FAILED', 'an item listing cannot grow a second item (checked at commit)');

-- Selling and status.
select throws_ok(format($$ select public.mark_sold_elsewhere(array['%s']::uuid[]) $$,
    (select id from public.items where listing_id = tests.id('sale') and position = 1)),
  'P0001', 'ITEM_UNAVAILABLE', 'a reserved item cannot be marked sold elsewhere');
select lives_ok($$ select public.mark_sold_elsewhere(array(select id from public.items where listing_id = tests.id('sale') and position > 1)) $$,
  'the available items are marked sold elsewhere');
select is((select status::text from public.listings where id = tests.id('sale')), 'active', 'the sale stays active while an item is reserved');
reset role;
update public.items set status = 'sold', sold_at = now(), reserved_trade_id = null where listing_id = tests.id('sale') and position = 1;
select is((select status::text from public.listings where id = tests.id('sale')), 'sold_out', 'the sale sells out when every item is sold');
select ok((select photos_purge_after between now() + interval '29 days' and now() + interval '31 days' from public.listings where id = tests.id('sale')),
  'photos of a sold-out listing are due for removal in 30 days');
update public.items set status = 'available', sold_at = null where listing_id = tests.id('sale') and position = 1;
select is((select status::text || coalesce(photos_purge_after::text, '') from public.listings where id = tests.id('sale')), 'active', 'an item returning makes the sale active again');

select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.mark_sold_elsewhere(array(select id from public.items where listing_id = tests.id('desk'))) $$,
  'P0001', 'FORBIDDEN', 'others cannot mark items sold');

-- Close, reopen, delete.
select tests.login_as(tests.user_id('alpha1'));
select ok((select (public.close_listing(tests.id('desk')) ->> 'photos_purge_after')::timestamptz > now() + interval '89 days'),
  'closing schedules photo removal in 90 days');
select throws_ok($$ select public.close_listing(tests.id('desk')) $$, 'P0001', 'INVALID_STATE', 'a closed listing cannot be closed again');
select is((public.reopen_listing(tests.id('desk')) ->> 'status'), 'active', 'the owner reopens it');
select lives_ok($$ select public.close_listing(tests.id('desk')) $$, 'and closes it again');
reset role;
update public.listing_photos set path = null where listing_id = tests.id('desk');
select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.reopen_listing(tests.id('desk')) $$, 'P0001', 'VALIDATION_FAILED', 'a listing whose photos were removed needs new photos to reopen');
reset role;
update public.items set status = 'reserved', reserved_trade_id = gen_random_uuid() where listing_id = tests.id('sale') and position = 1;
select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.delete_listing(tests.id('sale')) $$, 'P0001', 'ITEM_UNAVAILABLE', 'a listing with a reserved item cannot be deleted');
select lives_ok($$ select public.delete_listing(tests.id('wanted')) $$, 'the owner deletes a listing');
select ok((select deleted_at is not null and photos_purge_after > now() + interval '29 days' from public.listings where id = tests.id('wanted')),
  'a deleted listing is marked and its photos are due for removal in 30 days');

select * from finish();
rollback;
