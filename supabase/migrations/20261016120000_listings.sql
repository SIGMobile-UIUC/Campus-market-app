-- DB-6: listings, items, photos, favorites and blocks; create, edit, close, reopen, delete and mark-sold
-- functions; prohibited words, item counts per kind, area and daily limits (spec 4.7, 5.3.4, 6.4).

create type public.listing_kind   as enum ('item', 'bundle', 'wanted');
create type public.listing_status as enum ('active', 'sold_out', 'closed');
create type public.visibility     as enum ('campus', 'open');
create type public.item_condition as enum ('new', 'like_new', 'good', 'fair', 'poor');
create type public.item_status    as enum ('available', 'reserved', 'sold');

create table public.listings (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles,
  request_id      uuid not null unique,                       -- create_listing retry key (spec 6.1)
  campus_id       uuid references public.campuses,            -- owner's campus; null for general users
  zip             text references public.zip_codes,           -- general users' area
  lat             double precision not null,                  -- area point
  lng             double precision not null,
  area_label      text not null,                              -- campus name or "City, ST"
  visibility      public.visibility not null default 'campus',
  kind            public.listing_kind not null,
  title           text not null check (char_length(title) between 3 and 80),
  description     text not null default '' check (char_length(description) <= 4000),
  category        text not null,              -- id from app_config.categories, checked by create_listing
  subcategory     text not null,              -- id within the category
  course_code     text check (course_code ~ '^[A-Z]{2,5} ?[0-9]{2,4}[A-Z]?$'),
  zone_id         uuid references public.campus_zones on delete set null,
  payment_methods text[] not null default '{}'
                  check (payment_methods <@ array['cash', 'venmo', 'zelle', 'paypal', 'apple_pay', 'cash_app']),
  budget_cents    integer check (budget_cents >= 0),
  status          public.listing_status not null default 'active',
  hidden          boolean not null default false,
  hidden_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  bumped_at       timestamptz not null default now(),
  deleted_at      timestamptz,
  photos_purge_after timestamptz,            -- set by the lifecycle trigger (section 4.7.2)
  search          tsvector generated always as (
                    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
                    setweight(to_tsvector('simple', coalesce(course_code, '')), 'A')
                  ) stored,
  check (campus_id is not null or zip is not null),
  check ((kind = 'wanted') = (budget_cents is not null))
);

create table public.items (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references public.listings on delete cascade,
  position          smallint not null check (position between 1 and 30),
  name              text not null check (char_length(name) between 1 and 80),
  price_cents       integer not null check (price_cents between 0 and 10000000),
  negotiable        boolean not null default false,
  condition         public.item_condition not null,
  status            public.item_status not null default 'available',
  reserved_trade_id uuid,          -- foreign key added with trades
  sold_at           timestamptz,
  sold_elsewhere    boolean not null default false,
  unique (listing_id, position),
  check ((status = 'reserved') = (reserved_trade_id is not null)),
  check ((status = 'sold') = (sold_at is not null))
);

create table public.listing_photos (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings on delete cascade,
  item_id    uuid references public.items on delete set null,
  path       text unique,                 -- detail image; null after purge (cover row only remains)
  thumb_path text not null unique,
  blurhash   text not null,
  bytes      integer not null,            -- detail plus thumbnail, for storage monitoring
  position   smallint not null,
  unique (listing_id, position)
);

