-- FN-2: account deletion (ACC-8, spec 5.5) and the media purge (4.7.2, 4.9, 4.19). Edge Functions call
-- these with the service role key: delete-account after it checks a fresh email code, media-purge around
-- deleting the files through the storage API (storage rows cannot be deleted directly).

-- Guard for functions only Edge Functions may call.
create function private.require_service() returns void
language plpgsql stable set search_path = '' as $$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
end;
$$;

-- Personal data goes; trades, reviews, remaining messages and ledger rows stay, and other users see
-- "Deleted user" because the profile is no longer readable (5.5). Refused while the user answers an open
-- dispute (4.18 #26). A deleted account is left as it is, so delete-account can retry its auth step.
-- A banned account's tombstone was written with the ban.
create function public.delete_account(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_trade uuid;
  v_chat  public.chats;
begin
  perform private.require_service();
  perform 1 from public.profiles where id = p_user_id and status <> 'deleted' for update;
  if not found then
    return;
  elsif exists (select 1 from public.disputes where against_id = p_user_id
                and status in ('awaiting_response', 'under_review')) then
    raise exception using errcode = 'P0001', message = 'DISPUTE_OPEN';
  end if;

  -- Open trades end: their items go back on sale and the other side sees the card.
  for v_trade in
    select id from public.trades
    where p_user_id in (seller_id, buyer_id) and status in ('proposed', 'accepted')
    order by id for update
  loop
    update public.items set status = 'available', reserved_trade_id = null where reserved_trade_id = v_trade;
    update public.trades set status = 'cancelled', closed_at = now(), next_check_at = null,
                             cancelled_by = p_user_id, cancel_reason = 'Account deleted'
    where id = v_trade;
    perform private.trade_event(v_trade, p_user_id);
  end loop;

  -- Every chat is left as leave_chat does; one the other side already left is purged 7 days later.
  for v_chat in
    select c.* from public.chats c join public.chat_reads r on r.chat_id = c.id
    where r.user_id = p_user_id and r.left_at is null
    order by c.id for update of c
  loop
    update public.chat_reads set left_at = now() where chat_id = v_chat.id and user_id = p_user_id;
    if v_chat.closed_at is null then
      perform private.post_system_message(v_chat.id, jsonb_build_object('event', 'left', 'user_id', p_user_id), p_user_id);
      update public.chats set closed_at = now() where id = v_chat.id;
    else
      update public.chats set purge_after = now() + interval '7 days' where id = v_chat.id;
    end if;
  end loop;

  -- Active listings come down; the lifecycle trigger schedules their photos 30 days out.
  update public.listings set deleted_at = now()
  where owner_id = p_user_id and status = 'active' and deleted_at is null;

  delete from public.push_tokens where user_id = p_user_id;
  delete from public.user_settings where user_id = p_user_id;
  delete from public.consents where user_id = p_user_id;
  delete from public.favorites where user_id = p_user_id;
  delete from public.blocks where blocker_id = p_user_id;
  delete from public.avatar_loadout where user_id = p_user_id;
  delete from private.accounts where user_id = p_user_id;
  update public.profiles
  set status = 'deleted', suspended_until = null,
      display_name = 'deleted_' || left(replace(gen_random_uuid()::text, '-', ''), 12)
  where id = p_user_id;
end;
$$;

-- A chat's media waits while one of its trades has an open dispute or a report on one of its messages
-- is open (4.9).
create function private.chat_on_hold(p_chat_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.trades t join public.disputes d on d.trade_id = t.id
                 where t.chat_id = p_chat_id and d.status in ('awaiting_response', 'under_review'))
      or exists (select 1 from public.reports r
                 where r.target_type = 'message' and r.status = 'open' and r.target_ref like p_chat_id || ':%');
$$;

-- What media-purge deletes now: the files by bucket, and the rows media_purge_finish changes once the
-- files are gone.
--   listings     past photos_purge_after and without an open dispute: every photo of a deleted listing,
--                otherwise all but the cover thumbnail (4.7.2)
--   evidence     photos of disputes closed over 30 days ago
--   chats        past purge_after (both sides left 7 days ago): their photos, then their messages (4.9)
--   chat_photos  photos in chats whose last message is over a year old
--   unreferenced files a day after upload, from abandoned posts and failed sends (4.19)
create function public.media_purge_due() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_listings uuid[];
  v_evidence uuid[];
  v_chats    uuid[];
  v_photos   text[];
  v_objects  jsonb;
begin
  perform private.require_service();
  select coalesce(array_agg(l.id), '{}') into v_listings
  from public.listings l
  where l.photos_purge_after <= now()
    and not exists (select 1 from public.trades t join public.disputes d on d.trade_id = t.id
                    where t.listing_id = l.id and d.status in ('awaiting_response', 'under_review'));

  select coalesce(array_agg(e.id), '{}') into v_evidence
  from public.dispute_evidence e join public.disputes d on d.id = e.dispute_id
  where e.kind = 'photo' and d.resolved_at < now() - interval '30 days';

  select coalesce(array_agg(c.id), '{}') into v_chats
  from public.chats c
  where c.purge_after <= now() and c.purged_at is null and not private.chat_on_hold(c.id);

  select coalesce(array_agg(x.image_path), '{}') into v_photos
  from public.chats c
  cross join lateral (select m.image_path from public.messages m where m.chat_id = c.id and m.image_path is not null
                      union all
                      select h.image_path from private.hidden_messages h where h.chat_id = c.id and h.image_path is not null) x
  where c.last_message_at < now() - interval '1 year' and c.purged_at is null and c.id <> all (v_chats)
    and not private.chat_on_hold(c.id);

  select coalesce(jsonb_object_agg(f.bucket, f.names), '{}') into v_objects
  from (
    select o.bucket, jsonb_agg(distinct o.name) as names
    from (
      select 'listing-photos' as bucket, n.name
      from public.listings l
      join public.listing_photos p on p.listing_id = l.id
      cross join lateral (values (p.path), (case when l.deleted_at is not null or p.position >
        (select min(c.position) from public.listing_photos c where c.listing_id = l.id) then p.thumb_path end)) n(name)
      where l.id = any (v_listings) and n.name is not null
      union all
      select 'dispute-evidence', e.photo_path from public.dispute_evidence e where e.id = any (v_evidence)
      union all
      select 'chat-images', m.image_path from public.messages m where m.chat_id = any (v_chats) and m.image_path is not null
      union all
      select 'chat-images', h.image_path from private.hidden_messages h where h.chat_id = any (v_chats) and h.image_path is not null
      union all
      select 'chat-images', unnest(v_photos)
      union all
      -- ponytail: scans messages and evidence per file; index image_path if the purge gets slow.
      select s.bucket_id, s.name from storage.objects s
      where s.bucket_id in ('listing-photos', 'chat-images', 'dispute-evidence') and s.created_at < now() - interval '1 day'
        and not exists (select 1 from public.listing_photos p where s.name in (p.path, p.thumb_path))
        and not exists (select 1 from public.messages m where m.image_path = s.name)
        and not exists (select 1 from private.hidden_messages h where h.image_path = s.name)
        and not exists (select 1 from public.dispute_evidence e where e.photo_path = s.name)
    ) o
    group by o.bucket
  ) f;

  return jsonb_build_object('listings', to_jsonb(v_listings), 'evidence', to_jsonb(v_evidence),
                            'chats', to_jsonb(v_chats), 'chat_photos', to_jsonb(v_photos), 'objects', v_objects);
end;
$$;

-- Applies a media_purge_due result after its files are deleted. A deleted listing loses every photo row;
-- any other keeps its cover row without the detail path. Purged chats keep their row for trades and reviews.
create function public.media_purge_finish(p_due jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_listings uuid[] := array(select jsonb_array_elements_text(p_due -> 'listings')::uuid);
  v_evidence uuid[] := array(select jsonb_array_elements_text(p_due -> 'evidence')::uuid);
  v_chats    uuid[] := array(select jsonb_array_elements_text(p_due -> 'chats')::uuid);
  v_photos   text[] := array(select jsonb_array_elements_text(p_due -> 'chat_photos'));
begin
  perform private.require_service();
  delete from public.listing_photos p using public.listings l
  where l.id = p.listing_id and l.id = any (v_listings)
    and (l.deleted_at is not null
         or p.position > (select min(c.position) from public.listing_photos c where c.listing_id = l.id));
  update public.listing_photos set path = null where listing_id = any (v_listings);
  update public.listings set photos_purge_after = null where id = any (v_listings);

  delete from public.dispute_evidence where id = any (v_evidence);

  delete from public.messages where chat_id = any (v_chats);
  update public.chats set purged_at = now() where id = any (v_chats);

  update public.messages set image_path = null where image_path = any (v_photos);
  update private.hidden_messages set image_path = null where image_path = any (v_photos);

  return jsonb_build_object('listings', cardinality(v_listings), 'evidence', cardinality(v_evidence),
                            'chats', cardinality(v_chats), 'chat_photos', cardinality(v_photos));
end;
$$;

-- daily-maintenance (DB-15) now also asks media-purge to run. It is skipped until the function's URL and
-- shared secret are in Vault (media_purge_url, media_purge_secret).
create or replace function private.daily_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_count  int;
  v_wallet record;
  v_url    text;
  v_secret text;
begin
  if not pg_try_advisory_xact_lock(hashtext('daily-maintenance')) then
    return null;
  end if;

  perform private.mark_rank_dirty(variadic array(
    select distinct user_id from public.penalties where expires_at between now() - interval '1 day' and now()));

  delete from auth.users where email_confirmed_at is null and created_at < now() - interval '24 hours';
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('unconfirmed_users', v_count);

  delete from private.events where received_at < now() - interval '12 months';
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('events_deleted', v_count);

  update private.events set props = props - 'term'
  where name = 'search' and props ? 'term' and received_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('terms_blanked', v_count);

  select max(decrypted_secret) filter (where name = 'media_purge_url'),
         max(decrypted_secret) filter (where name = 'media_purge_secret')
  into v_url, v_secret
  from vault.decrypted_secrets where name in ('media_purge_url', 'media_purge_secret');
  if v_url is not null and v_secret is not null then
    perform net.http_post(url := v_url, headers := jsonb_build_object('x-purge-secret', v_secret),
                          timeout_milliseconds := 120000);
  end if;
  v_result := v_result || jsonb_build_object('media_purge_requested', v_url is not null and v_secret is not null);

  v_count := 0;
  for v_wallet in
    select w.user_id, w.balance, coalesce(sum(l.delta), 0) as ledger
    from public.wallets w left join public.points_ledger l on l.user_id = w.user_id
    group by w.user_id, w.balance
    having w.balance <> coalesce(sum(l.delta), 0)
  loop
    raise warning 'daily-maintenance: wallet % balance % differs from its ledger %', v_wallet.user_id, v_wallet.balance, v_wallet.ledger;
    v_count := v_count + 1;
  end loop;
  return v_result || jsonb_build_object('wallet_mismatches', v_count);
end;
$$;

revoke execute on function private.require_service(), private.chat_on_hold(uuid) from public, anon, authenticated;
revoke execute on function public.delete_account(uuid), public.media_purge_due(), public.media_purge_finish(jsonb)
  from public, anon, authenticated;
grant execute on function public.delete_account(uuid), public.media_purge_due(), public.media_purge_finish(jsonb)
  to service_role;
