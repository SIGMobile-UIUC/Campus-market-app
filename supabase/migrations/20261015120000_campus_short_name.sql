-- Short campus name for headers and chips ("UIUC only"); the app falls back to the full name.
alter table public.campuses add column short_name text check (char_length(short_name) between 2 and 16);