create table public.favorites (
  user_id    uuid not null references public.profiles on delete cascade,
  listing_id uuid not null references public.listings on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- Blocks hide listings both ways (SAF-3); block_user and unblock_user arrive with DB-13.
create table public.blocks (
  blocker_id uuid not null references public.profiles on delete cascade,
  blocked_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index listings_owner_created_idx on public.listings (owner_id, created_at desc);
create index items_available_idx on public.items (listing_id) where status = 'available';
create index blocks_blocked_idx on public.blocks (blocked_id);

-- Starting values; a super admin changes them through app_config.
insert into public.app_config (key, value) values
  ('limits', '{"listings_per_day": {"student": 20, "general": 5}}'),
  -- Whole words or phrases, matched ignoring case, for the prohibited items in section 2.2. Generic
  -- words that allowed items use ("wine glasses", "Ticket to Ride", "glue gun", "puppy bed") are left out.
  ('text_filter', '{"terms": [
    "vodka", "whiskey", "tequila", "liquor", "six pack of beer",
    "vape", "vapes", "juul", "e-cig", "cigarette", "cigarettes", "nicotine", "tobacco",
    "marijuana", "cannabis", "thc", "bong",
    "adderall", "xanax", "oxycodone", "percocet", "vicodin",
    "handgun", "firearm", "pistol", "rifle", "shotgun", "ammo", "ammunition", "brass knuckles",
    "fireworks", "firecracker", "explosives",
    "counterfeit",
    "exam answers", "answer key", "test bank",
    "gift card", "giftcard", "account for sale",
    "rehoming", "puppy for sale", "kitten for sale",
    "concert ticket", "concert tickets", "season tickets", "game tickets", "sublease", "sublet",
    "sex toy", "lingerie", "18+"
  ]}')
on conflict (key) do nothing;

-- Helpers ------------------------------------------------------------------------------------------

-- Users I blocked or who blocked me; '{}' when none, since x <> all(null) would hide everything (4.6.5).
create function private.my_block_list() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(other), '{}')
  from (
    select blocked_id as other from public.blocks where blocker_id = auth.uid()
    union
    select blocker_id from public.blocks where blocked_id = auth.uid()
  ) b;
$$;

-- The first prohibited term in the text, as a whole word or phrase, or null.
create function private.prohibited_term(p_text text) returns text
language sql stable security definer set search_path = '' as $$
  select t
  from public.app_config c, jsonb_array_elements_text(c.value -> 'terms') as t
  where c.key = 'text_filter'
    and p_text ~* ('(^|[^[:alnum:]])' || regexp_replace(t, '([^[:alnum:] ])', '\\\1', 'g') || '($|[^[:alnum:]])')
  limit 1;
$$;

create function private.valid_category(p_category text, p_subcategory text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.app_config c,
         jsonb_array_elements(c.value -> 'categories') as k,
         jsonb_array_elements(k -> 'subcategories') as s
    where c.key = 'categories' and k ->> 'id' = p_category and s ->> 'id' = p_subcategory);
$$;

-- Area point and label: the campus for students (live or waitlist), the ZIP code for general users.
create function private.area_for(p_campus_id uuid, p_zip text,
                                 out lat double precision, out lng double precision, out label text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_campus_id is not null then
    select c.lat, c.lng, coalesce(c.short_name, c.name) into lat, lng, label
    from public.campuses c where c.id = p_campus_id;
  else
    select z.lat, z.lng, z.city || ', ' || z.state into lat, lng, label
    from public.zip_codes z where z.zip = p_zip;
    if not found then
      raise exception using errcode = 'P0001', message = 'ZIP_REQUIRED';
    end if;
  end if;
end;
$$;

create function private.fail(p_code text, p_field text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = json_build_object('field', p_field)::text;
end;
$$;

-- Shared checks for create_listing and update_listing. Table constraints back them up; these give
-- the app a field name instead of a constraint name.
create function private.check_listing_fields(p_listing jsonb) returns void
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
                  where m not in ('cash', 'venmo', 'zelle', 'paypal', 'apple_pay', 'cash_app'))) then
    perform private.fail('VALIDATION_FAILED', 'payment_methods');
  end if;
end;
$$;

