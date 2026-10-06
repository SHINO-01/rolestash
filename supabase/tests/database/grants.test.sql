begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- Three accounts: Erin (Free, trial over), Finn (a paying subscriber), and a
-- Gmail address that will sign up later.
insert into auth.users (id, email, aud, role) values
  ('a1111111-1111-4111-8111-111111111111', 'erin@example.com', 'authenticated', 'authenticated'),
  ('b2222222-2222-4222-8222-222222222222', 'finn@example.com', 'authenticated', 'authenticated');
update public.entitlements set status = 'expired', trial_ends_at = now() - interval '1 day'
 where user_id = 'a1111111-1111-4111-8111-111111111111';
select public.apply_billing_event('b2222222-2222-4222-8222-222222222222', now() - interval '1 hour',
  'active', now() + interval '20 days', 'month', 'paddle', 'ctm_f', 'sub_f', 'advanced');

-- Granting -------------------------------------------------------------------
select is(private.grant_access('Erin@Example.com', 'tester', null, 'Beta tester', 'owner'),
  'granted', 'a grant applies at once to an existing account, whatever the case of the email');
select is(
  (select row(status::text, tier, current_period_end, complimentary)::text
     from public.entitlements where user_id = 'a1111111-1111-4111-8111-111111111111'),
  '(active,advanced,"9999-12-31 00:00:00+00",tester)', 'an indefinite grant is the ADR-0025 shape');
select is((select count(*)::int from private.list_grants() where email = 'erin@example.com'), 1,
  'the grant is listed with the account''s email');

select throws_ok($$select private.grant_access('erin@example.com', 'friend', null, null, 'owner')$$,
  '23514', null, 'only the known reasons are accepted');
select throws_ok($$select private.grant_access('erin@example.com', 'team', now() - interval '1 day', null, 'owner')$$,
  'P0001', 'The end date must be in the future', 'an end date in the past is refused');
select throws_ok($$select private.grant_access('not an email', 'team', null, null, 'owner')$$,
  'P0001', null, 'a non-email is refused');

-- Revoking back to Free -------------------------------------------------------
select is(private.revoke_access('erin@example.com', 'Beta over', 'owner'), 'revoked', 'revoking says so');
select is(
  (select row(status::text, complimentary)::text from public.entitlements
    where user_id = 'a1111111-1111-4111-8111-111111111111'),
  '(expired,)', 'without a grant the account is back where it was: Free');
select is((select state from private.list_grants(true) where email = 'erin@example.com'), 'revoked',
  'the log keeps the revoked grant');
select is(private.revoke_access('erin@example.com', null, 'owner'), 'none', 'nothing left to revoke');

-- A dated grant over a subscription, a billing event during it, then revoke ------
select is(private.grant_access('finn@example.com', 'partner', now() + interval '60 days', null, 'owner'),
  'granted', 'a dated grant over a live subscription');
select ok(
  (select current_period_end > now() + interval '59 days' and complimentary = 'partner'
     from public.entitlements where user_id = 'b2222222-2222-4222-8222-222222222222'),
  'the entitlement runs to the grant''s end');
select ok(
  not public.apply_billing_event('b2222222-2222-4222-8222-222222222222', now(), 'canceled',
    now() + interval '19 days', 'month', 'paddle', 'ctm_f', 'sub_f', 'advanced'),
  'a billing event during the grant leaves the entitlement alone');
select is((select status::text from private.billing_shadow where user_id = 'b2222222-2222-4222-8222-222222222222'),
  'canceled', '…but is kept for when the grant ends');
select is(private.grant_access('finn@example.com', 'team', null, 'Joined the team', 'owner'), 'granted',
  'a new grant replaces the current one');
select is((select count(*)::int from private.list_grants() where email = 'finn@example.com'), 1,
  'only the new grant is active');
select private.revoke_access('finn@example.com', null, 'owner');
select is(
  (select row(status::text, provider_subscription_id, complimentary)::text from public.entitlements
    where user_id = 'b2222222-2222-4222-8222-222222222222'),
  '(canceled,sub_f,)', 'revoking returns the account to its real subscription, as Paddle last said');

-- Pending by email, applied at sign-up --------------------------------------------
select is(private.grant_access('Gale.Hart+jobs@googlemail.com', 'team', now() + interval '30 days', null, 'owner'),
  'pending', 'a grant for an email with no account waits');
select is((select email from private.list_grants() where state = 'pending'), 'ga…@googlemail.com',
  'a pending grant shows only a hint of the email');
insert into auth.users (id, email, aud, role)
  values ('c3333333-3333-4333-8333-333333333333', 'galehart@gmail.com', 'authenticated', 'authenticated');
select is((select complimentary from public.entitlements where user_id = 'c3333333-3333-4333-8333-333333333333'),
  'team', 'it applies when the same mailbox signs up, aliases and all');

-- Expiry -------------------------------------------------------------------------
update private.grants set expires_at = now() - interval '1 minute'
 where user_id = 'c3333333-3333-4333-8333-333333333333' and revoked_at is null;
select is(private.expire_grants(), 1, 'the daily job ends grants past their date');
select is((select row(status::text, complimentary)::text from public.entitlements
            where user_id = 'c3333333-3333-4333-8333-333333333333'),
  '(trialing,)', '…and the account returns to its trial');

-- Clients can't reach any of it ---------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$select private.grant_access('erin@example.com', 'team', null, null, 'me')$$,
  '42501', null, 'a signed-in user cannot grant');
reset role;

select * from finish();
rollback;
