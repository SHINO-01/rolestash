-- Run with: npm run test:db  (needs Docker; see docs/guides/backend.md)
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.act_as_anon() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create function pg_temp.act_as_admin() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.uid(n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
grant execute on function pg_temp.uid(int) to authenticated, anon;

insert into auth.users (id, email, aud, role)
  select pg_temp.uid(i), 'u' || i || '@example.com', 'authenticated', 'authenticated'
  from generate_series(1, 2) i;

-- Names: up to 100 characters, still not blank ---------------------------------
select pg_temp.act_as(pg_temp.uid(1));
select lives_ok($$insert into public.account_profiles (user_id, display_name)
  values (pg_temp.uid(1), 'Maria Fernanda de los Ángeles Rodríguez-Hernández y Castellanos')$$,
  'a long legal name fits');
select throws_ok($$update public.account_profiles set display_name = repeat('a', 101) where user_id = pg_temp.uid(1)$$,
  '23514', null, 'but not past 100 characters');

-- Welcome email: only the server records it -------------------------------------
select throws_ok($$update public.account_profiles set welcome_sent_at = null where user_id = pg_temp.uid(1)$$,
  '42501', null, 'a user cannot reset when the welcome email was sent');
select throws_ok($$insert into public.account_profiles (user_id, welcome_sent_at) values (pg_temp.uid(1), now())$$,
  '42501', null, 'nor set it on insert');
select pg_temp.act_as_admin();
select lives_ok($$update public.account_profiles set welcome_sent_at = now() where user_id = pg_temp.uid(1)$$,
  'the service role records it');

-- Bug reports: no API access at all ---------------------------------------------
insert into public.bug_reports (user_id, contact_email, message, context, ip_hash)
  values (pg_temp.uid(1), 'u1@example.com', 'Capture missed the salary', '{"version":"0.4.1"}', repeat('a', 64));
select pg_temp.act_as(pg_temp.uid(1));
select throws_ok($$select * from public.bug_reports$$, '42501', null, 'users cannot read reports, even their own');
select throws_ok($$insert into public.bug_reports (message) values ('spam')$$, '42501', null, 'or write them directly');
select pg_temp.act_as_anon();
select throws_ok($$select * from public.bug_reports$$, '42501', null, 'nor can anonymous callers');

select pg_temp.act_as_admin();
select throws_ok($$insert into public.bug_reports (message) values ('   ')$$, '23514', null, 'a report needs a message');
select throws_ok($$insert into public.bug_reports (message, contact_email) values ('x', 'not an email')$$,
  '23514', null, 'and a real-looking contact address');
delete from auth.users where id = pg_temp.uid(1);
select is((select count(*)::int from public.bug_reports where user_id is null), 1,
  'deleting the account keeps the report but drops the account link');

select * from finish();
rollback;
