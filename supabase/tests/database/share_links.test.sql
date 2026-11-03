-- Share links (LST-11): every listing has a code, and the preview shows public fields only.
begin;
\ir _helpers.psql
select plan(5);
select tests.build_matrix();

grant usage on schema tests to service_role;
grant select on tests.matrix, tests.ids to service_role;

-- A campus-only listing by alpha1 with a meetup place.
select tests.remember('l1', tests.create_listing_as('alpha1', '{"meet_place": "Green St and 6th"}'));
reset role;

select is_empty($$ select 1 from public.listings where share_code !~ '^[0-9a-f]{12}$' $$,
  'every listing has a 12-character hex code');

select tests.login_as(tests.user_id('beta1'));
select throws_ok($$ select public.listing_preview('000000000000') $$, '42501', null,
  'only Edge Functions read previews');
reset role;

create temp table code on commit drop as select share_code from public.listings where id = tests.id('l1');
grant select on code to service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select ok((select p ->> 'visibility' = 'campus' and jsonb_array_length(p -> 'items') = 1
                  and p -> 'campus' ->> 'name' is not null
           from (select public.listing_preview((select share_code from code)) p) x),
  'a campus-only listing previews with its items and campus');
select is((select public.listing_preview((select share_code from code)) ?| array['owner_id', 'meet_place', 'hidden_reason', 'id']),
  false, 'the seller, the meetup place and moderation fields stay out');
reset role;

update public.listings set hidden = true where id = tests.id('l1');
set local role service_role;
select is(public.listing_preview((select share_code from code)), null, 'a hidden listing has no preview');
reset role;

select * from finish();
rollback;
