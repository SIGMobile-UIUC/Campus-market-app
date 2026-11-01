-- Account deletion (ACC-8, spec 5.5) and the media purge (4.7.2, 4.9).
begin;
\ir _helpers.psql
select plan(15);
select tests.build_matrix();

grant usage on schema tests to service_role;
grant select on tests.matrix, tests.ids to service_role;
create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

-- alpha1 sells a desk to alpha2 (accepted trade t1 in chat c1); alpha1 also has a favorite, a block and
-- a push token.
select tests.remember('l1', tests.create_listing_as('alpha1'));
select tests.login_as(tests.user_id('alpha2'));
select tests.remember('c1', (public.get_or_create_chat(tests.id('l1')) ->> 'chat_id')::uuid);
select tests.remember('t1', (public.propose_trade(tests.id('c1'),
  jsonb_build_object('item_ids', (select jsonb_agg(id) from public.items where listing_id = tests.id('l1')),
                     'total_cents', 4000, 'meet_at', now() + interval '1 day', 'place_text', 'Union'),
  gen_random_uuid()) ->> 'id')::uuid);
select tests.login_as(tests.user_id('alpha1'));
select public.accept_trade(tests.id('t1'));
reset role;
insert into public.favorites (user_id, listing_id) values (tests.user_id('alpha1'), tests.create_listing_as('alpha2'));
insert into public.blocks (blocker_id, blocked_id) values (tests.user_id('alpha1'), tests.user_id('beta1'));
insert into public.push_tokens (token, user_id, platform) values ('ExponentPushToken[alpha1]', tests.user_id('alpha1'), 'android');
insert into public.disputes (id, trade_id, type, opened_by, against_id, statement, response_due_at)
values (tests.remember('d1', gen_random_uuid()), tests.id('t1'), 'no_show', tests.user_id('alpha2'),
        tests.user_id('alpha1'), 'They never came', now() + interval '1 day');

select tests.login_as(tests.user_id('alpha1'));
select throws_ok($$ select public.delete_account(tests.user_id('alpha1')) $$, '42501', null, 'only Edge Functions can delete accounts');

select tests.as_service();
select throws_ok($$ select public.delete_account(tests.user_id('alpha1')) $$, 'P0001', 'DISPUTE_OPEN',
  'refused while the user answers an open dispute');
reset role;
update public.disputes set status = 'rejected', resolved_at = now() - interval '31 days' where id = tests.id('d1');

select tests.as_service();
select lives_ok($$ select public.delete_account(tests.user_id('alpha1')) $$, 'the account is deleted');
select lives_ok($$ select public.delete_account(tests.user_id('alpha1')) $$, 'deleting again does nothing');
reset role;

select is((select status::text || ' ' || (display_name like 'deleted\_%') from public.profiles where id = tests.user_id('alpha1')),
  'deleted true', 'the profile is marked deleted under a generated nickname');
select is((select (select count(*) from private.accounts where user_id = tests.user_id('alpha1'))
                + (select count(*) from public.consents where user_id = tests.user_id('alpha1'))
                + (select count(*) from public.user_settings where user_id = tests.user_id('alpha1'))
                + (select count(*) from public.push_tokens where user_id = tests.user_id('alpha1'))
                + (select count(*) from public.favorites where user_id = tests.user_id('alpha1'))
                + (select count(*) from public.blocks where blocker_id = tests.user_id('alpha1'))
                + (select count(*) from public.avatar_loadout where user_id = tests.user_id('alpha1'))), 0::bigint,
  'email, settings, consents, push tokens, favorites, blocks and the avatar are removed');
select is((select t.status::text || ' ' || i.status from public.trades t join public.items i on i.listing_id = t.listing_id
           where t.id = tests.id('t1')), 'cancelled available', 'open trades are cancelled and their items released');
select ok((select deleted_at is not null and photos_purge_after > now() + interval '29 days' from public.listings where id = tests.id('l1')),
  'active listings are deleted with their photos due in 30 days');
