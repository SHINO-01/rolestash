-- Run with: npm run test:db  (needs Docker; see docs/guides/backend.md)
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create function pg_temp.act_as_anon() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create function pg_temp.act_as_admin() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

-- Signing up ------------------------------------------------------------------
select is((select send from public.launch_signup('  Alice@Example.com ', 'pro')), true,
  'a new address gets a confirmation email');
select is((select email || ':' || plan from public.launch_subscribers), 'alice@example.com:pro',
  'the address is stored normalised, with the plan');
select is((select send from public.launch_signup('alice@example.com', null)), false,
  'no second confirmation within 10 minutes');
select is((select plan from public.launch_subscribers where email = 'alice@example.com'), 'pro',
  'a signup without a plan keeps the earlier plan');

update public.launch_subscribers set last_confirmation_at = now() - interval '11 minutes';
select is((select send from public.launch_signup('alice@example.com', 'advanced')), true,
  'a repeat after 10 minutes resends the confirmation');
update public.launch_subscribers set last_confirmation_at = now() - interval '11 minutes';
select is((select send from public.launch_signup('alice@example.com', null)), true, 'third send');
update public.launch_subscribers set last_confirmation_at = now() - interval '11 minutes';
select is((select send from public.launch_signup('alice@example.com', null)), false,
  'never more than 3 confirmation emails per address');
select is((select send from public.launch_signup('bogus plan@example.com', 'gold')), true,
  'an unknown plan is ignored rather than rejected');
select is((select plan from public.launch_subscribers where email = 'bogus plan@example.com'), null,
  'and stored as no plan');

-- Global hourly cap -------------------------------------------------------------
insert into public.launch_subscribers (email, confirmations_sent, last_confirmation_at)
  select 'flood' || i || '@example.com', 1, now() from generate_series(1, 30) i;
select is((select send from public.launch_signup('late@example.com', null)), false,
  'at most 30 confirmation emails per hour in total');
delete from public.launch_subscribers where email like 'flood%' or email = 'late@example.com';

-- Confirming --------------------------------------------------------------------
select is(
  (select newly from public.launch_confirm(
    (select token from public.launch_subscribers where email = 'alice@example.com'))),
  true, 'the first click confirms');
select is(
  (select newly from public.launch_confirm(
    (select token from public.launch_subscribers where email = 'alice@example.com'))),
  false, 'a second click is harmless and says so');
select is((select count(*)::int from public.launch_confirm(gen_random_uuid())), 0,
  'an unknown token confirms nothing');
select is((select send from public.launch_signup('alice@example.com', 'free')), false,
  'a confirmed address never gets another confirmation');
select is((select plan from public.launch_subscribers where email = 'alice@example.com'), 'free',
  'but its plan interest updates');

-- Forgetting --------------------------------------------------------------------
update public.launch_subscribers set created_at = now() - interval '31 days'
  where email = 'bogus plan@example.com';
select public.launch_signup('someone@example.com', null);
select is((select count(*)::int from public.launch_subscribers where email = 'bogus plan@example.com'),
  0, 'unconfirmed signups are forgotten after 30 days');
select is(public.launch_unsubscribe(
  (select token from public.launch_subscribers where email = 'alice@example.com')), true,
  'unsubscribing deletes the address');
select is(public.launch_unsubscribe(gen_random_uuid()), false, 'an unknown token deletes nothing');

-- Clients have no access ----------------------------------------------------------
select pg_temp.act_as_anon();
select throws_ok($$select * from public.launch_subscribers$$, '42501', null,
  'anon cannot read the list');
select pg_temp.act_as_admin();

select * from finish();
rollback;
