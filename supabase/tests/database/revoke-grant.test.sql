begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- Erin has an account; Gail hasn't signed up yet.
insert into auth.users (id, email, aud, role) values
  ('c3333333-3333-4333-8333-333333333333', 'erin@example.com', 'authenticated', 'authenticated');
insert into private.ops_admin_secret (sha256)
  values (extensions.digest(convert_to('ops-admin-test-secret', 'UTF8'), 'sha256'));

create function pg_temp.admin(p_action text, p_args jsonb) returns jsonb language sql as $$
  select public.ops_admin('ops-admin-test-secret', 'owner@example.com', p_action, p_args) $$;

select private.grant_access('gail@gmail.com', 'tester', null, 'Test mail', 'owner');
select private.grant_access('erin@example.com', 'partner', null, null, 'owner');

create temp table ids as
  select (select id from private.grants where user_id is null) as pending,
         (select id from private.grants where user_id = 'c3333333-3333-4333-8333-333333333333') as active;

select is(pg_temp.admin('grants.get', jsonb_build_object('id', (select pending from ids)))->>'email',
  'ga…@gmail.com', 'a pending grant is found by id, showing only its email hint');

select is(pg_temp.admin('grants.revoke_id', jsonb_build_object('id', (select pending from ids)))->>'outcome',
  'revoked', 'a pending grant is revoked by id');
select is(pg_temp.admin('grants.get', jsonb_build_object('id', (select pending from ids)))->>'state',
  'revoked', 'and stays in the log as revoked');
select is((select count(*)::int from private.ops_audit where action = 'grants.revoke_id'), 1,
  'the revoke is logged');

-- Gail signs up later: the revoked grant must not apply.
insert into auth.users (id, email, aud, role) values
  ('d4444444-4444-4444-8444-444444444444', 'gail@gmail.com', 'authenticated', 'authenticated');
select is((select complimentary from public.entitlements where user_id = 'd4444444-4444-4444-8444-444444444444'),
  null, 'a revoked pending grant gives nothing at sign-up');

select is((select complimentary from public.entitlements where user_id = 'c3333333-3333-4333-8333-333333333333'),
  'partner', 'Erin has Pro from her grant');
select is(private.revoke_grant((select active from ids), 'done', 'owner'), 'revoked',
  'an account''s grant is revoked by id too');
select is((select complimentary from public.entitlements where user_id = 'c3333333-3333-4333-8333-333333333333'),
  null, 'and the account''s own plan comes back');

select is(private.revoke_grant((select active from ids), null, 'owner'), 'none',
  'revoking it again changes nothing');

select * from finish();
rollback;
