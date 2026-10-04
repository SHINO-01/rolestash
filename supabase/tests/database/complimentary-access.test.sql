begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, aud, role)
  values ('77777777-7777-4777-8777-777777777777', 'dana@example.com', 'authenticated', 'authenticated');

-- Grant complimentary Advanced the way the runbook does.
update public.entitlements
   set status = 'active', tier = 'advanced', trial_ends_at = null,
       current_period_end = '9999-12-31T00:00:00Z', complimentary = 'owner'
 where user_id = '77777777-7777-4777-8777-777777777777';

set local role authenticated;
set local request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';
select is(public.plan_tier(), 'advanced', 'a complimentary account is on Advanced');
select ok(public.has_pro(), '…and has paid access');
select is((select complimentary from public.entitlements), 'owner', 'the owner can see the grant');
reset role;

select ok(
  not public.apply_billing_event('77777777-7777-4777-8777-777777777777', now(), 'canceled', now(),
    'month', 'paddle', 'ctm_9', 'sub_9', 'pro'),
  'a billing event does not apply to a complimentary account');
select is(
  (select row(status::text, tier, current_period_end, provider)::text
     from public.entitlements where user_id = '77777777-7777-4777-8777-777777777777'),
  '(active,advanced,"9999-12-31 00:00:00+00",)', '…and the grant is unchanged');

set local role authenticated;
set local request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';
select throws_ok(
  $$update public.entitlements set complimentary = 'me', tier = 'advanced'$$,
  '42501', null, 'users cannot grant themselves access');
reset role;

select * from finish();
rollback;
