-- Run with: npm run test:db  (needs Docker; see docs/guides/backend.md)
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'Sam@Example.com', 'authenticated', 'authenticated');

select set_config('role', 'service_role', true);
select is(public.user_id_for_email(' sam@example.COM '), '11111111-1111-4111-8111-111111111111'::uuid,
  'the service role finds an account by email, ignoring case and spaces');
select is(public.user_id_for_email('nobody@example.com'), null, 'no account, no id');

select set_config('role', 'authenticated', true),
  set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select throws_ok($$select public.user_id_for_email('sam@example.com')$$, '42501', null,
  'signed-in users cannot look accounts up by email');
select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select public.user_id_for_email('sam@example.com')$$, '42501', null,
  'nor can anyone else');

select * from finish();
rollback;
