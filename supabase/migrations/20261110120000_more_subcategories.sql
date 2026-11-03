-- More subcategories (spec 1.7.5), drawn from eBay's category tree and kept to what students trade and
-- policy allows (section 2.2), and an "Other" at the end of every category but Other itself, so an item
-- that fits a category but none of its subcategories stays findable there. Only missing ids are appended,
-- so changes a super admin made in app_config are kept.
with additions (category, subcategories) as (values
  ('furniture', '[
    {"id": "nightstands_and_side_tables", "label": "Nightstands and side tables"},
    {"id": "tv_stands_and_media_consoles", "label": "TV stands and media consoles"},
    {"id": "futons_and_sofa_beds", "label": "Futons and sofa beds"},
    {"id": "bean_bags_and_floor_seating", "label": "Bean bags and floor seating"},
    {"id": "ottomans_and_benches", "label": "Ottomans and benches"},
    {"id": "outdoor_and_patio", "label": "Outdoor and patio"}]'),
  ('appliances', '[
    {"id": "air_conditioners", "label": "Air conditioners"},
    {"id": "washers_and_dryers", "label": "Washers and dryers"},
    {"id": "irons_and_steamers", "label": "Irons and steamers"},
    {"id": "sewing_machines", "label": "Sewing machines"}]'),
  ('kitchen', '[
    {"id": "blenders_and_mixers", "label": "Blenders and mixers"},
    {"id": "toasters_and_toaster_ovens", "label": "Toasters and toaster ovens"},
    {"id": "bakeware", "label": "Bakeware"},
    {"id": "knives_and_cutting_boards", "label": "Knives and cutting boards"},
    {"id": "glassware_and_drinkware", "label": "Glassware and drinkware"}]'),
  ('bedding_and_bath', '[
    {"id": "blankets_and_throws", "label": "Blankets and throws"},
    {"id": "bath_mats_and_shower_curtains", "label": "Bath mats and shower curtains"},
    {"id": "bathroom_organizers", "label": "Bathroom organizers"}]'),
  ('decor_and_storage', '[
    {"id": "clocks", "label": "Clocks"},
    {"id": "picture_frames", "label": "Picture frames"},
    {"id": "closet_organizers_and_hangers", "label": "Closet organizers and hangers"},
    {"id": "holiday_decor", "label": "Holiday decor"},
    {"id": "cleaning_tools", "label": "Cleaning tools"}]'),
  ('electronics', '[
    {"id": "desktop_computers", "label": "Desktop computers"},
    {"id": "keyboards_and_mice", "label": "Keyboards and mice"},
    {"id": "computer_parts_and_storage", "label": "Computer parts and storage"},
    {"id": "e_readers", "label": "E-readers"},
    {"id": "smartwatches_and_wearables", "label": "Smartwatches and wearables"},
    {"id": "projectors", "label": "Projectors"},
    {"id": "routers_and_networking", "label": "Routers and networking"}]'),
  ('video_games', '[
    {"id": "handheld_consoles", "label": "Handheld consoles"},
    {"id": "gaming_headsets", "label": "Gaming headsets"},
    {"id": "retro_games", "label": "Retro games"}]'),
  ('textbooks', '[
    {"id": "reference_books", "label": "Reference books"},
    {"id": "language_learning", "label": "Language learning"}]'),
  ('school_and_office_supplies', '[
    {"id": "drafting_and_design_tools", "label": "Drafting and design tools"},
    {"id": "desk_accessories", "label": "Desk accessories"},
    {"id": "whiteboards_and_bulletin_boards", "label": "Whiteboards and bulletin boards"},
    {"id": "planners_and_calendars", "label": "Planners and calendars"}]'),
  ('womens_clothing', '[
    {"id": "sweaters_and_hoodies", "label": "Sweaters and hoodies"},
    {"id": "jumpsuits_and_rompers", "label": "Jumpsuits and rompers"},
    {"id": "swimwear", "label": "Swimwear"},
    {"id": "loungewear", "label": "Loungewear"}]'),
  ('mens_clothing', '[
    {"id": "sweaters_and_hoodies", "label": "Sweaters and hoodies"},
    {"id": "swimwear", "label": "Swimwear"},
    {"id": "loungewear", "label": "Loungewear"}]'),
  ('shoes_bags_and_accessories', '[
    {"id": "dress_shoes", "label": "Dress shoes"},
    {"id": "sandals_and_slides", "label": "Sandals and slides"},
    {"id": "wallets", "label": "Wallets"},
    {"id": "belts", "label": "Belts"},
    {"id": "sunglasses", "label": "Sunglasses"},
    {"id": "scarves_and_gloves", "label": "Scarves and gloves"}]'),
  ('campus_gear', '[
    {"id": "graduation_caps_and_gowns", "label": "Graduation caps and gowns"},
    {"id": "pennants_and_flags", "label": "Pennants and flags"}]'),
  ('bikes_and_scooters', '[
    {"id": "kick_scooters", "label": "Kick scooters"},
    {"id": "roller_skates_and_blades", "label": "Roller skates and blades"},
    {"id": "bike_parts", "label": "Bike parts"},
    {"id": "bike_accessories", "label": "Bike accessories"}]'),
  ('sports_and_outdoors', '[
    {"id": "team_sports", "label": "Team sports"},
    {"id": "running", "label": "Running"},
    {"id": "golf", "label": "Golf"},
    {"id": "water_sports", "label": "Water sports"},
    {"id": "climbing", "label": "Climbing"},
    {"id": "fishing", "label": "Fishing"}]'),
  ('music', '[
    {"id": "instrument_accessories", "label": "Instrument accessories"},
    {"id": "sheet_music_and_books", "label": "Sheet music and books"},
    {"id": "turntables", "label": "Turntables"}]'),
  ('hobbies_and_games', '[
    {"id": "trading_cards", "label": "Trading cards"},
    {"id": "building_sets", "label": "Building sets"},
    {"id": "models_and_rc", "label": "Models and RC"},
    {"id": "toys_and_plush", "label": "Toys and plush"},
    {"id": "movies_and_tv", "label": "Movies and TV"}]'),
  ('beauty_and_personal_care', '[
    {"id": "nail_care", "label": "Nail care"},
    {"id": "bath_and_body", "label": "Bath and body (unopened)"},
    {"id": "massagers", "label": "Massagers"}]'),
  ('pet_supplies', '[
    {"id": "leashes_and_collars", "label": "Leashes and collars"},
    {"id": "carriers_and_crates", "label": "Carriers and crates"},
    {"id": "grooming", "label": "Grooming"}]'),
  ('plants', '[
    {"id": "plant_stands", "label": "Plant stands"},
    {"id": "grow_lights", "label": "Grow lights"},
    {"id": "gardening_tools", "label": "Gardening tools"}]')
)
update public.app_config c
set value = jsonb_set(c.value, '{categories}', (
      select jsonb_agg(
               case when a.category is null then k
               else jsonb_set(k, '{subcategories}', (k -> 'subcategories') || coalesce((
                      select jsonb_agg(s order by n)
                      from jsonb_array_elements(a.subcategories::jsonb || '[{"id": "other", "label": "Other"}]')
                             with ordinality as y(s, n)
                      where not exists (select 1 from jsonb_array_elements(k -> 'subcategories') e where e ->> 'id' = s ->> 'id')),
                    '[]'))
               end order by m)
      from jsonb_array_elements(c.value -> 'categories') with ordinality as x(k, m)
      left join additions a on a.category = k ->> 'id')),
    updated_at = now()
where c.key = 'categories';
