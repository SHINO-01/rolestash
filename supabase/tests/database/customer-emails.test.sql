begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Ann: trial ended, never paid. Ben: paying. Cal: paid before, now expired.
-- Dee: on a grant. Eve: trialing now.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-1111-4aaa-8aaa-111111111111', 'ann@example.com', 'authenticated', 'authenticated'),
  ('bbbbbbbb-1111-4aaa-8aaa-111111111111', 'ben@example.com', 'authenticated', 'authenticated'),
  ('cccccccc-1111-4aaa-8aaa-111111111111', 'cal@example.com', 'authenticated', 'authenticated'),
  ('dddddddd-1111-4aaa-8aaa-111111111111', 'dee@example.com', 'authenticated', 'authenticated'),
  ('eeeeeeee-1111-4aaa-8aaa-111111111111', 'eve@example.com', 'authenticated', 'authenticated');
update public.entitlements set status = 'expired', trial_ends_at = now() - interval '1 day'
 where user_id = 'aaaaaaaa-1111-4aaa-8aaa-111111111111';
select public.apply_billing_event('bbbbbbbb-1111-4aaa-8aaa-111111111111', now() - interval '1 day',
  'active', now() + interval '20 days', 'month', 'paddle', 'ctm_ben', 'sub_ben', 'pro');
select public.apply_billing_event('cccccccc-1111-4aaa-8aaa-111111111111', now() - interval '1 day',
  'expired', now() - interval '2 days', 'month', 'paddle', 'ctm_cal', 'sub_cal', 'pro');
update public.entitlements set trial_ends_at = now() + interval '10 days'
 where user_id = 'eeeeeeee-1111-4aaa-8aaa-111111111111';
insert into private.ops_admin_secret (sha256)
  values (extensions.digest(convert_to('ops-admin-test-secret', 'UTF8'), 'sha256'));
select public.ops_admin('ops-admin-test-secret', 'owner@example.com', 'grants.grant',
  '{"email":"dee@example.com","reason":"team"}');

create function pg_temp.who(p_segment text, p_emails text[] default '{}')
returns text language sql as $$
  select string_agg(split_part(email, '@', 1), ',' order by email)
    from private.audience(p_segment, p_emails);
$$;

select is(pg_temp.who('everyone'), 'ann,ben,cal,dee,eve', 'everyone');
select is(pg_temp.who('free'), 'ann,cal', 'free: not on Pro now');
select is(pg_temp.who('trial_ended'), 'ann', 'trial ended, never paid');
select is(pg_temp.who('lapsed'), 'cal', 'paid before');
select is(pg_temp.who('pro'), 'ben,dee,eve', 'on Pro: paying, granted, trialing');
select is(pg_temp.who('listed', '{ANN@example.com,nobody@example.com}'), 'ann', 'listed accounts only');
select throws_ok($$select * from private.audience('all', '{}')$$, 'P0001', 'Unknown audience all', 'unknown segment');

select is(public.ops_admin('ops-admin-test-secret', 'owner@example.com', 'audience.count',
  '{"segment":"listed","emails":["ann@example.com","nobody@example.com"]}')->>'unknown', '1',
  'counts listed emails without an account');

-- Claiming marks them, so a second offer this week skips them.
select is(jsonb_array_length(public.ops_admin('ops-admin-test-secret', 'owner@example.com',
  'audience.claim', '{"segment":"free"}')), 2, 'claims the free accounts');
select is(pg_temp.who('free'), null, 'no second offer within 7 days');
select is((select count(*)::int from private.ops_audit where action = 'email.recipients'), 1,
  'the claim is logged');

-- Unsubscribing.
update private.marketing_contacts set last_offer_at = now() - interval '8 days';
select ok(public.offers_unsubscribe((select token from private.marketing_contacts
  where user_id = 'aaaaaaaa-1111-4aaa-8aaa-111111111111')), 'the link opts out');
select ok(not public.offers_unsubscribe(gen_random_uuid()), 'an unknown token does nothing');
select is(pg_temp.who('free'), 'cal', 'opted-out accounts get no offers');
select is((public.ops_admin('ops-admin-test-secret', 'o', 'emails.summary', '{}')->>'opted_out')::int, 1,
  'the summary counts opt-outs');

set local role anon;
select throws_ok($$select public.offers_unsubscribe(gen_random_uuid())$$, '42501', null,
  'only the Edge Function can unsubscribe');
reset role;

select * from finish();
rollback;
