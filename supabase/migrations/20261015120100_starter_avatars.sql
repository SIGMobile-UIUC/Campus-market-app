-- Starter avatar (ACC-3): the cosmetics catalog, inventory and loadout from spec 5.3.9, and a free starter
-- look picked during onboarding. Wallets, purchases and the shop arrive with DB-12.

create type public.item_slot as enum ('head', 'face', 'top', 'accessory', 'background', 'frame',
                                      'pet_accessory', 'pet_treat');
create type public.rarity    as enum ('common', 'rare', 'epic', 'legendary', 'limited');

create table public.shop_items (
  id              uuid primary key default gen_random_uuid(),
  sku             text not null unique,
  slot            public.item_slot not null,
  name            text not null,
  rarity          public.rarity not null,
  price           integer not null check (price > 0),
  campus_id       uuid references public.campuses,   -- campus-only item
  min_tier        public.tier,                       -- grade-gated item
  available_from  timestamptz,
  available_until timestamptz,
  consumable      boolean not null default false,
  active          boolean not null default true,     -- false: not sold in the shop
  asset_key       text not null                      -- the bundled SVG layer the app draws
);

create table public.inventory (
  user_id     uuid not null references public.profiles on delete cascade,
  item_id     uuid not null references public.shop_items on delete restrict,
  quantity    integer not null default 1 check (quantity >= 0),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table public.avatar_loadout (
  user_id uuid not null references public.profiles on delete cascade,
  slot    public.item_slot not null check (slot <> 'pet_treat'),
  item_id uuid not null references public.shop_items,
  primary key (user_id, slot)
);

alter table public.shop_items     enable row level security;
alter table public.inventory      enable row level security;
alter table public.avatar_loadout enable row level security;

-- Anyone signed in can draw anyone's avatar; only owners see what they own. Writes go through functions.
create policy shop_items_select     on public.shop_items     for select to authenticated using (true);
create policy avatar_loadout_select on public.avatar_loadout for select to authenticated using (true);
create policy inventory_select      on public.inventory      for select to authenticated using (user_id = (select auth.uid()));

-- Starter items are granted, never sold (active = false); price is the common-rarity default.
insert into public.shop_items (sku, slot, name, rarity, price, active, asset_key) values
  ('bg_sky',           'background', 'Sky',              'common', 150, false, 'bg_sky'),
  ('bg_mint',          'background', 'Mint',             'common', 150, false, 'bg_mint'),
  ('bg_peach',         'background', 'Peach',            'common', 150, false, 'bg_peach'),
  ('bg_lilac',         'background', 'Lilac',            'common', 150, false, 'bg_lilac'),
  ('bg_sun',           'background', 'Sunshine',         'common', 150, false, 'bg_sun'),
  ('bg_rose',          'background', 'Rose',             'common', 150, false, 'bg_rose'),
  ('top_hoodie_navy',  'top',        'Navy hoodie',      'common', 150, false, 'top_hoodie_navy'),
  ('top_tee_orange',   'top',        'Orange tee',       'common', 150, false, 'top_tee_orange'),
  ('top_hoodie_green', 'top',        'Green hoodie',     'common', 150, false, 'top_hoodie_green'),
  ('top_tee_purple',   'top',        'Purple tee',       'common', 150, false, 'top_tee_purple'),
  ('top_sweater_red',  'top',        'Red sweater',      'common', 150, false, 'top_sweater_red'),
  ('top_tee_teal',     'top',        'Teal tee',         'common', 150, false, 'top_tee_teal'),
  ('face_smile',       'face',       'Smile',            'common', 150, false, 'face_smile'),
  ('face_grin',        'face',       'Grin',             'common', 150, false, 'face_grin'),
  ('face_wink',        'face',       'Wink',             'common', 150, false, 'face_wink'),
  ('head_beanie',      'head',       'Beanie',           'common', 150, false, 'head_beanie'),
  ('head_cap',         'head',       'Cap',              'common', 150, false, 'head_cap'),
  ('head_sprout',      'head',       'Sprout',           'common', 150, false, 'head_sprout'),
  ('head_headphones',  'head',       'Headphones',       'common', 150, false, 'head_headphones'),
  ('head_bow',         'head',       'Bow',              'common', 150, false, 'head_bow'),
  ('head_gradcap',     'head',       'Graduation cap',   'common', 150, false, 'head_gradcap');

-- The looks offered at onboarding, by item sku. Public so the app can draw the choices.
insert into public.app_config (key, value, public) values ('starter_avatars', '{"starter_avatars": [
  { "id": "starter_1", "items": ["bg_sky",   "top_hoodie_navy",  "face_smile", "head_beanie"] },
  { "id": "starter_2", "items": ["bg_peach", "top_tee_orange",   "face_grin",  "head_cap"] },
  { "id": "starter_3", "items": ["bg_mint",  "top_hoodie_green", "face_smile", "head_sprout"] },
  { "id": "starter_4", "items": ["bg_lilac", "top_tee_purple",   "face_wink",  "head_headphones"] },
  { "id": "starter_5", "items": ["bg_rose",  "top_sweater_red",  "face_grin",  "head_bow"] },
  { "id": "starter_6", "items": ["bg_sun",   "top_tee_teal",     "face_wink",  "head_gradcap"] }
]}', true)
on conflict (key) do nothing;

