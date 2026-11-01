-- More head items (spec 4.14): hairstyles, which share the head slot with hats, and more headwear, sold
-- in the shop and priced by rarity (1.7.2).
insert into public.shop_items (sku, slot, name, rarity, price, min_tier, asset_key) values
  ('head_hair_short',    'head', 'Short hair',       'common', 150,  null,     'head_hair_short'),
  ('head_hair_bob',      'head', 'Bob',              'common', 150,  null,     'head_hair_bob'),
  ('head_hair_long',     'head', 'Long hair',        'common', 150,  null,     'head_hair_long'),
  ('head_hair_curly',    'head', 'Curly hair',       'common', 150,  null,     'head_hair_curly'),
  ('head_hair_bun',      'head', 'Top bun',          'common', 150,  null,     'head_hair_bun'),
  ('head_hair_pigtails', 'head', 'Pigtails',         'common', 150,  null,     'head_hair_pigtails'),
  ('head_hair_spiky',    'head', 'Spiky hair',       'common', 150,  null,     'head_hair_spiky'),
  ('head_bunny',         'head', 'Bunny ears',       'common', 150,  null,     'head_bunny'),
  ('head_devil',         'head', 'Devil horns',      'common', 150,  null,     'head_devil'),
  ('head_beret',         'head', 'Beret',            'common', 150,  null,     'head_beret'),
  ('head_bucket',        'head', 'Bucket hat',       'common', 150,  null,     'head_bucket'),
  ('head_headband',      'head', 'Sports headband',  'common', 150,  null,     'head_headband'),
  ('head_antenna',       'head', 'Antennae',         'common', 150,  null,     'head_antenna'),
  ('head_goggles',       'head', 'Goggles',          'rare',   400,  null,     'head_goggles'),
  ('head_chef',          'head', 'Chef hat',         'rare',   400,  null,     'head_chef'),
  ('head_cowboy',        'head', 'Cowboy hat',       'rare',   400,  null,     'head_cowboy'),
  ('head_halo',          'head', 'Halo',             'epic',   1000, 'b_plus', 'head_halo'),
  ('head_tiara',         'head', 'Tiara',            'epic',   1000, 'b_plus', 'head_tiara')
on conflict (sku) do nothing;
