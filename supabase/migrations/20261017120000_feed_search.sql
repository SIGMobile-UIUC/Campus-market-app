-- DB-7: feeds and search with shopping modes, categories, filters and keyset paging (spec 4.8, 5.4, 6.4).

create extension if not exists pg_trgm with schema extensions;

create index listings_campus_feed_idx on public.listings (campus_id, bumped_at desc, id desc)
  where status = 'active' and not hidden and deleted_at is null;
create index listings_open_feed_idx on public.listings (bumped_at desc, id desc)
  where visibility = 'open' and status = 'active' and not hidden and deleted_at is null;
create index listings_search_idx on public.listings using gin (search);
create index listings_title_trgm_idx on public.listings using gin (title extensions.gin_trgm_ops);

-- One implementation for feeds and search. Runs as the caller, so the listings policy still decides
-- what is visible; the scope then narrows it to one market.
--   scope:   campus (the caller's live campus) or open
--   filters: mode (free, move_out, wanted, under_10, course), category, subcategory, condition,
--            zone_id, price_min, price_max, free_only. Without mode = wanted, wanted requests are left out.
--   sort:    newest, price_asc, price_desc. Price is the item's price, a sale's lowest available
--            price, or a wanted request's budget.
--   cursor:  the next_cursor of the previous page.
create function public.search_listings(
  p_q text,
  p_scope text,
  p_filters jsonb default '{}',
  p_sort text default 'newest',
  p_cursor jsonb default null,
  p_limit int default 20
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_campus uuid := private.my_live_campus_id();
  v_f      jsonb := coalesce(p_filters, '{}');
  v_mode   text := v_f ->> 'mode';
  v_sort   text := coalesce(p_sort, 'newest');
  v_q      text := nullif(btrim(p_q), '');
  v_tsq    tsquery;
  v_fuzzy  boolean := false;
  v_limit  int := least(greatest(coalesce(p_limit, 20), 1), 40);
  v_rows   jsonb;
begin
  if coalesce(p_scope, '') not in ('campus', 'open')
     or v_sort not in ('newest', 'price_asc', 'price_desc')
     or coalesce(v_mode, 'free') not in ('free', 'move_out', 'wanted', 'under_10', 'course') then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"scope, sort or mode"}';
  end if;
  if p_scope = 'campus' and v_campus is null then
    raise exception using errcode = 'P0001', message = 'CAMPUS_REQUIRED';
  end if;

  -- Full-text first; when it finds fewer than 5 listings, titles similar to the query count too (typos).
  if v_q is not null then
    v_tsq := websearch_to_tsquery('english', v_q);
    v_fuzzy := (select count(*) from (
                  select 1 from public.listings l
                  where l.search @@ v_tsq and l.status = 'active' and not l.hidden and l.deleted_at is null
                    and case when p_scope = 'campus' then l.campus_id = v_campus else l.visibility = 'open' end
                  limit 5) hits) < 5;
  end if;

  with candidates as (
    select l.*,
           case when l.kind = 'wanted' then l.budget_cents
                else coalesce(p.available_min, p.any_min) end as price
    from public.listings l
    left join lateral (
      select min(i.price_cents) filter (where i.status = 'available') as available_min,
             min(i.price_cents) as any_min
      from public.items i where i.listing_id = l.id
    ) p on true
    where l.status = 'active' and not l.hidden and l.deleted_at is null
      and case when p_scope = 'campus' then l.campus_id = v_campus else l.visibility = 'open' end
      and case when v_mode = 'wanted' then l.kind = 'wanted' else l.kind <> 'wanted' end
      and (v_mode is distinct from 'move_out' or l.kind = 'bundle')
      and (v_mode is distinct from 'course' or l.course_code is not null)
      and (v_f ->> 'category' is null or l.category = v_f ->> 'category')
      and (v_f ->> 'subcategory' is null or l.subcategory = v_f ->> 'subcategory')
      and (v_f ->> 'zone_id' is null or l.zone_id = (v_f ->> 'zone_id')::uuid)
      and (v_f ->> 'condition' is null or exists (
             select 1 from public.items i
             where i.listing_id = l.id and i.status = 'available' and i.condition::text = v_f ->> 'condition'))
      -- A missing letter scores about 0.45, under the pg_trgm default of 0.6, so typos use 0.4. A function
      -- setting for the threshold would need superuser to create. ponytail: the fallback scans the market's
      -- listings instead of the trigram index; fine while it runs only for searches with under 5 hits.
      and (v_q is null or l.search @@ v_tsq or (v_fuzzy and extensions.word_similarity(v_q, l.title) >= 0.4))
  ),
  page as (
    select c.*, row_number() over (order by
             case when v_sort = 'newest' then c.bumped_at end desc,
             case when v_sort = 'price_asc' then c.price end asc,
             case when v_sort = 'price_desc' then c.price end desc,
             case when v_sort = 'price_asc' then c.id end asc,
             c.id desc) as n
    from candidates c
    where (v_mode is distinct from 'free' and not coalesce((v_f ->> 'free_only')::boolean, false) or c.price = 0)
      and (v_mode is distinct from 'under_10' or c.price < 1000)
      and (v_f ->> 'price_min' is null or c.price >= (v_f ->> 'price_min')::int)
      and (v_f ->> 'price_max' is null or c.price <= (v_f ->> 'price_max')::int)
      and (p_cursor is null or case v_sort
             when 'newest' then (c.bumped_at, c.id) < ((p_cursor ->> 'bumped_at')::timestamptz, (p_cursor ->> 'id')::uuid)
             when 'price_asc' then (c.price, c.id) > ((p_cursor ->> 'price')::int, (p_cursor ->> 'id')::uuid)
             else (c.price, c.id) < ((p_cursor ->> 'price')::int, (p_cursor ->> 'id')::uuid)
           end)
    order by n
    limit v_limit
  )
  select jsonb_agg(jsonb_build_object(
           'id', pg.id,
           'kind', pg.kind,
           'title', pg.title,
           'price_cents', pg.price,
           'item_count', (select count(*) from public.items i where i.listing_id = pg.id),
           'status', pg.status,
           'campus_only', pg.visibility = 'campus',
           'thumb_path', cover.thumb_path,
           'blurhash', cover.blurhash,
           'owner', jsonb_build_object('display_name', pr.display_name, 'tier', pr.tier, 'campus_slug', oc.slug),
           'zone', z.name,
           'area_label', pg.area_label,
           'bumped_at', pg.bumped_at)
         order by pg.n)
  into v_rows
  from page pg
  -- Inner join: owners whose profile is hidden (suspended, banned, deleted) drop out of feeds.
  join public.profiles pr on pr.id = pg.owner_id
  left join public.campuses oc on oc.id = pr.campus_id
  left join public.campus_zones z on z.id = pg.zone_id
  left join lateral (
    select ph.thumb_path, ph.blurhash from public.listing_photos ph
    where ph.listing_id = pg.id order by ph.position limit 1
  ) cover on true;

  v_rows := coalesce(v_rows, '[]');
  return jsonb_build_object(
    'rows', v_rows,
    'next_cursor', case when jsonb_array_length(v_rows) = v_limit then jsonb_build_object(
      'bumped_at', v_rows -> -1 -> 'bumped_at',
      'price', v_rows -> -1 -> 'price_cents',
      'id', v_rows -> -1 -> 'id') end);
end;
$$;

create function public.feed(p_scope text, p_filters jsonb default '{}', p_cursor jsonb default null, p_limit int default 20)
returns jsonb
language sql stable set search_path = '' as $$
  select public.search_listings(null, p_scope, p_filters, 'newest', p_cursor, p_limit);
$$;

revoke execute on function public.search_listings(text, text, jsonb, text, jsonb, int), public.feed(text, jsonb, jsonb, int)
  from public, anon;
grant execute on function public.search_listings(text, text, jsonb, text, jsonb, int), public.feed(text, jsonb, jsonb, int)
  to authenticated;