-- complete_onboarding gains the starter avatar (spec 6.3 parameter order). The app is not released,
-- so the old signature is dropped rather than kept.
drop function public.complete_onboarding(text, text, boolean, boolean, text, text);

create function public.complete_onboarding(
  p_display_name text,
  p_starter_avatar text,
  p_accept_terms_version text,
  p_analytics boolean,
  p_personalized_ads boolean,
  p_zip text default null,
  p_timezone text default 'America/Chicago'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_profile public.profiles;
  v_skus    text[];
begin
  select * into v_profile from public.profiles where id = v_uid for update;
  if v_profile.display_name is not null then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;

  if p_display_name is null or p_display_name !~ '^[A-Za-z0-9_.]{3,20}$' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"display_name"}';
  end if;
  -- deleted_xxxx is what account deletion writes (spec 5.5).
  if lower(p_display_name) like 'deleted\_%' then
    raise exception using errcode = 'P0001', message = 'PROHIBITED_CONTENT', detail = '{"field":"display_name"}';
  end if;
  select array(select jsonb_array_elements_text(s -> 'items')) into v_skus
  from public.app_config c, jsonb_array_elements(c.value -> 'starter_avatars') as s
  where c.key = 'starter_avatars' and s ->> 'id' = p_starter_avatar;
  if coalesce(cardinality(v_skus), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"starter_avatar"}';
  end if;
  if coalesce(btrim(p_accept_terms_version), '') = '' or p_analytics is null or p_personalized_ads is null then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"consent"}';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"timezone"}';
  end if;
  -- Students take their campus as their area; general users need a known ZIP code.
  if v_profile.campus_id is null
     and (p_zip is null or not exists (select 1 from public.zip_codes where zip = p_zip)) then
    raise exception using errcode = 'P0001', message = 'ZIP_REQUIRED';
  end if;

  begin
    update public.profiles
    set display_name = p_display_name,
        zip = case when campus_id is null then p_zip end,
        timezone = p_timezone
    where id = v_uid
    returning * into v_profile;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'ALREADY_EXISTS', detail = '{"field":"display_name"}';
  end;

  insert into public.inventory (user_id, item_id)
  select v_uid, i.id from public.shop_items i where i.sku = any (v_skus)
  on conflict do nothing;
  insert into public.avatar_loadout (user_id, slot, item_id)
  select v_uid, i.slot, i.id from public.shop_items i where i.sku = any (v_skus)
  on conflict (user_id, slot) do update set item_id = excluded.item_id;

  insert into public.consents (user_id, analytics, personalized_ads, policy_version)
  values (v_uid, p_analytics, p_personalized_ads, p_accept_terms_version)
  on conflict (user_id) do update
  set analytics = excluded.analytics,
      personalized_ads = excluded.personalized_ads,
      policy_version = excluded.policy_version,
      updated_at = now();

  return to_jsonb(v_profile);
end;
$$;

revoke execute on function public.complete_onboarding(text, text, text, boolean, boolean, text, text) from public, anon;
grant execute on function public.complete_onboarding(text, text, text, boolean, boolean, text, text) to authenticated;

-- get_my_account adds the equipped avatar as { slot: asset_key }.
create or replace function public.get_my_account() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(true);
begin
  return (
    select jsonb_build_object(
      'email', a.email,
      'secondary_email', a.secondary_email,
      'secondary_verified', a.secondary_verified_at is not null,
      'campus', case when c.id is null then null else to_jsonb(c) end,
      'status', p.status,
      'onboarded', p.display_name is not null,
      'avatar', (
        select coalesce(jsonb_object_agg(l.slot, i.asset_key), '{}'::jsonb)
        from public.avatar_loadout l
        join public.shop_items i on i.id = l.item_id
        where l.user_id = p.id),
      'created_at', p.created_at)
    from public.profiles p
    join private.accounts a on a.user_id = p.id
    left join public.campuses c on c.id = p.campus_id
    where p.id = v_uid);
end;
$$;
