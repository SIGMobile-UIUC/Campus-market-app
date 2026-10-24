-- APP-9: the chat list. Open chats the caller has not left and that have at least one message, newest
-- first, with the listing, the other side, the last message, unread count and whether a trade is open.

-- ponytail: no paging; the 200 most recent chats cover the MVP, add a cursor when someone needs more.
create function public.my_chats() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(x.row order by x.last_message_at desc), '[]')
  from (
    select c.last_message_at, jsonb_build_object(
      'chat_id', c.id,
      'listing_id', c.listing_id,
      'last_message_at', c.last_message_at,
      'closed_at', c.closed_at,
      'unread', c.last_seq - r.last_read_seq,
      'muted', r.muted,
      -- Null when the listing is no longer visible to the caller (removed, or a block).
      'listing', (select jsonb_build_object('title', l.title, 'kind', l.kind, 'status', l.status,
                                            'thumb_path', ph.thumb_path, 'blurhash', ph.blurhash)
                  from public.listings l
                  left join lateral (select p.thumb_path, p.blurhash from public.listing_photos p
                                     where p.listing_id = l.id order by p.position limit 1) ph on true
                  where l.id = c.listing_id),
      'partner', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'tier', p.tier,
                                            'student', p.campus_id is not null)
                  from public.profiles p
                  where p.id = case when c.owner_id = (select auth.uid()) then c.member_id else c.owner_id end),
      'last_message', (select jsonb_build_object('kind', m.kind, 'body', m.body, 'sender_id', m.sender_id, 'meta', m.meta)
                       from public.messages m where m.chat_id = c.id and m.seq = c.last_seq),
      'active_trade', exists (select 1 from public.trades t
                              where t.chat_id = c.id and t.status in ('proposed', 'accepted', 'disputed'))
    ) as row
    from public.chat_reads r
    join public.chats c on c.id = r.chat_id
    where r.user_id = (select auth.uid()) and r.left_at is null and c.last_message_at is not null
    order by c.last_message_at desc
    limit 200
  ) x;
$$;

revoke execute on function public.my_chats() from public, anon;
grant execute on function public.my_chats() to authenticated;
