-- Run with: npm run test:db  (needs Docker; see docs/guides/backend.md)
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

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
create function pg_temp.uid(n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

-- Five Advanced users, one Pro user and one on the sign-up Advanced trial
-- (user 7); user 1 has an inbox for ingest tests.
insert into auth.users (id, email, aud, role)
  select pg_temp.uid(i), 'u' || i || '@example.com', 'authenticated', 'authenticated'
  from generate_series(1, 6) i;
-- Sign-ups start on an Advanced trial; these fixtures start as Pro, then set what they need.
update public.entitlements set tier = 'pro';
update public.entitlements set tier = 'advanced', status = 'active', current_period_end = now() + interval '20 days'
  where user_id in (select pg_temp.uid(i) from generate_series(1, 5) i);
insert into auth.users (id, email, aud, role)
  values (pg_temp.uid(7), 'u7@example.com', 'authenticated', 'authenticated');
insert into public.email_inboxes (user_id, address_token)
  values (pg_temp.uid(1), 'abcdefghijkmnpqrstuv');
insert into private.email_ingest_secret (sha256)
  values (extensions.digest(convert_to('test-ingest-secret', 'UTF8'), 'sha256'));
grant execute on function pg_temp.uid(int) to authenticated, anon;

create temp table t (name text primary key, hash text);
insert into t values
  ('receipt', repeat('a', 64)),
  ('contested', repeat('b', 64)),
  ('fresh', repeat('c', 64));
grant select on t to authenticated, anon;

create function pg_temp.vote(n int, kind text, key text, value text) returns jsonb language plpgsql as $$
begin
  perform pg_temp.act_as(pg_temp.uid(n));
  return public.vote_email_knowledge(jsonb_build_array(jsonb_build_object('kind', kind, 'key', key, 'value', value)));
end;
$$;

-- Voting rules ------------------------------------------------------------------------
select is(private.plan_tier_of(pg_temp.uid(7)), 'advanced', 'a trial counts as Advanced for its own features');
select is(pg_temp.vote(6, 'template', repeat('a', 64), 'received'),
  '{"ok": false, "reason": "plan_required"}'::jsonb, 'only Advanced accounts vote');
select is(pg_temp.vote(7, 'template', repeat('a', 64), 'received'),
  '{"ok": false, "reason": "plan_required"}'::jsonb, 'an Advanced trial doesn''t vote: only paying accounts do');
select is(pg_temp.vote(1, 'template', repeat('a', 64), 'received'),
  '{"ok": true, "recorded": 1}'::jsonb, 'Advanced votes are recorded');
select throws_ok($$select pg_temp.vote(1, 'template', 'not-a-hash', 'received')$$, '23514', null,
  'template keys must be SHA-256 hex');
select throws_ok($$select pg_temp.vote(1, 'template', repeat('a', 64), 'hired')$$, '23514', null,
  'template values must be an intent');
select throws_ok($$select pg_temp.vote(1, 'domain', 'not a domain', 'acme')$$, '23514', null,
  'domain keys must be domains');
select throws_ok($$select pg_temp.vote(1, 'domain', 'acme.example', 'Acme Pty Ltd!')$$, '23514', null,
  'company values must be normalised');
select throws_ok($$select public.vote_email_knowledge((select jsonb_agg(jsonb_build_object('kind', 'template', 'key', repeat('a', 64), 'value', 'received')) from generate_series(1, 21)))$$,
  '22023', null, 'at most 20 votes per call');
select throws_ok($$select * from private.email_knowledge_votes$$, '42501', null, 'votes are not readable');

select pg_temp.act_as_admin();
select is((select count(*)::int from private.email_knowledge_votes), 1, 'one vote stored');
select isnt((select voter from private.email_knowledge_votes),
  convert_to(pg_temp.uid(1)::text, 'UTF8'), 'the voter is an HMAC, not the user id');
select is(octet_length((select voter from private.email_knowledge_votes)), 32, 'a 32-byte HMAC');

-- Promotion: 3 distinct voters ------------------------------------------------------------
select pg_temp.vote(1, 'template', repeat('a', 64), 'received');
select pg_temp.vote(2, 'template', repeat('a', 64), 'received');
select pg_temp.act_as_admin();
select is((select count(*)::int from private.knowledge_lookup('template', repeat('a', 64))), 0,
  'two voters (or one voting twice) are not enough');
select pg_temp.vote(3, 'template', repeat('a', 64), 'received');
select pg_temp.act_as_admin();
select is((select (value, decides)::text from private.knowledge_lookup('template', repeat('a', 64))),
  '(received,t)', 'three distinct voters decide');

-- Contested: 3 vs 2 only suggests -----------------------------------------------------------
select pg_temp.vote(i, 'template', repeat('b', 64), 'rejected') from generate_series(1, 3) i;
select pg_temp.vote(i, 'template', repeat('b', 64), 'interview') from generate_series(4, 5) i;
select pg_temp.act_as_admin();
select is((select (value, decides)::text from private.knowledge_lookup('template', repeat('b', 64))),
  '(rejected,f)', 'a contested entry only suggests');

-- Domains ---------------------------------------------------------------------------------
select pg_temp.vote(i, 'domain', 'northwindlabs.example', 'northwind labs') from generate_series(1, 3) i;

-- Only voters who could vote today count ------------------------------------------------------
select pg_temp.vote(i, 'template', repeat('d', 64), 'offer') from generate_series(3, 5) i;
select pg_temp.act_as_admin();
select is((select (value, decides)::text from private.knowledge_lookup('template', repeat('d', 64))),
  '(offer,t)', 'three paying voters decide');
update public.entitlements set status = 'canceled' where user_id = pg_temp.uid(5);
select is((select (value, decides)::text from private.knowledge_lookup('template', repeat('d', 64))),
  '(offer,t)', 'a subscription cancelled at period end still counts until then');
update public.entitlements set current_period_end = now() - interval '1 day' where user_id = pg_temp.uid(5);
select is((select count(*)::int from private.knowledge_lookup('template', repeat('d', 64))), 0,
  'a lapsed voter no longer counts (2 left: below 3)');
update public.entitlements set status = 'active', current_period_end = now() + interval '20 days'
  where user_id = pg_temp.uid(5);
select is((select (value, decides)::text from private.knowledge_lookup('template', repeat('d', 64))),
  '(offer,t)', 'and counts again after resubscribing');

-- Applying knowledge on arrival -----------------------------------------------------------------
select pg_temp.act_as_anon();
select is(public.ingest_email_event('test-ingest-secret', 'abcdefghijkmnpqrstuv', jsonb_build_object(
  'intent', 'other', 'action', 'none', 'reasons', '[]'::jsonb, 'template', repeat('a', 64),
  'sender', jsonb_build_object('address', 'jo@northwindlabs.example', 'domain', 'northwindlabs.example'),
  'receivedAt', '2026-10-01T00:00:00Z', 'thread', jsonb_build_object('messageId', '<k1>'))),
  '{"ok": true, "stored": true}'::jsonb, 'an event with a known template is stored');
select pg_temp.act_as_admin();
select is((select event->>'intent' || '/' || (event->>'action') || '/' || (event->>'companyHint')
  from public.email_events where message_id = '<k1>'),
  'received/apply/northwind labs', 'a decided template sets the intent; a known domain names the company');
select is((select intent from public.email_events where message_id = '<k1>'), 'received',
  'and the intent column agrees');

select pg_temp.act_as_anon();
select public.ingest_email_event('test-ingest-secret', 'abcdefghijkmnpqrstuv', jsonb_build_object(
  'intent', 'interview', 'action', 'apply', 'template', repeat('b', 64), 'companyHint', 'Own Hint',
  'sender', jsonb_build_object('address', 'x@northwindlabs.example', 'domain', 'northwindlabs.example'),
  'receivedAt', '2026-10-01T00:00:00Z', 'thread', jsonb_build_object('messageId', '<k2>')));
select pg_temp.act_as_admin();
select is((select event->>'intent' || '/' || (event->>'action') || '/' || (event->>'companyHint')
  from public.email_events where message_id = '<k2>'),
  'rejected/suggest/Own Hint', 'a contested template only suggests; the email''s own company wins');

select pg_temp.act_as_anon();
select public.ingest_email_event('test-ingest-secret', 'abcdefghijkmnpqrstuv', jsonb_build_object(
  'intent', 'forwarding_verification', 'action', 'none', 'template', repeat('a', 64),
  'receivedAt', '2026-10-01T00:00:00Z', 'thread', jsonb_build_object('messageId', '<k3>')));
select pg_temp.act_as_admin();
select is((select intent from public.email_events where message_id = '<k3>'), 'forwarding_verification',
  'Gmail confirmations are never overridden');

-- Revoking, opting out and deleting accounts -------------------------------------------------
insert into private.email_knowledge_blocked (kind, key) values ('template', repeat('a', 64));
select is((select count(*)::int from private.knowledge_lookup('template', repeat('a', 64))), 0,
  'a revoked entry is ignored');

select pg_temp.act_as(pg_temp.uid(1));
select is(public.set_email_sharing(false), '{"ok": true, "share_learning": false}'::jsonb, 'sharing turns off');
select is(pg_temp.vote(1, 'template', repeat('c', 64), 'offer'),
  '{"ok": false, "reason": "sharing_off"}'::jsonb, 'and then the account doesn''t vote');
select pg_temp.act_as_admin();
select is((select count(*)::int from private.knowledge_lookup('domain', 'northwindlabs.example')), 0,
  'turning sharing off withdraws that account''s votes (2 left: below 3)');

delete from auth.users where id = pg_temp.uid(2);
select is((select count(*)::int from private.email_knowledge_votes where voter = private.knowledge_voter(pg_temp.uid(2))), 0,
  'deleting an account deletes its votes');

select * from finish();
rollback;
