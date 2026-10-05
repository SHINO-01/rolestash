-- Run with: npm run test:db  (needs Docker; see docs/guides/backend.md)
-- One paid plan (ADR-0029): every new or migrated paid row is the full tier.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'entitlements' and column_name = 'tier'),
  '''advanced''::text', 'a new entitlement defaults to the full plan');

insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.com', 'authenticated', 'authenticated');
select is(
  (select tier from public.entitlements where user_id = '11111111-1111-4111-8111-111111111111'),
  'advanced', 'a sign-up trial is of the full plan');
select ok(
  not exists (select 1 from public.entitlements where tier = 'pro'),
  'no entitlement is left on the old Pro tier');

select * from finish();
rollback;
