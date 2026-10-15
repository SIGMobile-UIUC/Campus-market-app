-- TST-1: who sees which listings, items, photos and favorites, and the listing-photos bucket (spec 4.6.5).
begin;
\ir _helpers.psql
select plan(24);
select tests.build_matrix();

select tests.remember('campus', tests.create_listing_as('alpha1'));
select tests.remember('open', tests.create_listing_as('alpha1', '{"visibility": "open", "title": "Desk lamp"}'));
select tests.remember('general', tests.create_listing_as('general1'));
select tests.remember('hidden', tests.create_listing_as('alpha1', '{"title": "Hidden chair"}'));
select tests.remember('deleted', tests.create_listing_as('alpha1', '{"title": "Deleted shelf"}'));
update public.listings set hidden = true where id = tests.id('hidden');
update public.listings set deleted_at = now() where id = tests.id('deleted');

-- Campus-only listings reach only active students of the same live campus.
select tests.login_as(tests.user_id('alpha2'));
select isnt_empty($$ select 1 from public.listings where id = tests.id('campus') $$, 'same campus sees a campus listing');
select isnt_empty($$ select 1 from public.items where listing_id = tests.id('campus') $$, 'same campus sees its items');
select isnt_empty($$ select 1 from public.listing_photos where listing_id = tests.id('campus') $$, 'same campus sees its photos');
select tests.login_as(tests.user_id('beta1'));
select is_empty($$ select 1 from public.listings where id = tests.id('campus') $$, 'another campus does not see it');
select is_empty($$ select 1 from public.items where listing_id = tests.id('campus') $$, 'nor its items');
select is_empty($$ select 1 from public.listing_photos where listing_id = tests.id('campus') $$, 'nor its photos');
select tests.login_as(tests.user_id('gamma1'));
select is_empty($$ select 1 from public.listings where id = tests.id('campus') $$, 'a waitlist student does not see it');
select tests.login_as(tests.user_id('general1'));
select is_empty($$ select 1 from public.listings where id = tests.id('campus') $$, 'a general user does not see it');
select tests.login_as(tests.user_id('suspended'));
select is_empty($$ select 1 from public.listings where id = tests.id('campus') $$, 'a suspended student does not see it');

-- Open listings reach everyone signed in.
select tests.login_as(tests.user_id('general1'));
select isnt_empty($$ select 1 from public.listings where id = tests.id('open') $$, 'a general user sees an open listing');
select tests.login_as(tests.user_id('beta1'));
select isnt_empty($$ select 1 from public.listings where id = tests.id('general') $$, 'a student sees a general user''s listing');

-- Hidden and deleted listings disappear for others, not for the owner.
select set_eq($$ select id from public.listings where id in (tests.id('hidden'), tests.id('deleted')) $$, '{}'::uuid[], 'others see neither hidden nor deleted listings');
select tests.login_as(tests.user_id('alpha1'));
select is((select count(*)::int from public.listings where id in (tests.id('hidden'), tests.id('deleted'))), 2, 'the owner still sees both');

-- A block hides listings in both directions.
reset role;
insert into public.blocks (blocker_id, blocked_id) values (tests.user_id('alpha2'), tests.user_id('alpha1'));
select tests.remember('by_blocker', tests.create_listing_as('alpha2', '{"title": "Bike lock"}'));
select tests.login_as(tests.user_id('alpha2'));
select is_empty($$ select 1 from public.listings where owner_id = tests.user_id('alpha1') $$, 'the blocker no longer sees the blocked user''s listings');
select tests.login_as(tests.user_id('alpha1'));
select is_empty($$ select 1 from public.listings where id = tests.id('by_blocker') $$, 'the blocked user no longer sees the blocker''s listings');
reset role;
delete from public.blocks;
select tests.login_as(tests.user_id('alpha1'));

-- Writes go through functions; signed-out users see nothing.
select throws_ok(
  $$ insert into public.listings (owner_id, request_id, campus_id, lat, lng, area_label, kind, title, category, subcategory)
     values (tests.user_id('alpha1'), gen_random_uuid(), null, 0, 0, 'x', 'wanted', 'Direct', 'furniture', 'desks') $$,
  '42501', null, 'listings cannot be inserted directly'
);
select tests.login_anon();
select is_empty($$ select 1 from public.listings $$, 'signed-out users see no listings');

-- Favorites: own rows, and only listings the user can see.
select tests.login_as(tests.user_id('alpha2'));
select lives_ok($$ insert into public.favorites (user_id, listing_id) values (tests.user_id('alpha2'), tests.id('campus')) $$, 'a visible listing can be favorited');
select tests.login_as(tests.user_id('beta1'));
select throws_ok(
  $$ insert into public.favorites (user_id, listing_id) values (tests.user_id('beta1'), tests.id('campus')) $$,
  '42501', null, 'an invisible listing cannot be favorited'
);
select is_empty($$ select 1 from public.favorites $$, 'favorites are private');

-- Photo storage: upload into your own folder; read follows the listing.
reset role;
insert into storage.objects (bucket_id, name)
select 'listing-photos', p.path from public.listing_photos p where p.listing_id = tests.id('campus');
select tests.login_as(tests.user_id('alpha2'));
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('listing-photos', '%s/x.webp') $$, tests.user_id('alpha1')),
  '42501', null, 'nobody uploads into another user''s folder'
);
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('listing-photos', '%s/mine.webp') $$, tests.user_id('alpha2')),
  'users upload into their own folder'
);
select isnt_empty(
  $$ select 1 from storage.objects o join public.listing_photos p on p.path = o.name where p.listing_id = tests.id('campus') $$,
  'a campus photo is readable on the same campus'
);
select tests.login_as(tests.user_id('beta1'));
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'listing-photos' and name like tests.user_id('alpha1') || '/%' $$,
  'and not from another campus'
);

select * from finish();
rollback;
