-- Demo campuses for local development and staging. ZIP codes, categories and rule values are in migrations,
-- since every environment needs them.

-- Tombstone HMAC key. Staging and production set their own random key in Vault.
select vault.create_secret('local-development-only', 'email_hmac_key');

insert into public.campuses (slug, name, status, timezone, lat, lng, primary_color, accent_color) values
  ('illinois', 'University of Illinois Urbana-Champaign', 'live',     'America/Chicago',              40.1020, -88.2272, '#13294B', '#FF5F05'),
  ('purdue',   'Purdue University',                       'live',     'America/Indiana/Indianapolis', 40.4237, -86.9212, '#000000', '#CFB991'),
  ('michigan', 'University of Michigan',                  'waitlist', 'America/Detroit',              42.2780, -83.7382, '#00274C', '#FFCB05');

insert into public.campus_domains (domain, campus_id, include_subdomains)
select d.domain, c.id, true
from (values ('illinois.edu', 'illinois'), ('purdue.edu', 'purdue'), ('umich.edu', 'michigan')) as d(domain, slug)
join public.campuses c on c.slug = d.slug;

-- Pickup zones and public meetup spots (CMP-2). Coordinates are approximate; check them on a map
-- before the demo.
insert into public.campus_zones (campus_id, name, sort_order)
select c.id, z.name, z.sort_order
from (values
  ('illinois', 'Main Quad', 1),
  ('illinois', 'Green Street', 2),
  ('illinois', 'Engineering Quad', 3),
  ('illinois', 'Ikenberry Commons', 4),
  ('illinois', 'Florida Avenue halls', 5),
  ('purdue', 'Memorial Mall', 1),
  ('purdue', 'State Street', 2),
  ('purdue', 'Northwest halls', 3),
  ('purdue', 'Southwest halls', 4)
) as z(slug, name, sort_order)
join public.campuses c on c.slug = z.slug;

insert into public.meetup_spots (campus_id, zone_id, name, lat, lng)
select c.id, z.id, s.name, s.lat, s.lng
from (values
  ('illinois', 'Main Quad',            'Illini Union, north entrance',  40.1094, -88.2272),
  ('illinois', 'Main Quad',            'Main Library',                  40.1047, -88.2290),
  ('illinois', 'Green Street',         'Alma Mater statue',             40.1100, -88.2285),
  ('illinois', 'Green Street',         'Illini Union Bookstore',        40.1085, -88.2291),
  ('illinois', 'Engineering Quad',     'Grainger Engineering Library',  40.1125, -88.2269),
  ('illinois', 'Ikenberry Commons',    'Ikenberry Dining Center',       40.1037, -88.2353),
  ('illinois', 'Ikenberry Commons',    'Activities and Recreation Center', 40.1015, -88.2363),
  ('illinois', 'Florida Avenue halls', 'Florida Avenue Residence Hall', 40.0985, -88.2206),
  ('purdue',   'Memorial Mall',        'Purdue Memorial Union',         40.4245, -86.9110),
  ('purdue',   'Memorial Mall',        'Hicks Undergraduate Library',   40.4247, -86.9134),
  ('purdue',   'Memorial Mall',        'Wilmeth Active Learning Center', 40.4274, -86.9132),
  ('purdue',   'State Street',         'Chauncey Square',               40.4237, -86.9071),
  ('purdue',   'Northwest halls',      'Córdova Recreational Sports Center', 40.4285, -86.9223),
  ('purdue',   'Northwest halls',      'Wiley Dining Court',            40.4282, -86.9208),
  ('purdue',   'Southwest halls',      'Hillenbrand Dining Court',      40.4269, -86.9268)
) as s(slug, zone, name, lat, lng)
join public.campuses c on c.slug = s.slug
join public.campus_zones z on z.campus_id = c.id and z.name = s.zone;
