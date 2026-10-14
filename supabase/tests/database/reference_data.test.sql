-- Categories, rule values and ZIP codes shipped by migrations (spec 1.7.5, 5.6, 5.3.2).
begin;
\ir _helpers.psql
select plan(11);

create temp view categories as
select c from public.app_config, jsonb_array_elements(value -> 'categories') as c where key = 'categories';

select is((select count(*)::int from categories), 21, '21 categories');
select is((select count(distinct c ->> 'id')::int from categories), 21, 'category ids are unique');
select is_empty(
  $$ select c ->> 'id' from categories
     where jsonb_array_length(c -> 'subcategories') = 0
        or (select count(distinct s ->> 'id') from jsonb_array_elements(c -> 'subcategories') s)
           <> jsonb_array_length(c -> 'subcategories') $$,
  'every category has subcategories with unique ids'
);

select is(
  (select value #>> '{grades,0,grade}' from public.app_config where key = 'rank_rules'), 'b_plus',
  'rank rules start at B+'
);
select is((select (value ->> 'daily_cap')::int from public.app_config where key = 'points_rules'), 200, 'points daily cap');

select is_empty(
  $$ select s ->> 'id'
     from public.app_config c, jsonb_array_elements(c.value -> 'starter_avatars') s
     where c.key = 'starter_avatars'
       and (select count(distinct i.slot) from public.shop_items i
            where i.sku in (select jsonb_array_elements_text(s -> 'items'))) <> jsonb_array_length(s -> 'items') $$,
  'every starter look uses existing items, one per slot'
);

select tests.login_as(tests.create_user('reader@example.com'));
select is((select count(*)::int from public.app_config where key = 'starter_avatars'), 1, 'the app reads the starter looks');
select is((select count(*)::int from public.app_config where key = 'categories'), 1, 'the app reads categories');
select is_empty($$ select 1 from public.app_config where key in ('rank_rules', 'points_rules', 'disposable_domains') $$, 'rule values stay server-side');
select is((select city || ', ' || state from public.zip_codes where zip = '61820'), 'Champaign, IL', 'ZIP lookup');
select ok((select count(*) from public.zip_codes) > 40000, 'ZIP codes cover the whole country');

select * from finish();
rollback;