create function private.check_item(p_item jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_item ? 'name' and char_length(coalesce(p_item ->> 'name', '')) not between 1 and 80 then
    perform private.fail('VALIDATION_FAILED', 'items.name');
  end if;
  if p_item ? 'price_cents' and (jsonb_typeof(p_item -> 'price_cents') <> 'number'
     or (p_item ->> 'price_cents')::numeric not between 0 and 10000000
     or (p_item ->> 'price_cents')::numeric % 1 <> 0) then
    perform private.fail('VALIDATION_FAILED', 'items.price_cents');
  end if;
  if p_item ? 'condition' and coalesce(p_item ->> 'condition', '') not in ('new', 'like_new', 'good', 'fair', 'poor') then
    perform private.fail('VALIDATION_FAILED', 'items.condition');
  end if;
end;
$$;

-- Photos must be the caller's uploads (their folder in listing-photos): 1 to 10 per item for items and
-- bundles, attached by item position; up to 3 reference photos for a wanted request.
create function private.check_photos(p_owner uuid, p_kind public.listing_kind, p_photos jsonb, p_positions int[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_photos) <> 'array'
     or (p_kind <> 'wanted' and jsonb_array_length(p_photos) = 0)
     or (p_kind = 'wanted' and jsonb_array_length(p_photos) > 3)
     or exists (
       select 1 from jsonb_array_elements(p_photos) ph
       where coalesce(ph ->> 'path', '') not like p_owner::text || '/%'
          or coalesce(ph ->> 'thumb_path', '') not like p_owner::text || '/%'
          or coalesce(ph ->> 'blurhash', '') = ''
          or jsonb_typeof(ph -> 'bytes') <> 'number' or (ph ->> 'bytes')::numeric <= 0
          or (p_kind <> 'wanted' and not ((ph ->> 'item_position')::int = any (p_positions))))
     or exists (
       select 1 from jsonb_array_elements(p_photos) ph
       group by ph ->> 'item_position' having count(*) > 10) then
    perform private.fail('VALIDATION_FAILED', 'photos');
  end if;
end;
$$;

create function private.replace_photos(p_listing_id uuid, p_photos jsonb) returns void
language sql security definer set search_path = '' as $$
  delete from public.listing_photos where listing_id = p_listing_id;
  insert into public.listing_photos (listing_id, item_id, path, thumb_path, blurhash, bytes, position)
  select p_listing_id, i.id, ph ->> 'path', ph ->> 'thumb_path', ph ->> 'blurhash', (ph ->> 'bytes')::int, n
  from jsonb_array_elements(p_photos) with ordinality as x(ph, n)
  left join public.items i on i.listing_id = p_listing_id and i.position = (ph ->> 'item_position')::int;
$$;

create function private.listing_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select (to_jsonb(l) - 'search' - 'request_id') || jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from public.items i where i.listing_id = l.id), '[]'),
    'photos', coalesce((select jsonb_agg(to_jsonb(p) order by p.position) from public.listing_photos p where p.listing_id = l.id), '[]'))
  from public.listings l
  where l.id = p_id;
$$;

-- Locks and returns the caller's listing, or raises NOT_FOUND or FORBIDDEN.
create function private.own_listing(p_listing_id uuid, p_uid uuid) returns public.listings
language plpgsql security definer set search_path = '' as $$
declare
  v_listing public.listings;
begin
  select * into v_listing from public.listings where id = p_listing_id and deleted_at is null for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if v_listing.owner_id <> p_uid then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  return v_listing;
end;
$$;

-- Triggers -----------------------------------------------------------------------------------------
-- Security definer: the deferred count check runs at commit as the caller, who may not call private helpers.

create function private.listings_text_filter() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.prohibited_term(new.title) is not null then
    perform private.fail('PROHIBITED_CONTENT', 'title');
  elsif private.prohibited_term(new.description) is not null then
    perform private.fail('PROHIBITED_CONTENT', 'description');
  end if;
  return new;
end;
$$;

create trigger listings_text_filter before insert or update of title, description on public.listings
for each row execute function private.listings_text_filter();

create function private.items_text_filter() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.prohibited_term(new.name) is not null then
    perform private.fail('PROHIBITED_CONTENT', 'items.name');
  end if;
  return new;
end;
$$;

create trigger items_text_filter before insert or update of name on public.items
for each row execute function private.items_text_filter();

