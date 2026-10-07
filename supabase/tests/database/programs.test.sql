begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- Rita refers; Sam (new) subscribes through her code; Rita pays monthly herself.
-- Tom is on Free and refers Uma. Val tries her own code.
insert into auth.users (id, email, aud, role) values
  ('11111111-aaaa-4aaa-8aaa-111111111111', 'rita@example.com', 'authenticated', 'authenticated'),
  ('22222222-aaaa-4aaa-8aaa-222222222222', 'sam@example.com', 'authenticated', 'authenticated'),
  ('33333333-aaaa-4aaa-8aaa-333333333333', 'tom@example.com', 'authenticated', 'authenticated'),
  ('44444444-aaaa-4aaa-8aaa-444444444444', 'uma@example.com', 'authenticated', 'authenticated'),
  ('55555555-aaaa-4aaa-8aaa-555555555555', 'val@example.com', 'authenticated', 'authenticated');
select public.apply_billing_event('11111111-aaaa-4aaa-8aaa-111111111111', now() - interval '1 day',
  'active', now() + interval '20 days', 'month', 'paddle', 'ctm_rita', 'sub_rita', 'advanced');
update public.entitlements set status = 'expired', trial_ends_at = now() - interval '1 day'
 where user_id = '33333333-aaaa-4aaa-8aaa-333333333333';

-- The dashboard's secret.
insert into private.ops_admin_secret (sha256)
  values (extensions.digest(convert_to('ops-admin-test-secret', 'UTF8'), 'sha256'));

-- Codes ------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-aaaa-4aaa-8aaa-111111111111","role":"authenticated"}';
select is(public.my_referral(), '{"enabled": false}'::jsonb, 'no codes while the programme is off');
reset role;

select is(public.ops_admin('ops-admin-test-secret', 'owner@example.com', 'settings.set',
  '{"key":"referrals_enabled","value":true}'), '{"outcome":"saved"}'::jsonb, 'the dashboard turns it on');
select throws_ok($$select public.ops_admin('ops-admin-test-secret', 'o', 'settings.set', '{"key":"referral_percent","value":150}')$$,
  'P0001', 'The referral percent is a whole number from 1 to 100', 'a percent over 100 is refused');
select throws_ok($$select public.ops_admin('ops-admin-test-secret', 'o', 'settings.set', '{"key":"referral_discount_id","value":"LAUNCH"}')$$,
  'P0001', null, 'the referral discount must be a Paddle id');
select public.ops_admin('ops-admin-test-secret', 'owner@example.com', 'settings.set',
  '{"key":"referral_discount_id","value":"dsc_01abcdefghijk"}');

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-aaaa-4aaa-8aaa-111111111111","role":"authenticated"}';
select matches(public.my_referral()->>'code', '^[2-9A-HJ-NP-Z]{8}$', 'an account gets an 8-character code');
select is(public.my_referral()->>'code', (select public.my_referral()->>'code'), 'the same code each time');
select is((public.my_referral()->>'percent')::int, 50, '…and sees the friend''s discount');
reset role;
create temp table rita as select code from private.referral_codes where user_id = '11111111-aaaa-4aaa-8aaa-111111111111';

set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-aaaa-4aaa-8aaa-333333333333","role":"authenticated"}';
select ok(public.my_referral() ? 'code', 'Tom gets a code too');
reset role;
create temp table tom as select code from private.referral_codes where user_id = '33333333-aaaa-4aaa-8aaa-333333333333';

-- Checkout ---------------------------------------------------------------------------
select is(public.checkout_code('22222222-aaaa-4aaa-8aaa-222222222222', lower((select code from rita)))->>'eligible',
  'true', 'a friend''s first purchase can use the code, in any case');
select is(public.checkout_code('22222222-aaaa-4aaa-8aaa-222222222222', (select code from rita))->>'discount_id',
  'dsc_01abcdefghijk', '…with the referral discount');
select is(public.checkout_code('11111111-aaaa-4aaa-8aaa-111111111111', (select code from rita))->>'reason',
  'own_code', 'nobody can use their own code');
select is(public.checkout_code('22222222-aaaa-4aaa-8aaa-222222222222', 'LAUNCH30')->>'kind', 'unknown',
  'anything else is left to Paddle');
select is(public.checkout_code('11111111-aaaa-4aaa-8aaa-111111111111', (select code from tom))->>'reason',
  'not_first_purchase', 'an account that already pays can''t use someone''s referral');

-- Recording (the webhook) --------------------------------------------------------------
select is(public.record_referral((select code from rita), '22222222-aaaa-4aaa-8aaa-222222222222', 'txn_sam', 'sub_sam', 'ctm_sam'),
  'recorded', 'Sam''s subscription is recorded');
select is(public.record_referral((select code from rita), '22222222-aaaa-4aaa-8aaa-222222222222', 'txn_sam', 'sub_sam', 'ctm_sam'),
  'duplicate', 'a second event for Sam changes nothing');
select is(public.record_referral((select code from rita), '55555555-aaaa-4aaa-8aaa-555555555555', 'txn_val', 'sub_val', 'ctm_rita'),
  'void:same Paddle customer as the referrer', 'the referrer''s own Paddle customer is a self-referral');
select is(public.record_referral((select code from tom), '44444444-aaaa-4aaa-8aaa-444444444444', 'txn_uma', 'sub_uma', 'ctm_uma'),
  'recorded', 'Uma through Tom');
select is(public.checkout_code('22222222-aaaa-4aaa-8aaa-222222222222', (select code from tom))->>'reason',
  'not_first_purchase', 'one referral per friend, ever');