select ok((select closed_at is not null from public.chats where id = tests.id('c1'))
          and exists (select 1 from public.messages where chat_id = tests.id('c1') and meta ->> 'event' = 'left'),
  'every chat is left');
select tests.login_as(tests.user_id('alpha2'));
select is_empty($$ select 1 from public.profiles where id = tests.user_id('alpha1') $$, 'others no longer see the profile');
reset role;

-- Media purge. l1 (deleted) and l2 (two photos) are past their purge date; the evidence of d1 closed 31
-- days ago; both sides left c1 over 7 days ago; one listing photo was never attached.
select tests.remember('l2', tests.create_listing_as('beta1'));
update public.listing_photos set path = 'beta/cover.webp', thumb_path = 'beta/cover_t.webp' where listing_id = tests.id('l2');
insert into public.listing_photos (listing_id, path, thumb_path, blurhash, bytes, position)
values (tests.id('l2'), 'beta/side.webp', 'beta/side_t.webp', 'LKO2?U%2Tw=w', 1, 99);
update public.listings set photos_purge_after = now() - interval '1 minute' where id in (tests.id('l1'), tests.id('l2'));
insert into public.dispute_evidence (id, dispute_id, user_id, kind, photo_path)
values (tests.remember('e1', gen_random_uuid()), tests.id('d1'), tests.user_id('alpha2'), 'photo', 'trade/evidence.webp');
insert into public.messages (chat_id, seq, sender_id, kind, image_path, client_id)
values (tests.id('c1'), 100, tests.user_id('alpha2'), 'image', 'chat/photo.webp', gen_random_uuid());
update public.chats set purge_after = now() - interval '1 minute' where id = tests.id('c1');
insert into storage.objects (bucket_id, name, created_at) values ('listing-photos', 'beta/abandoned.webp', now() - interval '2 days');

-- An open dispute on the listing's trade holds its photos and the chat.
insert into public.disputes (id, trade_id, type, opened_by, against_id, statement, response_due_at, status)
values (tests.remember('d2', gen_random_uuid()), tests.id('t1'), 'no_show', tests.user_id('beta1'),
        tests.user_id('alpha2'), 'Held', now() + interval '1 day', 'under_review');
select tests.as_service();
select is((select (d -> 'listings') ? tests.id('l1')::text or (d -> 'chats') ? tests.id('c1')::text from public.media_purge_due() d),
  false, 'an open dispute holds the listing and the chat');
reset role;
update public.disputes set status = 'rejected', resolved_at = now() where id = tests.id('d2');

select tests.as_service();
create temp table due as select public.media_purge_due() d;
select ok((select (d -> 'listings') @> jsonb_build_array(tests.id('l1'), tests.id('l2')) and (d -> 'evidence') ? tests.id('e1')::text
                  and (d -> 'chats') ? tests.id('c1')::text from due),
  'due listings, evidence and chats are collected');
select ok((select d -> 'objects' -> 'listing-photos' @> '["beta/cover.webp", "beta/side.webp", "beta/side_t.webp", "beta/abandoned.webp"]'
                  and not (d -> 'objects' -> 'listing-photos') ? 'beta/cover_t.webp'
                  and d -> 'objects' -> 'chat-images' ? 'chat/photo.webp'
                  and d -> 'objects' -> 'dispute-evidence' ? 'trade/evidence.webp' from due),
  'every file goes except the cover thumbnail of a listing that is not deleted, and unattached files go too');
select public.media_purge_finish((select d from due));
reset role;

select is((select jsonb_agg(jsonb_build_array(path, thumb_path)) from public.listing_photos where listing_id in (tests.id('l1'), tests.id('l2'))),
  '[[null, "beta/cover_t.webp"]]'::jsonb, 'a deleted listing loses every photo row, others keep the cover thumbnail');
select ok(not exists (select 1 from public.dispute_evidence where id = tests.id('e1'))
          and not exists (select 1 from public.messages where chat_id = tests.id('c1'))
          and (select purged_at is not null from public.chats where id = tests.id('c1')),
  'evidence photos and the chat messages are deleted; the chat row stays');

select * from finish();
rollback;
