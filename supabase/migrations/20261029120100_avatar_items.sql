-- More avatar choices (spec 4.14): free bodies (five skin tones, a dog and a cat) that every account owns,
-- and more items for sale in every slot, priced by rarity (1.7.2).

-- Bodies are granted, never sold (active = false), like the starter items.
insert into public.shop_items (sku, slot, name, rarity, price, active, asset_key) values
  ('body_tone_1', 'body', 'Light',        'common', 150, false, 'body_tone_1'),
  ('body_tone_2', 'body', 'Medium light', 'common', 150, false, 'body_tone_2'),
  ('body_tone_3', 'body', 'Medium',       'common', 150, false, 'body_tone_3'),
  ('body_tone_4', 'body', 'Medium dark',  'common', 150, false, 'body_tone_4'),
  ('body_tone_5', 'body', 'Dark',         'common', 150, false, 'body_tone_5'),
  ('body_dog',    'body', 'Puppy',        'common', 150, false, 'body_dog'),
  ('body_cat',    'body', 'Kitty',        'common', 150, false, 'body_cat')
on conflict (sku) do nothing;

insert into public.shop_items (sku, slot, name, rarity, price, min_tier, asset_key) values
  ('bg_forest',         'background', 'Forest',         'common', 150,  null,     'bg_forest'),
  ('bg_ocean',          'background', 'Ocean',          'common', 150,  null,     'bg_ocean'),
  ('bg_sunset',         'background', 'Sunset',         'rare',   400,  null,     'bg_sunset'),
  ('bg_galaxy',         'background', 'Galaxy',         'epic',   1000, 'b_plus', 'bg_galaxy'),
  ('top_tee_white',     'top',        'White tee',      'common', 150,  null,     'top_tee_white'),
  ('top_hoodie_pink',   'top',        'Pink hoodie',    'common', 150,  null,     'top_hoodie_pink'),
  ('top_sweater_cream', 'top',        'Cream sweater',  'rare',   400,  null,     'top_sweater_cream'),
  ('top_hoodie_galaxy', 'top',        'Galaxy hoodie',  'epic',   1000, 'b_plus', 'top_hoodie_galaxy'),
  ('face_surprised',    'face',       'Surprised',      'common', 150,  null,     'face_surprised'),
  ('face_sleepy',       'face',       'Sleepy',         'common', 150,  null,     'face_sleepy'),
  ('face_tongue',       'face',       'Silly',          'common', 150,  null,     'face_tongue'),
  ('face_cool',         'face',       'Sunglasses',     'rare',   400,  null,     'face_cool'),
  ('head_party',        'head',       'Party hat',      'common', 150,  null,     'head_party'),
  ('head_flower',       'head',       'Flower',         'common', 150,  null,     'head_flower'),
  ('head_wizard',       'head',       'Wizard hat',     'rare',   400,  null,     'head_wizard'),
  ('head_crown',        'head',       'Crown',          'epic',   1000, 'b_plus', 'head_crown')
on conflict (sku) do nothing;

-- Every account owns every body: new profiles get them here, existing ones below. A later migration
-- that adds a body grants it to existing accounts the same way.
create function private.grant_bodies() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inventory (user_id, item_id)
  select new.id, id from public.shop_items where slot = 'body'
  on conflict do nothing;
  return null;
end;
$$;
create trigger profiles_bodies after insert on public.profiles for each row execute function private.grant_bodies();

insert into public.inventory (user_id, item_id)
select p.id, i.id from public.profiles p, public.shop_items i where i.slot = 'body'
on conflict do nothing;

revoke execute on function private.grant_bodies() from public, anon, authenticated;
