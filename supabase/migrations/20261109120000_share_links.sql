-- Share links (LST-11): campusmarket.trade/l/<share_code> opens a listing in the app, or on the web for
-- people without it. Anyone with the link sees a read-only preview, campus-only listings included; feeds,
-- search, chat and trades still follow the listings policy.

-- 48 random bits: the code is the only key to a campus-only listing's preview, so it must not be guessable.
-- It never changes, so printed QR codes keep working.
alter table public.listings
  add column share_code text not null unique default left(replace(gen_random_uuid()::text, '-', ''), 12);

-- The public fields of a listing for its preview, or null once it is deleted or hidden. The seller, the
-- meetup place and moderation fields stay out because the web page is public. Only the listing-preview
-- Edge Function calls this; it signs the photo paths.
create function public.listing_preview(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_service();
  return (
    select jsonb_build_object(
      'kind', l.kind, 'title', l.title, 'description', l.description, 'status', l.status,
      'visibility', l.visibility, 'area_label', l.area_label, 'payment_methods', l.payment_methods,
      'budget_cents', l.budget_cents, 'created_at', l.created_at,
      'campus', (select jsonb_build_object('name', c.name, 'short_name', c.short_name)
                 from public.campuses c where c.id = l.campus_id),
      'zone', (select z.name from public.campus_zones z where z.id = l.zone_id),
      'items', coalesce((select jsonb_agg(jsonb_build_object('position', i.position, 'name', i.name,
                                  'price_cents', i.price_cents, 'negotiable', i.negotiable,
                                  'condition', i.condition, 'status', i.status) order by i.position)
                         from public.items i where i.listing_id = l.id), '[]'),
      'photos', coalesce((select jsonb_agg(jsonb_build_object('path', p.path, 'thumb_path', p.thumb_path,
                                   'blurhash', p.blurhash,
                                   'item', (select i.position from public.items i where i.id = p.item_id))
                                 order by p.position)
                          from public.listing_photos p where p.listing_id = l.id), '[]'))
    from public.listings l
    where l.share_code = p_code and l.deleted_at is null and not l.hidden
  );
end;
$$;

revoke execute on function public.listing_preview(text) from public, anon, authenticated;
grant execute on function public.listing_preview(text) to service_role;
