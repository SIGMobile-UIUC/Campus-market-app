-- The body slot: skin tones and animals for the avatar (spec 4.14). A new enum value cannot be used in the
-- transaction that adds it, so the items come in the next migration.
alter type public.item_slot add value if not exists 'body' before 'head';
