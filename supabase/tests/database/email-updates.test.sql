-- Run with: npm run test:db  (needs Docker; see docs/guides/backend.md)
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.act_as_anon() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create function pg_temp.act_as_admin() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.event(p_message text, p_intent text default 'rejected') returns jsonb language sql as $$
  select jsonb_build_object(
    'intent', p_intent, 'action', 'apply', 'subject', 'Your application',
    'receivedAt', '2026-10-01T00:00:00Z',
    'thread', jsonb_build_object('messageId', p_message, 'references', '[]'::jsonb));
$$;

-- New sign-ups start a Pro trial; make one Advanced.
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'adv@example.com', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'pro@example.com', 'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', 'adv2@example.com', 'authenticated', 'authenticated');
update public.entitlements set tier = 'advanced', status = 'active', current_period_end = now() + interval '20 days'
  where user_id in ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
insert into private.email_ingest_secret (sha256)
  values (extensions.digest(convert_to('test-ingest-secret', 'UTF8'), 'sha256'));

-- The address --------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is((public.my_inbox()->>'ok')::boolean, true, 'Advanced gets an address');
select matches(public.my_inbox()->>'address', '^[a-km-np-z2-9]{20}@in\.rolestash\.com$',
  'a 20-character token at in.rolestash.com');
select is(public.my_inbox()->>'address', public.my_inbox()->>'address', 'the same address every time');
create temp table first_address as select public.my_inbox()->>'address' as address;
grant select on first_address to authenticated, anon;
select isnt(public.rotate_inbox()->>'address', (select address from first_address), 'rotating gives a new address');
select isnt(public.my_inbox()->>'rotated_at', null, 'and records when');
select throws_ok($$select * from public.email_inboxes$$, '42501', null, 'tokens are not readable directly');
select throws_ok($$select public.ingest_email_event('test-ingest-secret', 'x', '{}'::jsonb)$$, '42501', null,
  'signed-in users cannot ingest');

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is(public.my_inbox(), '{"ok": false, "reason": "plan_required"}'::jsonb, 'Pro has no address');
select is(public.rotate_inbox(), '{"ok": false, "reason": "plan_required"}'::jsonb, 'nor can rotate one');

select pg_temp.act_as_anon();
select throws_ok($$select public.my_inbox()$$, '42501', null, 'anon has no inbox');
select throws_ok($$select * from public.email_events$$, '42501', null, 'anon reads no events');

-- Ingest ---------------------------------------------------------------------------
select pg_temp.act_as_admin();
create temp table tokens as
  select user_id, address_token from public.email_inboxes;
grant select on tokens to anon, authenticated;
select pg_temp.act_as_anon();

select throws_ok($$select public.ingest_email_event('wrong', 'x', '{}'::jsonb)$$, '42501', null,
  'a wrong secret is refused');
select throws_ok($$select public.ingest_email_event(null, 'x', '{}'::jsonb)$$, '42501', null,
  'a missing secret is refused');
select is(public.ingest_email_event('test-ingest-secret', split_part((select address from first_address), '@', 1),
  pg_temp.event('<m0>')), '{"ok": false, "reason": "unknown_address"}'::jsonb, 'mail to a rotated address is dropped');
select is(public.ingest_email_event('test-ingest-secret', 'nosuchtokennosuchtok', pg_temp.event('<m0>')),
  '{"ok": false, "reason": "unknown_address"}'::jsonb, 'mail to an unknown address is dropped');

select is(public.ingest_email_event('test-ingest-secret',
  upper((select address_token from tokens where user_id = '11111111-1111-4111-8111-111111111111')),
  pg_temp.event('<m1>')), '{"ok": true, "stored": true}'::jsonb, 'an event is stored (address case-insensitive)');
select is(public.ingest_email_event('test-ingest-secret',
  (select address_token from tokens where user_id = '11111111-1111-4111-8111-111111111111'),
  pg_temp.event('<m1>')), '{"ok": true, "stored": false}'::jsonb, 'the same message is stored once');
select throws_ok($$select public.ingest_email_event('test-ingest-secret',
  (select address_token from tokens where user_id = '11111111-1111-4111-8111-111111111111'),
  '{"intent": "maybe"}'::jsonb)$$, '23514', null, 'an unknown intent is refused');

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.email_events), 1, 'the owner reads their event');
select is((select event->>'intent' from public.email_events), 'rejected', 'as extracted');

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select is((select count(*)::int from public.email_events), 0, 'other users read none');
with d as (delete from public.email_events returning 1)
select is((select count(*)::int from d), 0, 'and cannot delete them');

-- Rate limits and retention -----------------------------------------------------------
select pg_temp.act_as_admin();
insert into public.email_events (user_id, intent, event, received_at)
  select '11111111-1111-4111-8111-111111111111', 'other', '{}'::jsonb, now() from generate_series(1, 29);
insert into public.email_events (user_id, intent, event, received_at, created_at)
  values ('11111111-1111-4111-8111-111111111111', 'other', '{}'::jsonb, now(), now() - interval '91 days');
select pg_temp.act_as_anon();
select is(public.ingest_email_event('test-ingest-secret',
  (select address_token from tokens where user_id = '11111111-1111-4111-8111-111111111111'),
  pg_temp.event('<m2>')), '{"ok": false, "reason": "rate_limited"}'::jsonb, 'at most 30 events an hour per address');

select pg_temp.act_as_admin();
update public.email_events set created_at = now() - interval '2 hours'
  where user_id = '11111111-1111-4111-8111-111111111111' and created_at > now() - interval '1 hour';
select pg_temp.act_as_anon();
select is(public.ingest_email_event('test-ingest-secret',
  (select address_token from tokens where user_id = '11111111-1111-4111-8111-111111111111'),
  pg_temp.event('<m3>')), '{"ok": true, "stored": true}'::jsonb, 'the hourly limit resets');
select pg_temp.act_as_admin();
select is((select count(*)::int from public.email_events where created_at < now() - interval '90 days'), 0,
  'events older than 90 days are deleted');
select is((select count(*)::int from cron.job where jobname = 'email-events-retention'), 1,
  'and a daily job deletes them for quiet inboxes too');

-- Lapsed plans ----------------------------------------------------------------------
update public.entitlements set status = 'expired' where user_id = '33333333-3333-4333-8333-333333333333';
insert into public.email_inboxes (user_id, address_token) values ('33333333-3333-4333-8333-333333333333', 'abcdefghijkmnpqrstuv');
select pg_temp.act_as_anon();
select is(public.ingest_email_event('test-ingest-secret', 'abcdefghijkmnpqrstuv', pg_temp.event('<m4>')),
  '{"ok": false, "reason": "not_advanced"}'::jsonb, 'mail for a lapsed account is dropped');
select pg_temp.act_as_admin();
select isnt((select paused_at from public.email_inboxes where user_id = '33333333-3333-4333-8333-333333333333'),
  null, 'and the inbox is marked paused, to tell the user once');
select is(private.plan_tier_of('22222222-2222-4222-8222-222222222222'), 'pro', 'plan_tier_of reads any user');

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
delete from public.email_events where intent = 'rejected';
select is((select count(*)::int from public.email_events where intent = 'rejected'), 0, 'owners can delete events');

select pg_temp.act_as_admin();
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is((select count(*)::int from public.email_events where user_id = '11111111-1111-4111-8111-111111111111')
  + (select count(*)::int from public.email_inboxes where user_id = '11111111-1111-4111-8111-111111111111'), 0,
  'deleting the account deletes its address and events');

select * from finish();
rollback;
