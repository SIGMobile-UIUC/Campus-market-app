-- DB-2: profiles, accounts, roles, settings and consents; profile creation on email confirmation (spec 4.6, 5.3.3).

create type public.account_status as enum ('active', 'suspended', 'banned', 'deleted');
create type public.tier           as enum ('c', 'b_minus', 'b', 'b_plus', 'a_minus', 'a', 'a_plus');  -- trust grade
create type public.admin_role     as enum ('campus_admin', 'super_admin', 'team');

create table public.profiles (
  id                      uuid primary key references auth.users on delete restrict,
  campus_id               uuid references public.campuses,           -- null for general users
  zip                     text references public.zip_codes,          -- default area of general users
  timezone                text not null default 'America/Chicago',   -- IANA name from the device
  display_name            text check (display_name ~ '^[A-Za-z0-9_.]{3,20}$'),  -- null until onboarding
  display_name_changed_at timestamptz,
  tier                    public.tier not null default 'b',          -- trust grade, cache of rank_stats.tier
  status                  public.account_status not null default 'active',
  suspended_until         timestamptz,
  created_at              timestamptz not null default now()
);

-- Nicknames are unique regardless of case, so "Maple" cannot pose as "maple".
create unique index profiles_display_name_key on public.profiles (lower(display_name));

create table private.accounts (
  user_id               uuid primary key references public.profiles on delete cascade,
  email                 text not null unique,
  secondary_email       text,                    -- ACC-6 (P1)
  secondary_verified_at timestamptz,
  analytics_id          uuid not null unique default gen_random_uuid(),
  created_at            timestamptz not null default now()
);

create table public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  role       public.admin_role not null,
  campus_id  uuid references public.campuses on delete cascade,
  granted_by uuid references public.profiles,
  created_at timestamptz not null default now(),
  unique nulls not distinct (user_id, role, campus_id),
  check ((role = 'campus_admin') = (campus_id is not null))
);

create table public.user_settings (
  user_id             uuid primary key references public.profiles on delete cascade,
  lock_screen_preview boolean not null default true,
  push_prefs          jsonb not null default '{}'
);

create table public.consents (
  user_id          uuid primary key references public.profiles on delete cascade,
  analytics        boolean not null,
  personalized_ads boolean not null,
  policy_version   text not null,
  updated_at       timestamptz not null default now()
);

alter table public.app_config add foreign key (updated_by) references public.profiles;

alter table public.profiles      enable row level security;
alter table public.user_roles    enable row level security;
alter table public.user_settings enable row level security;
alter table public.consents      enable row level security;

-- Others see active, onboarded profiles only; everyone sees their own row.
create policy profiles_select on public.profiles for select to authenticated
using (id = (select auth.uid()) or (status = 'active' and display_name is not null));

create policy user_roles_select    on public.user_roles    for select to authenticated using (user_id = (select auth.uid()));
create policy user_settings_select on public.user_settings for select to authenticated using (user_id = (select auth.uid()));
create policy consents_select      on public.consents      for select to authenticated using (user_id = (select auth.uid()));

-- Campus matching (spec 4.6.1): the domain must equal a listed domain, or end with "." plus a listed
-- domain that includes subdomains. A plain suffix check would accept fakeillinois.edu.
create function private.campus_for_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select d.campus_id
  from public.campus_domains d, lower(split_part(p_email, '@', 2)) as e(domain)
  where e.domain = d.domain
     or (d.include_subdomains and right(e.domain, length(d.domain) + 1) = '.' || d.domain)
  order by length(d.domain) desc
  limit 1;
$$;

-- Supabase creates the auth user when a code is requested, so the profile is created only once the
-- email is confirmed. Users inserted already confirmed (dashboard, tests) take the same path.
create function private.handle_email_confirmed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, campus_id) values (new.id, private.campus_for_email(new.email));
  insert into private.accounts (user_id, email) values (new.id, lower(new.email));
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_confirmed
after update of email_confirmed_at on auth.users
for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function private.handle_email_confirmed();

create trigger on_auth_user_created_confirmed
after insert on auth.users
for each row when (new.email_confirmed_at is not null)
execute function private.handle_email_confirmed();

-- Used by policies: the caller's campus when it is live and the account is active, else null,
-- so general users and waitlist students see only the open market (spec 4.6.5).
create function private.my_live_campus_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.campus_id
  from public.profiles p
  join public.campuses c on c.id = p.campus_id
  where p.id = auth.uid() and p.status = 'active' and c.status = 'live';
$$;

-- Guard for every user write (spec 4.6.6). p_allow_suspended lets suspended users read their own account.
create function private.require_user(p_allow_suspended boolean default false) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_status public.account_status;
  v_until  timestamptz;
begin
  select status, suspended_until into v_status, v_until from public.profiles where id = auth.uid();
  if not found or v_status = 'deleted' then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if not p_allow_suspended
     and (v_status = 'banned' or (v_status = 'suspended' and (v_until is null or v_until > now()))) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_SUSPENDED';
  end if;
  return auth.uid();
end;
$$;

create function public.get_my_account() returns jsonb
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
      'created_at', p.created_at)
    from public.profiles p
    join private.accounts a on a.user_id = p.id
    left join public.campuses c on c.id = p.campus_id
    where p.id = v_uid);
end;
$$;

-- ponytail: starter avatar joins the params with the avatar tables in DB-12;
-- nickname word filtering joins with the app_config text filter in DB-6.
create function public.complete_onboarding(
  p_display_name text,
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

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_live_campus_id() to authenticated;

revoke execute on function public.get_my_account() from public, anon;
revoke execute on function public.complete_onboarding(text, text, boolean, boolean, text, text) from public, anon;
grant execute on function public.get_my_account() to authenticated;
grant execute on function public.complete_onboarding(text, text, boolean, boolean, text, text) to authenticated;