-- Item count per kind, checked at commit so a listing and its items can be written in any order:
-- 1 for item, 2 to 30 for bundle, 0 for wanted.
create function private.check_item_count() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- The function serves both tables, so fields are read by name rather than as record columns.
  v_listing_id uuid := case when tg_table_name = 'listings' then (to_jsonb(new) ->> 'id')::uuid
                            else coalesce(to_jsonb(new) ->> 'listing_id', to_jsonb(old) ->> 'listing_id')::uuid end;
  v_kind       public.listing_kind;
  v_count      int;
begin
  select kind into v_kind from public.listings where id = v_listing_id;
  if not found then
    return null;   -- the listing itself was removed
  end if;
  select count(*) into v_count from public.items where listing_id = v_listing_id;
  if (v_kind = 'item' and v_count <> 1) or (v_kind = 'bundle' and v_count not between 2 and 30)
     or (v_kind = 'wanted' and v_count <> 0) then
    perform private.fail('VALIDATION_FAILED', 'items');
  end if;
  return null;
end;
$$;

create constraint trigger listings_item_count after insert on public.listings
deferrable initially deferred for each row execute function private.check_item_count();
create constraint trigger items_item_count after insert or delete on public.items
deferrable initially deferred for each row execute function private.check_item_count();

-- The listing is sold out when every item is sold, and active again when one returns (5.2).
create function private.sync_listing_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_listing_id uuid := coalesce(new.listing_id, old.listing_id);
begin
  update public.listings l
  set status = case when s.all_sold then 'sold_out'::public.listing_status else 'active'::public.listing_status end
  from (select bool_and(status = 'sold') as all_sold from public.items where listing_id = v_listing_id) s
  where l.id = v_listing_id
    and l.status <> 'closed'
    and s.all_sold is not null
    and l.status <> case when s.all_sold then 'sold_out'::public.listing_status else 'active'::public.listing_status end;
  return null;
end;
$$;

create trigger items_sync_listing_status after insert or delete or update of status on public.items
for each row execute function private.sync_listing_status();

-- updated_at and the photo purge date (4.7.2): 30 days after selling out or deletion, 90 after closing.
create function private.listings_lifecycle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.deleted_at is not null then
    if old.deleted_at is null then
      new.photos_purge_after := now() + interval '30 days';
    end if;
  elsif new.status is distinct from old.status then
    new.photos_purge_after := case new.status
      when 'sold_out' then now() + interval '30 days'
      when 'closed' then now() + interval '90 days'
    end;
  end if;
  return new;
end;
$$;

create trigger listings_lifecycle before update on public.listings
for each row execute function private.listings_lifecycle();

-- Row-level security -------------------------------------------------------------------------------

alter table public.listings       enable row level security;
alter table public.items          enable row level security;
alter table public.listing_photos enable row level security;
alter table public.favorites      enable row level security;
alter table public.blocks         enable row level security;

-- Spec 4.6.5. ponytail: listings of suspended or banned owners stay visible until enforcement hides
-- them (DB-13).
create policy listings_select on public.listings for select to authenticated
using (
  owner_id = (select auth.uid())
  or (
    deleted_at is null
    and hidden = false
    and (visibility = 'open' or campus_id = (select private.my_live_campus_id()))
    -- The cast makes the subquery an array expression (evaluated once) rather than a row source.
    and owner_id <> all ((select private.my_block_list())::uuid[])
  )
);

-- Items and photos follow their listing; the subquery applies the listings policy.
create policy items_select on public.items for select to authenticated
using (exists (select 1 from public.listings l where l.id = listing_id));
create policy listing_photos_select on public.listing_photos for select to authenticated
using (exists (select 1 from public.listings l where l.id = listing_id));

create policy favorites_select on public.favorites for select to authenticated using (user_id = (select auth.uid()));
create policy favorites_insert on public.favorites for insert to authenticated
with check (user_id = (select auth.uid()) and exists (select 1 from public.listings l where l.id = listing_id));
create policy favorites_delete on public.favorites for delete to authenticated using (user_id = (select auth.uid()));

