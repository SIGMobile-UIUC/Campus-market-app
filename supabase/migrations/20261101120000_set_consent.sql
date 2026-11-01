-- APP-19: users change their analytics and personalized-ad choices any time (INS-1, spec 6.3).
-- Suspended users can still change them.
create function public.set_consent(p_analytics boolean, p_personalized_ads boolean, p_policy_version text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user(true);
  v_consent public.consents;
begin
  if p_analytics is null or p_personalized_ads is null or coalesce(btrim(p_policy_version), '') = '' then
    perform private.fail('VALIDATION_FAILED', 'consent');
  end if;
  insert into public.consents (user_id, analytics, personalized_ads, policy_version)
  values (v_uid, p_analytics, p_personalized_ads, btrim(p_policy_version))
  on conflict (user_id) do update
  set analytics = excluded.analytics, personalized_ads = excluded.personalized_ads,
      policy_version = excluded.policy_version, updated_at = now()
  returning * into v_consent;
  return to_jsonb(v_consent);
end;
$$;

revoke execute on function public.set_consent(boolean, boolean, text) from public, anon;
grant execute on function public.set_consent(boolean, boolean, text) to authenticated;
