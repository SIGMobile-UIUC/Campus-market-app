-- APP-20: how many people saved each of my listings (DSC-4: sellers see the count). Favorites rows
-- are private to their owner, so the count comes from this function, and only for the caller's
-- own listings.

create function public.favorite_counts(p_listing_ids uuid[]) returns table (listing_id uuid, saves int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(true);
begin
  return query
    select f.listing_id, count(*)::int
    from public.favorites f
    join public.listings l on l.id = f.listing_id
    where f.listing_id = any (p_listing_ids) and l.owner_id = v_uid
    group by f.listing_id;
end;
$$;

revoke execute on function public.favorite_counts(uuid[]) from public, anon;
grant execute on function public.favorite_counts(uuid[]) to authenticated;
