-- DB-1: campuses, meetup geography and rule values (spec 5.3.1, 5.3.2, 5.3.11).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- Policies call a few private helpers, so the API roles may look up the schema;
-- they still get no table grants there and the schema is not exposed by the API.
grant usage on schema private to authenticated;
-- Supabase's global default privileges let anon and authenticated execute every new function, and a
-- per-schema default cannot take that back. Each migration that adds private functions therefore ends
-- with an explicit revoke and grants the few that policies need; the security test enforces it.

create type public.campus_status as enum ('live', 'waitlist');

create table public.campuses (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  status        public.campus_status not null default 'waitlist',
  timezone      text not null,                      -- IANA name, e.g. America/Chicago
  lat           double precision not null,
  lng           double precision not null,
  primary_color text check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color  text check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  banner_path   text,
  created_at    timestamptz not null default now(),
  check (status = 'waitlist' or (primary_color is not null and accent_color is not null))
);

create table public.campus_domains (
  domain             text primary key check (domain = lower(domain)),
  campus_id          uuid not null references public.campuses on delete cascade,
  include_subdomains boolean not null default false
);

create table public.campus_zones (
  id         uuid primary key default gen_random_uuid(),
  campus_id  uuid not null references public.campuses on delete cascade,
  name       text not null,
  sort_order smallint not null default 0,
  unique (campus_id, name)
);

create table public.meetup_spots (
  id        uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses on delete cascade,
  zone_id   uuid references public.campus_zones on delete set null,
  name      text not null,
  lat       double precision not null,
  lng       double precision not null,
  radius_m  integer not null default 150 check (radius_m between 25 and 1000)
);

create table public.zip_codes (            -- seeded from the Census ZCTA file
  zip   text primary key check (zip ~ '^[0-9]{5}$'),
  city  text not null,
  state text not null,
  lat   double precision not null,
  lng   double precision not null
);

create table public.app_config (
  key        text primary key,         -- e.g. min_app_version, text_filter, limits, rank_rules, points_rules, categories
  value      jsonb not null,
  public     boolean not null default false,   -- the app can read only public rows
  updated_by uuid,                     -- references profiles, added with identity
  updated_at timestamptz not null default now()
);

alter table public.campuses       enable row level security;
alter table public.campus_domains enable row level security;
alter table public.campus_zones   enable row level security;
alter table public.meetup_spots   enable row level security;
alter table public.zip_codes      enable row level security;
alter table public.app_config     enable row level security;

-- Campus geography is not secret; any signed-in user reads it. Writes go through admin functions.
create policy campuses_select     on public.campuses     for select to authenticated using (true);
create policy campus_zones_select on public.campus_zones for select to authenticated using (true);
create policy meetup_spots_select on public.meetup_spots for select to authenticated using (true);
create policy zip_codes_select    on public.zip_codes    for select to authenticated using (true);
-- campus_domains has no policy: only the sign-up hook and the confirmation trigger read it.

-- min_app_version must be readable before sign-in.
create policy app_config_select on public.app_config for select to anon, authenticated using (public);
