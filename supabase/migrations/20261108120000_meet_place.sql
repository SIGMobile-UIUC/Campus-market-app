-- Sellers may type where they hand items over, with or without a campus zone (spec 3.3 trade options):
-- campuses blend into their cities, so preset zones cannot cover every place. The app opens the place in
-- the phone's maps app. "other" is a payment method the two sides agree on in chat.

alter table public.listings
  add column meet_place text check (char_length(meet_place) between 1 and 80),
  drop constraint listings_payment_methods_check,
  add constraint listings_payment_methods_check
    check (payment_methods <@ array['cash', 'venmo', 'zelle', 'paypal', 'apple_pay', 'cash_app', 'other']);

create or replace function private.check_listing_fields(p_listing jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_listing ? 'title' and char_length(coalesce(p_listing ->> 'title', '')) not between 3 and 80 then
    perform private.fail('VALIDATION_FAILED', 'title');
  end if;
  if char_length(coalesce(p_listing ->> 'description', '')) > 4000 then
    perform private.fail('VALIDATION_FAILED', 'description');
  end if;
  if (p_listing ? 'category' or p_listing ? 'subcategory')
     and not private.valid_category(p_listing ->> 'category', p_listing ->> 'subcategory') then
    perform private.fail('VALIDATION_FAILED', 'category');
  end if;
  if p_listing ->> 'course_code' is not null and p_listing ->> 'course_code' !~ '^[A-Z]{2,5} ?[0-9]{2,4}[A-Z]?$' then
    perform private.fail('VALIDATION_FAILED', 'course_code');
  end if;
  if p_listing ? 'payment_methods' and (
       jsonb_typeof(p_listing -> 'payment_methods') <> 'array'
       or exists (select 1 from jsonb_array_elements_text(p_listing -> 'payment_methods') m
                  where m not in ('cash', 'venmo', 'zelle', 'paypal', 'apple_pay', 'cash_app', 'other'))) then
    perform private.fail('VALIDATION_FAILED', 'payment_methods');
  end if;
  if char_length(btrim(p_listing ->> 'meet_place')) > 80 then
    perform private.fail('VALIDATION_FAILED', 'meet_place');
  end if;
end;
$$;

-- The place is public like the title, so it goes through the same word filter.
create or replace function private.listings_text_filter() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.prohibited_term(new.title) is not null then
    perform private.fail('PROHIBITED_CONTENT', 'title');
  elsif private.prohibited_term(new.description) is not null then
    perform private.fail('PROHIBITED_CONTENT', 'description');
  elsif private.prohibited_term(new.meet_place) is not null then
    perform private.fail('PROHIBITED_CONTENT', 'meet_place');
  end if;
  return new;
end;
$$;

drop trigger listings_text_filter on public.listings;
create trigger listings_text_filter before insert or update of title, description, meet_place on public.listings
for each row execute function private.listings_text_filter();

-- create_listing (DB-5) also stores meet_place; an empty one is no place.
create or replace function public.create_listing(p_listing jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := private.require_user();
  v_existing   uuid;
  v_campus_id  uuid;
  v_live       boolean;
  v_kind       public.listing_kind;
  v_visibility public.visibility;
  v_zip        text;
  v_area       record;
  v_items      jsonb := coalesce(p_listing -> 'items', '[]');
  v_photos     jsonb := coalesce(p_listing -> 'photos', '[]');
  v_limit      int;
  v_id         uuid;
begin
  if p_request_id is null then
    perform private.fail('VALIDATION_FAILED', 'request_id');
  end if;

  -- Locking the profile serializes this user's posts, so retries and the daily limit hold under concurrency.
  select p.campus_id, coalesce(p_listing ->> 'zip', p.zip) into v_campus_id, v_zip
  from public.profiles p where p.id = v_uid for update;

  select id into v_existing from public.listings where request_id = p_request_id and owner_id = v_uid;
  if found then
    return private.listing_json(v_existing);
  end if;

  if coalesce(p_listing ->> 'kind', '') not in ('item', 'bundle', 'wanted') then
    perform private.fail('VALIDATION_FAILED', 'kind');
  end if;
  v_kind := (p_listing ->> 'kind')::public.listing_kind;
  if not (p_listing ? 'title' and p_listing ? 'category') then
    perform private.fail('VALIDATION_FAILED', 'title');
  end if;
  perform private.check_listing_fields(p_listing);

  if jsonb_typeof(v_items) <> 'array'
     or (v_kind = 'item' and jsonb_array_length(v_items) <> 1)
     or (v_kind = 'bundle' and jsonb_array_length(v_items) not between 2 and 30)
     or (v_kind = 'wanted' and jsonb_array_length(v_items) <> 0) then
    perform private.fail('VALIDATION_FAILED', 'items');
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) as item
             where not (item ? 'name' and item ? 'price_cents' and item ? 'condition')) then
    perform private.fail('VALIDATION_FAILED', 'items');
  end if;
  perform private.check_item(item) from jsonb_array_elements(v_items) as item;
  perform private.check_photos(v_uid, v_kind, v_photos,
                               array(select generate_series(1, jsonb_array_length(v_items))));

  if (v_kind = 'wanted') <> (jsonb_typeof(p_listing -> 'budget_cents') = 'number') then
    perform private.fail('VALIDATION_FAILED', 'budget_cents');
  end if;

  if p_listing ? 'visibility' and coalesce(p_listing ->> 'visibility', '') not in ('campus', 'open') then
    perform private.fail('VALIDATION_FAILED', 'visibility');
  end if;
  select c.status = 'live' into v_live from public.campuses c where c.id = v_campus_id;
  v_live := coalesce(v_live, false);
  v_visibility := coalesce(p_listing ->> 'visibility', case when v_live then 'campus' else 'open' end)::public.visibility;
  if v_visibility = 'campus' and not v_live then
    raise exception using errcode = 'P0001', message = 'CAMPUS_REQUIRED';
  end if;
  if p_listing ->> 'zone_id' is not null and not exists (
       select 1 from public.campus_zones z where z.id = (p_listing ->> 'zone_id')::uuid and z.campus_id = v_campus_id) then
    perform private.fail('VALIDATION_FAILED', 'zone_id');
  end if;

  select (value #>> case when v_campus_id is null then '{listings_per_day,general}' else '{listings_per_day,student}' end::text[])::int
  into v_limit from public.app_config where key = 'limits';
  if (select count(*) from public.listings where owner_id = v_uid and created_at > now() - interval '24 hours') >= v_limit then
    raise exception using errcode = 'P0001', message = 'LIMIT_REACHED';
  end if;

  if v_campus_id is not null then
    v_zip := null;
  end if;
  select * into v_area from private.area_for(v_campus_id, v_zip);

  insert into public.listings (owner_id, request_id, campus_id, zip, lat, lng, area_label, visibility, kind, title,
                               description, category, subcategory, course_code, zone_id, meet_place, payment_methods,
                               budget_cents)
  values (v_uid, p_request_id, v_campus_id, v_zip, v_area.lat, v_area.lng, v_area.label, v_visibility, v_kind,
          p_listing ->> 'title', coalesce(p_listing ->> 'description', ''), p_listing ->> 'category',
          p_listing ->> 'subcategory', p_listing ->> 'course_code', (p_listing ->> 'zone_id')::uuid,
          nullif(btrim(p_listing ->> 'meet_place'), ''),
          coalesce(array(select jsonb_array_elements_text(p_listing -> 'payment_methods')), '{}'),
          (p_listing ->> 'budget_cents')::int)
  returning id into v_id;

  insert into public.items (listing_id, position, name, price_cents, negotiable, condition)
  select v_id, n, item ->> 'name', (item ->> 'price_cents')::int, coalesce((item ->> 'negotiable')::boolean, false),
         (item ->> 'condition')::public.item_condition
  from jsonb_array_elements(v_items) with ordinality as x(item, n);

  perform private.replace_photos(v_id, v_photos);
  return private.listing_json(v_id);
end;
$$;
