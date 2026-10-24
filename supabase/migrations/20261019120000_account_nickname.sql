-- get_my_account also returns the caller's nickname and trust grade, for the Me card and for telling
-- the user's own posts apart in lists.

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
      'display_name', p.display_name,
      'tier', p.tier,
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
