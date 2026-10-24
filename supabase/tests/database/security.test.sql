-- Schema lint (spec 4.6.5, 4.6.6): RLS everywhere, pinned search paths, guarded definer functions.
begin;
select plan(6);

select is_empty(
  $$ select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'every public table has row-level security enabled'
);

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prosecdef
       and not coalesce('search_path=""' = any(p.proconfig), false) $$,
  'every security definer function pins search_path to empty'
);

-- Add a function here only together with its guard.
select set_eq(
  $$ select p.proname::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef $$,
  array['get_my_account', 'complete_onboarding', 'create_listing', 'update_listing', 'close_listing',
        'reopen_listing', 'delete_listing', 'mark_sold_elsewhere', 'favorite_counts',
        'get_or_create_chat', 'send_message', 'mark_read', 'set_chat_muted', 'leave_chat'],
  'security definer functions in public match the allowlist'
);

select is_empty(
  $$ select p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef
       and p.prosrc !~ 'private\.require_(user|admin)\(' $$,
  'every security definer function in public calls a guard'
);

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
       and p.prorettype <> 'trigger'::regtype $$,
  'anon can execute no function'
);

-- Policies may call these private helpers; nothing else in private is callable by users.
select set_eq(
  $$ select p.proname::text from pg_proc p
     where p.pronamespace = 'private'::regnamespace and p.prokind = 'f'
       and has_function_privilege('authenticated', p.oid, 'execute') $$,
  array['my_live_campus_id', 'my_block_list', 'is_chat_party', 'can_join_topic'],
  'authenticated can execute only the allowlisted private helpers'
);

select * from finish();
rollback;
