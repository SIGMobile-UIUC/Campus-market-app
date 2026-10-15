-- feed and search_listings: markets, shopping modes, filters, sorting, paging and typo search (spec 4.8, 6.4).
begin;
\ir _helpers.psql
select plan(24);
select tests.build_matrix();

-- Listing ids, in result order, for a search as the current user.
create function tests.found(p_q text, p_scope text, p_filters jsonb default '{}', p_sort text default 'newest',
                            p_cursor jsonb default null, p_limit int default 20) returns uuid[]
language sql as $$
  select coalesce(array_agg((r ->> 'id')::uuid order by n), '{}')
  from jsonb_array_elements(public.search_listings(p_q, p_scope, p_filters, p_sort, p_cursor, p_limit) -> 'rows')
       with ordinality as x(r, n);
$$;
create function tests.ids_of(variadic p_names text[]) returns uuid[]
language sql stable as $$
  select array_agg(tests.id(n) order by i) from unnest(p_names) with ordinality as x(n, i);
$$;

select tests.remember('desk', tests.create_listing_as('alpha1', '{"title": "Standing desk",
  "items": [{"name": "Standing desk", "price_cents": 4000, "condition": "good"}]}'));
select tests.remember('lamp', tests.create_listing_as('alpha1', '{"title": "Desk lamp", "visibility": "open",
  "category": "decor_and_storage", "subcategory": "lamps_and_lighting",
  "items": [{"name": "Desk lamp", "price_cents": 800, "condition": "like_new"}]}'));
select tests.remember('fan', tests.create_listing_as('alpha1', '{"title": "Box fan", "category": "appliances",
  "subcategory": "fans_and_heaters", "items": [{"name": "Box fan", "price_cents": 0, "condition": "good"}]}'));
select tests.remember('sale', tests.create_listing_as('alpha1', '{"kind": "bundle", "title": "Move-out sale",
  "items": [{"name": "Rug", "price_cents": 500, "condition": "fair"}, {"name": "Chair", "price_cents": 1500, "condition": "good"}]}'));
select tests.remember('book', tests.create_listing_as('alpha1', '{"title": "Intro to CS textbook", "category": "textbooks",
  "subcategory": "by_course_code", "course_code": "CS 124", "items": [{"name": "Textbook", "price_cents": 2500, "condition": "good"}]}'));
select tests.remember('wanted', tests.create_listing_as('alpha1', '{"kind": "wanted", "title": "Looking for a bike lock",
  "category": "bikes_and_scooters", "subcategory": "locks", "items": [], "photos": [], "budget_cents": 1000}'));
select tests.remember('sold', tests.create_listing_as('alpha1', '{"title": "Sold printer"}'));
select tests.remember('hidden', tests.create_listing_as('alpha1', '{"title": "Hidden mirror"}'));
select tests.remember('fridge', tests.create_listing_as('general1', '{"title": "Mini fridge", "category": "appliances",
  "subcategory": "mini_fridges", "items": [{"name": "Mini fridge", "price_cents": 5000, "condition": "good"}]}'));
update public.items set status = 'sold', sold_at = now() where listing_id = tests.id('sold');
update public.listings set hidden = true where id = tests.id('hidden');

-- Markets.
select tests.login_as(tests.user_id('alpha2'));
select set_eq($$ select unnest(tests.found(null, 'campus')) $$, tests.ids_of('desk', 'lamp', 'fan', 'sale', 'book'),
  'the campus feed holds the campus''s active listings, without wanted requests, sold-out or hidden ones');
select tests.login_as(tests.user_id('beta1'));
select set_eq($$ select unnest(tests.found(null, 'open')) $$, tests.ids_of('lamp', 'fridge'),
  'the open feed holds open listings from every school and general users');
select tests.login_as(tests.user_id('general1'));
select throws_ok($$ select public.feed('campus') $$, 'P0001', 'CAMPUS_REQUIRED', 'general users have no campus feed');
select tests.login_as(tests.user_id('alpha2'));
select throws_ok($$ select public.search_listings(null, 'campus', '{}', 'cheapest') $$, 'P0001', 'VALIDATION_FAILED', 'unknown sorts are rejected');

-- Shopping modes (DSC-11).
select is(tests.found(null, 'campus', '{"mode": "free"}'), tests.ids_of('fan'), 'Free shows free items');
select is(tests.found(null, 'campus', '{"mode": "move_out"}'), tests.ids_of('sale'), 'Move-out shows sales');
select is(tests.found(null, 'campus', '{"mode": "wanted"}'), tests.ids_of('wanted'), 'Wanted shows requests');
select set_eq($$ select unnest(tests.found(null, 'campus', '{"mode": "under_10"}')) $$, tests.ids_of('lamp', 'fan', 'sale'),
  'Under $10 uses the item price or a sale''s lowest price');
select is(tests.found(null, 'campus', '{"mode": "course"}'), tests.ids_of('book'), 'By course shows listings with a course code');

-- Filters.
select is(tests.found(null, 'campus', '{"category": "appliances"}'), tests.ids_of('fan'), 'category filter');
select is(tests.found(null, 'campus', '{"category": "decor_and_storage", "subcategory": "lamps_and_lighting"}'), tests.ids_of('lamp'), 'subcategory filter');
select is(tests.found(null, 'campus', '{"condition": "fair"}'), tests.ids_of('sale'), 'condition filter looks at available items');
select set_eq($$ select unnest(tests.found(null, 'campus', '{"price_min": 1000, "price_max": 4000}')) $$, tests.ids_of('desk', 'book'), 'price range filter');

-- Sorting and paging.
select is(tests.found(null, 'campus', '{}', 'price_asc'), tests.ids_of('fan', 'sale', 'lamp', 'book', 'desk'), 'price low to high');
select is(tests.found(null, 'campus', '{}', 'price_desc'), tests.ids_of('desk', 'book', 'lamp', 'sale', 'fan'), 'price high to low');
create temp table pages as
  with p1 as (select public.search_listings(null, 'campus', '{}', 'price_asc', null, 2) as r),
       p2 as (select public.search_listings(null, 'campus', '{}', 'price_asc', (select r -> 'next_cursor' from p1), 2) as r),
       p3 as (select public.search_listings(null, 'campus', '{}', 'price_asc', (select r -> 'next_cursor' from p2), 2) as r)
  select (select r from p1) as p1, (select r from p2) as p2, (select r from p3) as p3;
select is(
  (select array_agg((x ->> 'id')::uuid) from pages, jsonb_array_elements((p1 -> 'rows') || (p2 -> 'rows') || (p3 -> 'rows')) x),
  tests.ids_of('fan', 'sale', 'lamp', 'book', 'desk'),
  'three pages of two cover every listing once, in order'
);
select is((select p3 -> 'next_cursor' from pages), 'null'::jsonb, 'the last page has no next cursor');
reset role;
update public.listings set bumped_at = now() + interval '1 minute' where id = tests.id('desk');
select tests.login_as(tests.user_id('alpha2'));
select is((tests.found(null, 'campus'))[1], tests.id('desk'), 'the newest feed follows bumped_at');
select is(
  (select array_length(tests.found(null, 'campus', '{}', 'newest', public.feed('campus', '{}', null, 3) -> 'next_cursor'), 1)),
  2, 'newest paging continues after the cursor'
);

-- Search.
select is(tests.found('standing desk', 'campus'), tests.ids_of('desk'), 'full-text search');
select tests.login_as(tests.user_id('beta1'));
select is(tests.found('frdge', 'open'), tests.ids_of('fridge'), 'a typo still finds similar titles');
select is(tests.found('standing desk', 'open'), '{}'::uuid[], 'search stays inside the market');

-- Row shape and owners.
select tests.login_as(tests.user_id('alpha2'));
select is(
  (select r - 'id' - 'bumped_at' - 'thumb_path' - 'blurhash'
   from jsonb_array_elements(public.feed('campus') -> 'rows') r where (r ->> 'id')::uuid = tests.id('sale')),
  '{"kind": "bundle", "title": "Move-out sale", "price_cents": 500, "item_count": 2, "status": "active", "campus_only": true,
    "owner": {"display_name": "alpha1", "tier": "b", "campus_slug": "alpha"}, "zone": null, "area_label": "Alpha University"}'::jsonb,
  'a row carries price, count, owner, area and market'
);
reset role;
update public.profiles set status = 'suspended' where id = tests.user_id('alpha1');
select tests.login_as(tests.user_id('beta1'));
select is(tests.found(null, 'open'), tests.ids_of('fridge'), 'listings of a suspended owner drop out of feeds');

select * from finish();
rollback;
