-- Run with: npm run test:db  (needs Docker; see docs/guides/backend.md)
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Helpers: act as a signed-in user, or as nobody.
create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.act_as_anon() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create function pg_temp.act_as_admin() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.com', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.com', 'authenticated', 'authenticated');

-- Sign-up starts a 30-day trial ----------------------------------------------
select is(
  (select status::text from public.entitlements where user_id = '11111111-1111-4111-8111-111111111111'),
  'trialing', 'a new account starts on the trial');
select ok(
  (select trial_ends_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 minute'
     from public.entitlements where user_id = '11111111-1111-4111-8111-111111111111'),
  'the trial lasts 30 days');
select is((select count(*)::int from public.trial_claims), 2, 'each sign-up records a trial claim');
select ok(
  not exists (select 1 from public.trial_claims where email_sha256 like '%@%' or length(email_sha256) <> 64),
  'trial claims hold SHA-256 hashes, never email addresses');

-- One trial per email, even after deleting the account -----------------------
delete from auth.users where id = '22222222-2222-4222-8222-222222222222';
select is(
  (select count(*)::int from public.entitlements where user_id = '22222222-2222-4222-8222-222222222222'),
  0, 'deleting an account deletes its entitlement');
insert into auth.users (id, email, aud, role)
  values ('33333333-3333-4333-8333-333333333333', '  BOB@Example.com ', 'authenticated', 'authenticated');
select is(
  (select status::text from public.entitlements where user_id = '33333333-3333-4333-8333-333333333333'),
  'expired', 'the same email (any case/spacing) gets no second trial');

-- Row Level Security -------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.entitlements), 1, 'a user sees only their own entitlement');
select is(
  (select user_id from public.entitlements),
  '11111111-1111-4111-8111-111111111111'::uuid, '…and it is theirs');
select throws_ok(
  $$update public.entitlements set status = 'active', current_period_end = now() + interval '1 year'$$,
  '42501', null, 'a user cannot upgrade themselves');
select throws_ok(
  $$insert into public.entitlements (user_id, status) values ('44444444-4444-4444-8444-444444444444', 'active')$$,
  '42501', null, 'a user cannot create entitlements');
select throws_ok($$delete from public.entitlements$$, '42501', null, 'a user cannot delete entitlements');
select throws_ok($$select * from public.trial_claims$$, '42501', null, 'users cannot read trial claims');
select ok(public.has_pro(), 'a trialing user has Pro');

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select ok(not public.has_pro(), 'a user without a trial or subscription does not');

select pg_temp.act_as_anon();
select throws_ok($$select * from public.entitlements$$, '42501', null, 'signed-out clients read nothing');
select throws_ok($$select public.has_pro()$$, '42501', null, 'signed-out clients cannot call has_pro');

-- has_pro() matches planOf() in src/domain/plan.ts ------------------------------
create function pg_temp.pro_when(s public.entitlement_status, trial interval, period interval)
returns boolean language plpgsql as $$
begin
  perform pg_temp.act_as_admin();
  update public.entitlements
     set status = s, trial_ends_at = now() + trial, current_period_end = now() + period
   where user_id = '11111111-1111-4111-8111-111111111111';
  perform pg_temp.act_as('11111111-1111-4111-8111-111111111111');
  return public.has_pro();
end;
$$;

select ok(not pg_temp.pro_when('trialing', '-1 minute', null), 'trial over → Free');
select ok(pg_temp.pro_when('active', null, '10 days'), 'active subscription → Pro');
select ok(pg_temp.pro_when('past_due', null, '-2 days'), 'renewal leeway: 2 days past period end → Pro');
select ok(not pg_temp.pro_when('active', null, '-4 days'), 'beyond the 3-day leeway → Free');
select ok(pg_temp.pro_when('canceled', null, '5 days'), 'canceled keeps Pro until period end');
select ok(not pg_temp.pro_when('canceled', null, '-1 minute'), '…then Free');
select ok(not pg_temp.pro_when('paused', null, '30 days'), 'paused → Free');

select pg_temp.act_as_admin();
select ok(
  (select updated_at >= created_at from public.entitlements where user_id = '11111111-1111-4111-8111-111111111111'),
  'updated_at is maintained');

select * from finish();
rollback;
