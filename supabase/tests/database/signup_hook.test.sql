-- Before User Created hook (spec 4.6.1, 6.3).
begin;
select plan(12);

create function pg_temp.hook(p_email text) returns text
language sql as $$
  select coalesce(private.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('email', p_email))) #>> '{error,message}', 'allowed');
$$;

update public.app_config set value = '["mailinator.com"]' where key = 'disposable_domains';
select vault.create_secret('test-only-key', 'email_hmac_key')
where not exists (select 1 from vault.secrets where name = 'email_hmac_key');

select is(pg_temp.hook('student@illinois.edu'), 'allowed', 'a school email is allowed');
select is(pg_temp.hook('someone@gmail.com'), 'allowed', 'any other email is allowed');
select is(pg_temp.hook('someone+deals@gmail.com'), 'PLUS_ADDRESS_NOT_ALLOWED', 'plus addresses are rejected');
select is(pg_temp.hook('x@mailinator.com'), 'EMAIL_NOT_ALLOWED', 'disposable domains are rejected');
select is(pg_temp.hook('x@inbox.mailinator.com'), 'EMAIL_NOT_ALLOWED', 'subdomains of disposable domains are rejected');
select is(pg_temp.hook('X@MAILINATOR.COM'), 'EMAIL_NOT_ALLOWED', 'domain matching ignores case');
select is(pg_temp.hook('x@notmailinator.com'), 'allowed', 'a look-alike domain is allowed');
select is(
  (private.hook_before_user_created('{"user":{"email":"a+b@gmail.com"}}') #>> '{error,http_code}')::int, 403,
  'rejections carry a 4xx status'
);

insert into private.identity_tombstones (email_hmac, reason) values (private.email_hmac('banned@example.com'), 'ban');
insert into private.identity_tombstones (email_hmac, reason, blocked_until)
values (private.email_hmac('cooled@example.com'), 'deleted_with_penalties', now() - interval '1 day');
select is(pg_temp.hook('Banned@Example.com'), 'REGISTRATION_BLOCKED', 'a tombstoned email cannot sign up again');
select is(pg_temp.hook('cooled@example.com'), 'allowed', 'an expired tombstone no longer blocks');

select ok(has_function_privilege('supabase_auth_admin', 'private.hook_before_user_created(jsonb)', 'execute'), 'Supabase Auth can run the hook');
select ok(not has_function_privilege('authenticated', 'private.hook_before_user_created(jsonb)', 'execute'), 'users cannot run the hook');

select * from finish();
rollback;
