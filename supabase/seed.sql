-- Local development data. Zones, meetup spots, ZIP codes and categories arrive with DB-5.

insert into public.campuses (slug, name, status, timezone, lat, lng, primary_color, accent_color) values
  ('illinois', 'University of Illinois Urbana-Champaign', 'live',     'America/Chicago',              40.1020, -88.2272, '#13294B', '#FF5F05'),
  ('purdue',   'Purdue University',                       'live',     'America/Indiana/Indianapolis', 40.4237, -86.9212, '#000000', '#CFB991'),
  ('michigan', 'University of Michigan',                  'waitlist', 'America/Detroit',              42.2780, -83.7382, '#00274C', '#FFCB05');

insert into public.campus_domains (domain, campus_id, include_subdomains)
select d.domain, c.id, true
from (values ('illinois.edu', 'illinois'), ('purdue.edu', 'purdue'), ('umich.edu', 'michigan')) as d(domain, slug)
join public.campuses c on c.slug = d.slug;
