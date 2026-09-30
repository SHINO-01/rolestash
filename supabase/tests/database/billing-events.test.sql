begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email, aud, role)
  values ('55555555-5555-4555-8555-555555555555', 'carol@example.com', 'authenticated', 'authenticated');

create function pg_temp.apply(at timestamptz, s public.entitlement_status, period_end timestamptz, t text default 'pro')
returns boolean language sql as $$
  select public.apply_billing_event(
    '55555555-5555-4555-8555-555555555555', at, s, period_end, 'month', 'paddle', 'ctm_1', 'sub_1', t);
$$;

select ok(pg_temp.apply('2026-10-01T00:00:00Z', 'active', '2026-11-01T00:00:00Z'), 'a new event is applied');
select is(
  (select row(status::text, billing_interval, provider, provider_customer_id, provider_subscription_id)::text
     from public.entitlements where user_id = '55555555-5555-4555-8555-555555555555'),
  '(active,month,paddle,ctm_1,sub_1)', 'status and billing ids are stored');

select ok(not pg_temp.apply('2026-09-30T00:00:00Z', 'canceled', '2026-09-30T00:00:00Z'),
  'an older event is ignored');
select is(
  (select status::text from public.entitlements where user_id = '55555555-5555-4555-8555-555555555555'),
  'active', '…and does not change the entitlement');
select ok(not pg_temp.apply('2026-10-01T00:00:00Z', 'canceled', '2026-10-01T00:00:00Z'),
  'a duplicate delivery (same time) is ignored');

select ok(pg_temp.apply('2026-10-20T00:00:00Z', 'canceled', '2026-11-01T00:00:00Z'), 'a newer event wins');
select is(
  (select last_event_at from public.entitlements where user_id = '55555555-5555-4555-8555-555555555555'),
  '2026-10-20T00:00:00Z'::timestamptz, 'last_event_at tracks the newest event');

select ok(
  not public.apply_billing_event('66666666-6666-4666-8666-666666666666', now(), 'active', now(), null, 'paddle', null, null, 'pro'),
  'an unknown user is a no-op');

select ok(pg_temp.apply('2026-10-25T00:00:00Z', 'active', '2026-11-25T00:00:00Z', 'advanced'), 'an upgrade applies');
select is((select tier from public.entitlements where user_id = '55555555-5555-4555-8555-555555555555'),
  'advanced', 'the tier follows the subscription');
select throws_ok(
  $$select pg_temp.apply('2026-10-26T00:00:00Z', 'active', '2026-11-26T00:00:00Z', 'platinum')$$,
  '23514', null, 'unknown tiers are rejected');

set local role authenticated;
select throws_ok(
  $$select public.apply_billing_event('55555555-5555-4555-8555-555555555555', now(), 'active', now() + interval '1 year', 'year', 'paddle', null, null, 'advanced')$$,
  '42501', null, 'clients cannot apply billing events');
reset role;

select * from finish();
rollback;
