begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- Kim has an authenticator; Lee doesn't.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-2222-4aaa-8aaa-111111111111', 'kim@example.com', 'authenticated', 'authenticated'),
  ('bbbbbbbb-2222-4aaa-8aaa-111111111111', 'lee@example.com', 'authenticated', 'authenticated');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (gen_random_uuid(), 'aaaaaaaa-2222-4aaa-8aaa-111111111111', 'Authenticator app', 'totp',
          'verified', now(), now(), 'JBSWY3DPEHPK3PXP');
insert into auth.sessions (id, user_id, created_at, updated_at)
  values (gen_random_uuid(), 'aaaaaaaa-2222-4aaa-8aaa-111111111111', now(), now());
insert into private.ops_admin_secret (sha256)
  values (extensions.digest(convert_to('ops-admin-test-secret', 'UTF8'), 'sha256'));

set local request.jwt.claims to '{"sub":"aaaaaaaa-2222-4aaa-8aaa-111111111111","role":"authenticated","aal":"aal1"}';
select throws_ok($$select public.require_two_step()$$, '42501', 'Two-step sign-in needed',
  'a session without the second step is refused once the account has an authenticator');
set local request.jwt.claims to '{"sub":"aaaaaaaa-2222-4aaa-8aaa-111111111111","role":"authenticated","aal":"aal2"}';
select lives_ok($$select public.require_two_step()$$, 'with the second step it goes through');
set local request.jwt.claims to '{"sub":"bbbbbbbb-2222-4aaa-8aaa-111111111111","role":"authenticated","aal":"aal1"}';
select lives_ok($$select public.require_two_step()$$, 'accounts without an authenticator are unaffected');
set local request.jwt.claims to '{"role":"anon"}';
select lives_ok($$select public.require_two_step()$$, 'signed-out calls are unaffected');
reset request.jwt.claims;

select is((select rolconfig @> array['pgrst.db_pre_request=public.require_two_step']
             from pg_roles where rolname = 'authenticator'), true, 'the API runs it before every request');

select is(public.ops_admin('ops-admin-test-secret', 'owner@example.com', 'accounts.two_step',
  '{"email":"kim@example.com"}')->>'authenticators', '1', 'the dashboard sees the authenticator');
select is(public.ops_admin('ops-admin-test-secret', 'owner@example.com', 'accounts.two_step_off',
  '{"email":"kim@example.com"}')->>'outcome', 'removed', 'support turns it off');
select is((select count(*)::int from auth.mfa_factors f join auth.sessions s using (user_id)
            where f.user_id = 'aaaaaaaa-2222-4aaa-8aaa-111111111111')
          + (select count(*)::int from auth.sessions where user_id = 'aaaaaaaa-2222-4aaa-8aaa-111111111111'),
          0, 'authenticators and sessions are gone');
select throws_ok($$select public.ops_admin('ops-admin-test-secret', 'o', 'accounts.two_step_off', '{"email":"nobody@example.com"}')$$,
  'P0001', 'No account for nobody@example.com', 'an unknown email is refused');

select * from finish();
rollback;
