-- APP-21: the public profile (ACC-4) and the counts other screens show about other people: a seller's
-- trade count and typical reply time on the listing page, and the offer count on request cards. Trades,
-- chats and reviews are private to their parties, so these definer functions return aggregates only.

-- How fast the user answers a new chat about their listing: the median minutes from the asker's first
-- message to the owner's first reply, over chats from the last 90 days; null with fewer than 3.
create function private.reply_minutes(p_user uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case when count(*) >= 3
              then round(percentile_cont(0.5) within group (order by extract(epoch from replied - asked) / 60))::int end
  from (
    select (select min(m.created_at) from public.messages m where m.chat_id = c.id and m.sender_id = c.member_id) as asked,
           (select min(m.created_at) from public.messages m where m.chat_id = c.id and m.sender_id = c.owner_id) as replied
    from public.chats c
    where c.owner_id = p_user and c.created_at > now() - interval '90 days'
  ) r
  where replied > asked;
$$;

-- What anyone signed in sees of an active, onboarded account they have not blocked (or been blocked by):
-- nickname, grade, school, member-since date, counted trades, typical reply time, avatar and the positive
-- review tags with their counts. Email and negative tags stay private.
create function public.public_profile(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user(true);
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles p
  where p.id = p_user_id and (p.id = v_uid or (p.status = 'active' and p.display_name is not null))
    and p.id <> all (private.my_block_list());
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  return jsonb_build_object(
    'id', v_profile.id,
    'display_name', v_profile.display_name,
    'tier', v_profile.tier,
    'member_since', v_profile.created_at,
    'campus', (select jsonb_build_object('short_name', c.short_name, 'name', c.name)
               from public.campuses c where c.id = v_profile.campus_id),
    'trades', coalesce((select s.counted_trades from public.rank_stats s where s.user_id = p_user_id), 0),
    'reply_minutes', private.reply_minutes(p_user_id),
    'avatar', coalesce((select jsonb_object_agg(l.slot, i.asset_key)
                        from public.avatar_loadout l join public.shop_items i on i.id = l.item_id
                        where l.user_id = p_user_id), '{}'),
    'tags', coalesce((select jsonb_object_agg(x.tag, x.n)
                      from (select t as tag, count(*) as n
                            from public.reviews r, unnest(r.tags) t
                            where r.reviewee_id = p_user_id
                              and t in (select g ->> 'id' from public.app_config c, jsonb_array_elements(c.value -> 'positive') g
                                        where c.key = 'review_tags')
                            group by t) x), '{}'));
end;
$$;

-- Offers on wanted requests (APP-17): proposals that were not declined or withdrawn.
create function public.offer_counts(p_listing_ids uuid[]) returns table (listing_id uuid, offers int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user(true);
  return query
    select t.listing_id, count(*)::int
    from public.trades t
    join public.listings l on l.id = t.listing_id
    where t.listing_id = any (p_listing_ids) and l.kind = 'wanted' and t.status not in ('declined', 'withdrawn')
    group by t.listing_id;
end;
$$;

revoke execute on function private.reply_minutes(uuid) from public, anon, authenticated;
revoke execute on function public.public_profile(uuid), public.offer_counts(uuid[]) from public, anon;
grant execute on function public.public_profile(uuid), public.offer_counts(uuid[]) to authenticated;
