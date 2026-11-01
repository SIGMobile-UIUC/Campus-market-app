-- APP-22: changing the nickname (PTS-3, spec 1.7.2, 4.13.3). The first change within 7 days of sign-up is
-- free; after that it costs 300 points and waits 30 days from the last change. The values come from
-- points_rules.spend.nickname. A retried request returns what the first one did.
create function public.change_display_name(p_display_name text, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_rule    jsonb := (select value #> '{spend,nickname}' from public.app_config where key = 'points_rules');
  v_profile public.profiles;
  v_price   int := 0;
  v_balance int;
begin
  select * into v_profile from public.profiles where id = v_uid for update;
  select balance into v_balance from public.wallets where user_id = v_uid;
  if p_request_id is null then
    perform private.fail('VALIDATION_FAILED', 'request_id');
  elsif exists (select 1 from public.points_ledger where user_id = v_uid and source = 'nickname' and ref_id = p_request_id::text)
        or v_profile.display_name = p_display_name then
    return jsonb_build_object('display_name', v_profile.display_name, 'points_spent', 0, 'balance', v_balance);
  elsif p_display_name is null or p_display_name !~ '^[A-Za-z0-9_.]{3,20}$' then
    perform private.fail('VALIDATION_FAILED', 'display_name');
  elsif lower(p_display_name) like 'deleted\_%' or private.prohibited_term(p_display_name) is not null then
    perform private.fail('PROHIBITED_CONTENT', 'display_name');
  elsif v_profile.display_name_changed_at > now() - make_interval(days => (v_rule ->> 'cooldown_days')::int) then
    raise exception using errcode = 'P0001', message = 'COOLDOWN_ACTIVE';
  end if;

  if v_profile.display_name_changed_at is not null
     or v_profile.created_at < now() - make_interval(days => (v_rule ->> 'free_within_days')::int) then
    v_price := (v_rule ->> 'points')::int;
    update public.wallets set balance = balance - v_price, updated_at = now()
    where user_id = v_uid and balance >= v_price
    returning balance into v_balance;
    if not found then
      raise exception using errcode = 'P0001', message = 'INSUFFICIENT_POINTS';
    end if;
    insert into public.points_ledger (user_id, kind, source, ref_id, delta, balance_after)
    values (v_uid, 'spend', 'nickname', p_request_id::text, -v_price, v_balance);
  end if;

  begin
    update public.profiles set display_name = p_display_name, display_name_changed_at = now() where id = v_uid;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'ALREADY_EXISTS', detail = '{"field":"display_name"}';
  end;
  return jsonb_build_object('display_name', p_display_name, 'points_spent', v_price, 'balance', v_balance);
end;
$$;

revoke execute on function public.change_display_name(text, uuid) from public, anon;
grant execute on function public.change_display_name(text, uuid) to authenticated;