create policy blocks_select on public.blocks for select to authenticated using (blocker_id = (select auth.uid()));

-- Photo storage (4.7.1): private, WebP or JPEG up to 400 KB. Users upload into their own folder; a photo
-- is readable by its uploader and by anyone who can see the listing it belongs to.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', false, 409600, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

create policy listing_photos_upload on storage.objects for insert to authenticated
with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy listing_photos_read on storage.objects for select to authenticated
using (
  bucket_id = 'listing-photos'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.listing_photos p where p.path = objects.name or p.thumb_path = objects.name)
  )
);

-- Unattached uploads can be removed by their owner; attached ones are removed by media-purge.
create policy listing_photos_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists (select 1 from public.listing_photos p where p.path = objects.name or p.thumb_path = objects.name)
);

-- Functions ----------------------------------------------------------------------------------------

create function public.create_listing(p_listing jsonb, p_request_id uuid) returns jsonb
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
                               description, category, subcategory, course_code, zone_id, payment_methods, budget_cents)
  values (v_uid, p_request_id, v_campus_id, v_zip, v_area.lat, v_area.lng, v_area.label, v_visibility, v_kind,
          p_listing ->> 'title', coalesce(p_listing ->> 'description', ''), p_listing ->> 'category',
          p_listing ->> 'subcategory', p_listing ->> 'course_code', (p_listing ->> 'zone_id')::uuid,
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

-- Changes only the fields present. Items by position: change, add (new position) or remove
-- ({"position": n, "remove": true}); reserved and sold items cannot change (4.7). "photos" replaces all.
create function public.update_listing(p_listing_id uuid, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_listing public.listings := private.own_listing(p_listing_id, v_uid);
  v_live    boolean;
  v_lat     double precision;
  v_lng     double precision;
  v_label   text;
  v_locked  uuid[];
begin
  perform private.check_listing_fields(p_changes);
  perform private.check_item(item) from jsonb_array_elements(coalesce(p_changes -> 'items', '[]')) as item;

  if p_changes ? 'budget_cents' and (v_listing.kind <> 'wanted' or jsonb_typeof(p_changes -> 'budget_cents') <> 'number') then
    perform private.fail('VALIDATION_FAILED', 'budget_cents');
  end if;
  if p_changes ? 'visibility' then
    select c.status = 'live' into v_live from public.campuses c where c.id = v_listing.campus_id;
    if coalesce(p_changes ->> 'visibility', '') not in ('campus', 'open') then
      perform private.fail('VALIDATION_FAILED', 'visibility');
    elsif p_changes ->> 'visibility' = 'campus' and not coalesce(v_live, false) then
      raise exception using errcode = 'P0001', message = 'CAMPUS_REQUIRED';
    end if;
  end if;
  if p_changes ->> 'zone_id' is not null and not exists (
       select 1 from public.campus_zones z where z.id = (p_changes ->> 'zone_id')::uuid and z.campus_id = v_listing.campus_id) then
    perform private.fail('VALIDATION_FAILED', 'zone_id');
  end if;
  if p_changes ? 'zip' then
    if v_listing.campus_id is not null then
      perform private.fail('VALIDATION_FAILED', 'zip');
    end if;
    select a.lat, a.lng, a.label into v_lat, v_lng, v_label from private.area_for(null, p_changes ->> 'zip') a;
  end if;

  update public.listings set
    title           = coalesce(p_changes ->> 'title', title),
    description     = case when p_changes ? 'description' then coalesce(p_changes ->> 'description', '') else description end,
    category        = coalesce(p_changes ->> 'category', category),
    subcategory     = coalesce(p_changes ->> 'subcategory', subcategory),
    course_code     = case when p_changes ? 'course_code' then p_changes ->> 'course_code' else course_code end,
    zone_id         = case when p_changes ? 'zone_id' then (p_changes ->> 'zone_id')::uuid else zone_id end,
    payment_methods = case when p_changes ? 'payment_methods'
                           then array(select jsonb_array_elements_text(p_changes -> 'payment_methods')) else payment_methods end,
    visibility      = coalesce((p_changes ->> 'visibility')::public.visibility, visibility),
    budget_cents    = coalesce((p_changes ->> 'budget_cents')::int, budget_cents),
    zip             = case when p_changes ? 'zip' then p_changes ->> 'zip' else zip end,
    lat             = coalesce(v_lat, lat),
    lng             = coalesce(v_lng, lng),
    area_label      = coalesce(v_label, area_label)
  where id = p_listing_id;

  if p_changes ? 'items' then
    -- Lock the items, then refuse if a touched one is reserved or sold, so a trade's terms cannot shift.
    perform 1 from public.items where listing_id = p_listing_id for update;
    select array_agg(i.id) into v_locked
    from public.items i
    join jsonb_array_elements(p_changes -> 'items') c on (c ->> 'position')::int = i.position
    where i.listing_id = p_listing_id and i.status <> 'available';
    if v_locked is not null then
      raise exception using errcode = 'P0001', message = 'ITEM_UNAVAILABLE',
        detail = json_build_object('item_ids', v_locked)::text;
    end if;

    delete from public.listing_photos ph
    using public.items i, jsonb_array_elements(p_changes -> 'items') c
    where ph.item_id = i.id and i.listing_id = p_listing_id
      and i.position = (c ->> 'position')::int and coalesce((c ->> 'remove')::boolean, false);
    delete from public.items i
    using jsonb_array_elements(p_changes -> 'items') c
    where i.listing_id = p_listing_id and i.position = (c ->> 'position')::int and coalesce((c ->> 'remove')::boolean, false);

    update public.items i set
      name        = coalesce(c ->> 'name', i.name),
      price_cents = coalesce((c ->> 'price_cents')::int, i.price_cents),
      negotiable  = coalesce((c ->> 'negotiable')::boolean, i.negotiable),
      condition   = coalesce((c ->> 'condition')::public.item_condition, i.condition)
    from jsonb_array_elements(p_changes -> 'items') c
    where i.listing_id = p_listing_id and i.position = (c ->> 'position')::int
      and not coalesce((c ->> 'remove')::boolean, false);

    if exists (select 1 from jsonb_array_elements(p_changes -> 'items') c
               where not coalesce((c ->> 'remove')::boolean, false)
                 and not exists (select 1 from public.items i where i.listing_id = p_listing_id and i.position = (c ->> 'position')::int)
                 and not (c ? 'name' and c ? 'price_cents' and c ? 'condition')) then
      perform private.fail('VALIDATION_FAILED', 'items');
    end if;
    insert into public.items (listing_id, position, name, price_cents, negotiable, condition)
    select p_listing_id, (c ->> 'position')::int, c ->> 'name', (c ->> 'price_cents')::int,
           coalesce((c ->> 'negotiable')::boolean, false), (c ->> 'condition')::public.item_condition
    from jsonb_array_elements(p_changes -> 'items') c
    where not coalesce((c ->> 'remove')::boolean, false)
      and not exists (select 1 from public.items i where i.listing_id = p_listing_id and i.position = (c ->> 'position')::int);
  end if;

  if p_changes ? 'photos' then
    perform private.check_photos(v_uid, v_listing.kind, p_changes -> 'photos',
                                 array(select position::int from public.items where listing_id = p_listing_id));
    perform private.replace_photos(p_listing_id, p_changes -> 'photos');
  end if;

  return private.listing_json(p_listing_id);
end;
$$;

create function public.close_listing(p_listing_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_listing public.listings := private.own_listing(p_listing_id, v_uid);
begin
  if v_listing.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  update public.listings set status = 'closed' where id = p_listing_id;
  return private.listing_json(p_listing_id);
end;
$$;

-- Reopening a listing whose photos were purged needs new photos (4.7.2).
create function public.reopen_listing(p_listing_id uuid, p_photos jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_listing public.listings := private.own_listing(p_listing_id, v_uid);
begin
  if v_listing.status <> 'closed' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
  if p_photos is null and v_listing.kind <> 'wanted'
     and not exists (select 1 from public.listing_photos where listing_id = p_listing_id and path is not null) then
    perform private.fail('VALIDATION_FAILED', 'photos');
  end if;
  if p_photos is not null then
    perform private.check_photos(v_uid, v_listing.kind, p_photos,
                                 array(select position::int from public.items where listing_id = p_listing_id));
    perform private.replace_photos(p_listing_id, p_photos);
  end if;
  -- Back to active, or straight to sold out when nothing is left to sell.
  update public.listings set status = case
      when exists (select 1 from public.items where listing_id = p_listing_id)
           and not exists (select 1 from public.items where listing_id = p_listing_id and status <> 'sold')
      then 'sold_out'::public.listing_status else 'active'::public.listing_status end
  where id = p_listing_id;
  return private.listing_json(p_listing_id);
end;
$$;

create function public.delete_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := private.require_user();
  v_listing  public.listings := private.own_listing(p_listing_id, v_uid);
  v_reserved uuid[];
begin
  select array_agg(id) into v_reserved from public.items where listing_id = p_listing_id and status = 'reserved';
  if v_reserved is not null then
    raise exception using errcode = 'P0001', message = 'ITEM_UNAVAILABLE',
      detail = json_build_object('item_ids', v_reserved)::text;
  end if;
  update public.listings set deleted_at = now() where id = v_listing.id;
end;
$$;

-- Marks available items as sold outside the app. All or none: any item that is reserved or already
-- sold fails the whole call.
create function public.mark_sold_elsewhere(p_item_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid         uuid := private.require_user();
  v_unavailable uuid[];
begin
  if coalesce(cardinality(p_item_ids), 0) = 0 then
    perform private.fail('VALIDATION_FAILED', 'item_ids');
  end if;
  perform 1 from public.items i where i.id = any (p_item_ids) for update;
  if exists (
       select 1 from unnest(p_item_ids) as x(id)
       left join public.items i on i.id = x.id
       left join public.listings l on l.id = i.listing_id
       where l.id is null or l.owner_id <> v_uid or l.deleted_at is not null) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  select array_agg(id) into v_unavailable from public.items where id = any (p_item_ids) and status <> 'available';
  if v_unavailable is not null then
    raise exception using errcode = 'P0001', message = 'ITEM_UNAVAILABLE',
      detail = json_build_object('item_ids', v_unavailable)::text;
  end if;

  update public.items set status = 'sold', sold_at = now(), sold_elsewhere = true where id = any (p_item_ids);
  return (select jsonb_agg(to_jsonb(i) order by i.position) from public.items i where i.id = any (p_item_ids));
end;
$$;

-- Grants -------------------------------------------------------------------------------------------

revoke execute on function
  private.my_block_list(), private.prohibited_term(text), private.valid_category(text, text),
  private.area_for(uuid, text), private.fail(text, text), private.check_listing_fields(jsonb),
  private.check_item(jsonb), private.check_photos(uuid, public.listing_kind, jsonb, int[]),
  private.replace_photos(uuid, jsonb), private.listing_json(uuid), private.own_listing(uuid, uuid),
  private.listings_text_filter(), private.items_text_filter(), private.check_item_count(),
  private.sync_listing_status(), private.listings_lifecycle()
from public, anon, authenticated;
grant execute on function private.my_block_list() to authenticated;

revoke execute on function
  public.create_listing(jsonb, uuid), public.update_listing(uuid, jsonb), public.close_listing(uuid),
  public.reopen_listing(uuid, jsonb), public.delete_listing(uuid), public.mark_sold_elsewhere(uuid[])
from public, anon;
grant execute on function
  public.create_listing(jsonb, uuid), public.update_listing(uuid, jsonb), public.close_listing(uuid),
  public.reopen_listing(uuid, jsonb), public.delete_listing(uuid), public.mark_sold_elsewhere(uuid[])
to authenticated;
