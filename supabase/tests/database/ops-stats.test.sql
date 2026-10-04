begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into private.ops_stats_secret (sha256)
  values (extensions.digest(convert_to('ops-test-secret', 'UTF8'), 'sha256'));
insert into auth.users (id, email, aud, role) values
  ('81111111-1111-4111-8111-111111111111', 'ana@example.com', 'authenticated', 'authenticated'),
  ('82222222-2222-4222-8222-222222222222', 'ben@example.com', 'authenticated', 'authenticated'),
  ('83333333-3333-4333-8333-333333333333', 'cy@example.com', 'authenticated', 'authenticated');
update public.entitlements set status = 'active', tier = 'pro', current_period_end = now() + interval '20 days'
  where user_id = '82222222-2222-4222-8222-222222222222';
update public.entitlements set status = 'active', tier = 'advanced', current_period_end = '9999-12-31',
  complimentary = 'owner' where user_id = '83333333-3333-4333-8333-333333333333';

set local role anon;
select throws_ok($$select public.ops_stats('wrong')$$, '42501', null, 'a wrong secret is refused');
select throws_ok($$select public.ops_stats(null)$$, '42501', null, 'no secret is refused');
select ok((public.ops_stats('ops-test-secret')->>'accounts')::int >= 3, 'counts accounts');
select is((public.ops_stats('ops-test-secret')->'paid'->>'pro')::int, 1, 'counts paying accounts by tier');
select is((public.ops_stats('ops-test-secret')->>'complimentary')::int, 1,
  'counts complimentary grants, not as paying');
select ok((public.ops_stats('ops-test-secret')->>'trials_active')::int >= 1, 'counts active trials');
reset role;

set local role authenticated;
select throws_ok($$select public.ops_stats('ops-test-secret')$$, '42501', null,
  'signed-in users cannot call it');
reset role;

select * from finish();
rollback;