-- Waiting out the refund window ------------------------------------------------------------
select is(public.ops_admin('ops-admin-test-secret', 'o', 'referrals.process', '{}')->>'qualified', '0',
  'nothing qualifies inside 14 days');
update private.referrals set created_at = now() - interval '15 days' where status = 'pending';
select is(public.void_referral('txn_nothing', 'refund'), 0, 'a refund of another payment voids nothing');

select is(public.ops_admin('ops-admin-test-secret', 'o', 'referrals.process', '{}'),
  '{"capped": 0, "granted": 1, "qualified": 2, "awaiting_paddle": 1}'::jsonb,
  'after 14 days both qualify: Tom gets a month now, Rita''s waits for Paddle');
select is((select row(complimentary, current_period_end > now() + interval '29 days')::text
             from public.entitlements where user_id = '33333333-aaaa-4aaa-8aaa-333333333333'),
  '(referral,t)', 'Tom (Free) gets a 30-day referral grant');
select is((select reason from private.grants where user_id = '33333333-aaaa-4aaa-8aaa-333333333333'),
  'referral', '…logged as a grant');
select is(public.ops_admin('ops-admin-test-secret', 'o', 'referrals.paddle_due', '{}'),
  jsonb_build_array(jsonb_build_object('id', (select id from private.referrals where transaction_id = 'txn_sam'),
                                       'subscription_id', 'sub_rita')),
  'Rita''s month is due in Paddle');
select is(public.void_referral('txn_sam', 'refund'), 0, 'a month already promised in Paddle isn''t voided');

select is(public.ops_admin('ops-admin-test-secret', 'owner@example.com', 'referrals.paddle_done',
  jsonb_build_object('id', (select id from private.referrals where transaction_id = 'txn_sam'), 'ok', true,
                     'detail', 'next bill moved')) ->> 'outcome', 'rewarded', 'the job reports the Paddle month done');
select is((select status from private.referrals where transaction_id = 'txn_sam'), 'rewarded', '…and it is rewarded');

-- A second friend of Tom's stacks another month on his referral grant.
insert into auth.users (id, email, aud, role)
  values ('66666666-aaaa-4aaa-8aaa-666666666666', 'wes@example.com', 'authenticated', 'authenticated');
select public.record_referral((select code from tom), '66666666-aaaa-4aaa-8aaa-666666666666', 'txn_wes', 'sub_wes', 'ctm_wes');
update private.referrals set created_at = now() - interval '15 days' where transaction_id = 'txn_wes';
select public.ops_admin('ops-admin-test-secret', 'o', 'referrals.process', '{}');
select ok((select current_period_end > now() + interval '59 days' from public.entitlements
            where user_id = '33333333-aaaa-4aaa-8aaa-333333333333'), 'a second month stacks on the first');

-- Refunds void pending referrals; the cap holds at 12 a year.
insert into auth.users (id, email, aud, role)
  values ('77777777-aaaa-4aaa-8aaa-777777777777', 'xan@example.com', 'authenticated', 'authenticated');
select public.record_referral((select code from tom), '77777777-aaaa-4aaa-8aaa-777777777777', 'txn_xan', 'sub_xan', 'ctm_xan');
select is(public.void_referral('txn_xan', 'Refunded'), 1, 'a refund inside the window voids the referral');
update private.referrals set status = 'rewarded', rewarded_at = now(), reward = 'grant_month'
 where transaction_id = 'txn_xan';
insert into private.referrals (referrer_id, code, friend_email_claim, status, reward, rewarded_at)
  select '33333333-aaaa-4aaa-8aaa-333333333333', (select code from tom), extensions.gen_random_bytes(32),
         'rewarded', 'grant_month', now() - interval '10 days'
    from generate_series(1, 10);
insert into private.referrals (referrer_id, code, friend_email_claim, status, created_at)
  values ('33333333-aaaa-4aaa-8aaa-333333333333', (select code from tom), extensions.gen_random_bytes(32),
          'pending', now() - interval '20 days');
select is(public.ops_admin('ops-admin-test-secret', 'o', 'referrals.process', '{}')->>'capped', '1',
  'the 13th reward in a year is capped');

-- The dashboard: grants, voids, the log, and the secret --------------------------------------
select is(public.ops_admin('ops-admin-test-secret', 'owner@example.com', 'grants.grant',
  '{"email":"val@example.com","reason":"partner","until":"2027-01-31","note":"Podcast"}')->>'outcome',
  'granted', 'grants from the dashboard');
select is((select granted_by from private.grants where note = 'Podcast'), 'owner@example.com',
  '…in the owner''s name');
select is((select to_char(expires_at at time zone 'Australia/Sydney', 'YYYY-MM-DD HH24:MI')
             from private.grants where note = 'Podcast'), '2027-01-31 23:59', '…to the end of the Sydney day');
select is(public.ops_admin('ops-admin-test-secret', 'owner@example.com', 'grants.preview',
  '{"email":"val@example.com"}')->>'complimentary', 'partner', 'the preview shows the current state');
select is(public.ops_admin('ops-admin-test-secret', 'owner@example.com', 'referrals.void',
  jsonb_build_object('id', (select id from private.referrals where transaction_id = 'txn_wes')))->>'outcome',
  'none', 'a rewarded referral can''t be voided');
select is((select count(*)::int from private.ops_audit where actor = 'owner@example.com'), 5,
  'every change is in the log with its actor');
select throws_ok($$select public.ops_admin('wrong', 'x', 'grants.list', '{}')$$, '42501', null,
  'a wrong secret gets nothing');

set local role anon;
select throws_ok($$select public.checkout_code('22222222-aaaa-4aaa-8aaa-222222222222', 'ABCDEFGH')$$, '42501', null,
  'clients cannot look codes up');
reset role;

select * from finish();
rollback;
