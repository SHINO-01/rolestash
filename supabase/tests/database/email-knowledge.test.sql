-- Run with: npm run test:db  (needs Docker; see docs/guides/backend.md)
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

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

-- Nine Advanced users, one Pro user (10) and one on the sign-up Advanced
-- trial (11); user 1 has an inbox for ingest tests.
insert into auth.users (id, email, aud, role)
  select pg_temp.uid(i), 'u' || i || '@example.com', 'authenticated', 'authenticated'
  from generate_series(1, 10) i;
-- Sign-ups start on an Advanced trial; these fixtures start as Pro, then set what they need.
update public.entitlements set tier = 'pro';
update public.entitlements set tier = 'advanced', status = 'active', current_period_end = now() + interval '20 days'
  where user_id in (select pg_temp.uid(i) from generate_series(1, 9) i);
insert into auth.users (id, email, aud, role)
  values (pg_temp.uid(11), 'u11@example.com', 'authenticated', 'authenticated');
insert into public.email_inboxes (user_id, address_token)
  values (pg_temp.uid(1), 'abcdefghijkmnpqrstuv');
insert into private.email_ingest_secret (sha256)
  values (extensions.digest(convert_to('test-ingest-secret', 'UTF8'), 'sha256'));
grant execute on function pg_temp.uid(int) to authenticated, anon;

-- A ticket, as ingest_email_event() issues it for an email user n received.
create function pg_temp.ticket(n int, kind text, key text, day date default current_date) returns text
language plpgsql as $$
begin
  perform pg_temp.act_as_admin();
  return private.knowledge_ticket(private.knowledge_voter(pg_temp.uid(n)), kind, lower(key), day);
end;
$$;

-- Votes as user n, with a ticket for that email unless one is given.
create function pg_temp.vote(n int, kind text, key text, value text, ticket text default null) returns jsonb
language plpgsql as $$
declare
  v_ticket text;
begin
  v_ticket := coalesce(ticket, pg_temp.ticket(n, kind, key));
  perform pg_temp.act_as(pg_temp.uid(n));
  return public.vote_email_knowledge(jsonb_build_array(
    jsonb_build_object('kind', kind, 'key', key, 'value', value, 'ticket', v_ticket)));
end;
$$;

-- Voting rules ------------------------------------------------------------------------
select is(private.plan_tier_of(pg_temp.uid(11)), 'advanced', 'a trial counts as Advanced for its own features');
select is(pg_temp.vote(10, 'template', repeat('a', 64), 'received'),
  '{"ok": false, "reason": "plan_required"}'::jsonb, 'only Advanced accounts vote');
select is(pg_temp.vote(11, 'template', repeat('a', 64), 'received'),
  '{"ok": false, "reason": "plan_required"}'::jsonb, 'an Advanced trial doesn''t vote: only paying accounts do');
select is(pg_temp.vote(1, 'template', repeat('a', 64), 'received'),
  '{"ok": true, "recorded": 1, "skipped": 0}'::jsonb, 'Advanced votes are recorded');
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

-- Tickets: only for emails this account received (ADR-0028) ---------------------------------
select pg_temp.act_as(pg_temp.uid(1));
select is((select public.vote_email_knowledge(jsonb_build_array(
    jsonb_build_object('kind', 'template', 'key', repeat('e', 64), 'value', 'received')))),
  '{"ok": true, "recorded": 0, "skipped": 1}'::jsonb, 'a vote without a ticket is skipped');
select is(pg_temp.vote(1, 'template', repeat('e', 64), 'received', pg_temp.ticket(2, 'template', repeat('e', 64))),
  '{"ok": true, "recorded": 0, "skipped": 1}'::jsonb, 'someone else''s ticket doesn''t work');
select is(pg_temp.vote(1, 'template', repeat('e', 64), 'received', pg_temp.ticket(1, 'template', repeat('f', 64))),
  '{"ok": true, "recorded": 0, "skipped": 1}'::jsonb, 'nor does a ticket for another email');
select is(pg_temp.vote(1, 'template', repeat('e', 64), 'received',
    pg_temp.ticket(1, 'template', repeat('e', 64), current_date - 91)),
  '{"ok": true, "recorded": 0, "skipped": 1}'::jsonb, 'nor one more than 90 days old');
select is(pg_temp.vote(1, 'domain', 'us.greenhouse-mail.io', 'greenhouse'),
  '{"ok": true, "recorded": 0, "skipped": 1}'::jsonb, 'never a company for a recruiting system''s domain');
select is(pg_temp.vote(1, 'domain', 'outlook.com', 'outlook'),
  '{"ok": true, "recorded": 0, "skipped": 1}'::jsonb, 'or a mail platform''s');

select pg_temp.act_as_admin();
select is((select count(*)::int from private.email_knowledge_votes), 1, 'one vote stored');
select isnt((select voter from private.email_knowledge_votes),
  convert_to(pg_temp.uid(1)::text, 'UTF8'), 'the voter is an HMAC, not the user id');
select is(octet_length((select voter from private.email_knowledge_votes)), 32, 'a 32-byte HMAC');

-- Promotion: 5 distinct voters ------------------------------------------------------------
select pg_temp.vote(i, 'template', repeat('a', 64), 'received') from generate_series(1, 4) i;
select pg_temp.act_as_admin();
select is((select count(*)::int from private.knowledge_lookup('template', repeat('a', 64))), 0,
  'four voters (or one voting twice) are not enough');
select pg_temp.vote(5, 'template', repeat('a', 64), 'received');
select pg_temp.act_as_admin();
select is((select (value, decides)::text from private.knowledge_lookup('template', repeat('a', 64))),
  '(received,t)', 'five distinct voters decide');

-- Contested: 5 vs 2 only suggests -----------------------------------------------------------
select pg_temp.vote(i, 'template', repeat('b', 64), 'rejected') from generate_series(1, 5) i;
select pg_temp.vote(i, 'template', repeat('b', 64), 'interview') from generate_series(6, 7) i;
select pg_temp.act_as_admin();
select is((select (value, decides)::text from private.knowledge_lookup('template', repeat('b', 64))),
  '(rejected,f)', 'a contested entry only suggests');

-- Domains ---------------------------------------------------------------------------------
select pg_temp.vote(i, 'domain', 'northwindlabs.example', 'northwind labs') from generate_series(1, 5) i;

-- Only voters who could vote today count ------------------------------------------------------
select pg_temp.vote(i, 'template', repeat('d', 64), 'offer') from generate_series(5, 9) i;
select pg_temp.act_as_admin();
select is((select (value, decides)::text from private.knowledge_lookup('template', repeat('d', 64))),
  '(offer,t)', 'five paying voters decide');
update public.entitlements set status = 'canceled' where user_id = pg_temp.uid(9);
select is((select (value, decides)::text from private.knowledge_lookup('template', repeat('d', 64))),
  '(offer,t)', 'a subscription cancelled at period end still counts until then');
update public.entitlements set current_period_end = now() - interval '1 day' where user_id = pg_temp.uid(9);
select is((select count(*)::int from private.knowledge_lookup('template', repeat('d', 64))), 0,
  'a lapsed voter no longer counts (4 left: below 5)');
update public.entitlements set status = 'active', current_period_end = now() + interval '20 days'
  where user_id = pg_temp.uid(9);
select is((select (value, decides)::text from private.knowledge_lookup('template', repeat('d', 64))),
  '(offer,t)', 'and counts again after resubscribing');

-- Applying knowledge on arrival -----------------------------------------------------------------
select pg_temp.act_as_anon();
select is(public.ingest_email_event('test-ingest-secret', 'abcdefghijkmnpqrstuv', jsonb_build_object(
  'intent', 'other', 'action', 'none', 'reasons', '[]'::jsonb, 'template', repeat('a', 64),
  'sender', jsonb_build_object('address', 'jo@northwindlabs.example', 'domain', 'NorthwindLabs.example'),
  'receivedAt', '2026-10-01T00:00:00Z', 'thread', jsonb_build_object('messageId', '<k1>'))),
  '{"ok": true, "stored": true}'::jsonb, 'an event with a known template is stored');
select pg_temp.act_as_admin();
select is((select event->>'intent' || '/' || (event->>'action') || '/' || (event->>'companyHint')
  from public.email_events where message_id = '<k1>'),
  'received/apply/northwind labs', 'a decided template sets the intent; a known domain names the company');
select is((select intent from public.email_events where message_id = '<k1>'), 'received',
  'and the intent column agrees');
select is((select event #>> '{tickets,template}' from public.email_events where message_id = '<k1>'),
  pg_temp.ticket(1, 'template', repeat('a', 64)), 'the event carries a ticket for its template');
select is((select event #>> '{tickets,domain}' from public.email_events where message_id = '<k1>'),
  pg_temp.ticket(1, 'domain', 'northwindlabs.example'), 'and one for its sender''s domain');

select pg_temp.act_as_anon();
select public.ingest_email_event('test-ingest-secret', 'abcdefghijkmnpqrstuv', jsonb_build_object(
  'intent', 'interview', 'action', 'apply', 'template', repeat('b', 64), 'companyHint', 'Own Hint',
  'sender', jsonb_build_object('address', 'x@northwindlabs.example', 'domain', 'northwindlabs.example'),
  'receivedAt', '2026-10-01T00:00:00Z', 'thread', jsonb_build_object('messageId', '<k2>')));
select pg_temp.act_as_admin();
select is((select event->>'intent' || '/' || (event->>'action') || '/' || (event->>'companyHint')
  from public.email_events where message_id = '<k2>'),
  'rejected/suggest/Own Hint', 'a contested template only suggests; the email''s own company wins');

-- Shared knowledge never makes a big move on its own ----------------------------------------
select pg_temp.act_as_anon();
select public.ingest_email_event('test-ingest-secret', 'abcdefghijkmnpqrstuv', jsonb_build_object(
  'intent', 'received', 'action', 'apply', 'template', repeat('d', 64),
  'sender', jsonb_build_object('address', 'x@quokka.example', 'domain', 'quokka.example'),
  'receivedAt', '2026-10-01T00:00:00Z', 'thread', jsonb_build_object('messageId', '<k4>')));
select public.ingest_email_event('test-ingest-secret', 'abcdefghijkmnpqrstuv', jsonb_build_object(
  'intent', 'offer', 'action', 'apply', 'template', repeat('d', 64),
  'sender', jsonb_build_object('address', 'x@quokka.example', 'domain', 'quokka.example'),
  'receivedAt', '2026-10-01T00:00:00Z', 'thread', jsonb_build_object('messageId', '<k5>')));
select pg_temp.act_as_admin();
select is((select event->>'intent' || '/' || (event->>'action') from public.email_events where message_id = '<k4>'),
  'offer/suggest', 'a decided offer the email didn''t show is only suggested');
select is((select event->>'intent' || '/' || (event->>'action') from public.email_events where message_id = '<k5>'),
  'offer/apply', 'but agrees with an offer the email itself applied');

select pg_temp.act_as_anon();
select public.ingest_email_event('test-ingest-secret', 'abcdefghijkmnpqrstuv', jsonb_build_object(
  'intent', 'forwarding_verification', 'action', 'none', 'template', repeat('a', 64),
  'sender', jsonb_build_object('address', 'no-reply@us.greenhouse-mail.io', 'domain', 'us.greenhouse-mail.io'),
  'receivedAt', '2026-10-01T00:00:00Z', 'thread', jsonb_build_object('messageId', '<k3>')));
select pg_temp.act_as_admin();
select is((select intent from public.email_events where message_id = '<k3>'), 'forwarding_verification',
  'Gmail confirmations are never overridden');
select is((select event->'tickets' from public.email_events where message_id = '<k3>'), '{}'::jsonb,
  'and get no tickets, nor does a recruiting system''s domain');

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
  'turning sharing off withdraws that account''s votes (4 left: below 5)');

delete from auth.users where id = pg_temp.uid(2);
select is((select count(*)::int from private.email_knowledge_votes where voter = private.knowledge_voter(pg_temp.uid(2))), 0,
  'deleting an account deletes its votes');

-- Sharing is off when either copy of the choice says so (profile or inbox).
select pg_temp.act_as_admin();
update public.email_inboxes set share_learning = true where user_id = pg_temp.uid(1);
select is(pg_temp.vote(1, 'template', repeat('c', 64), 'offer'),
  '{"ok": false, "reason": "sharing_off"}'::jsonb, 'an inbox still saying yes doesn''t override the profile');
select pg_temp.act_as(pg_temp.uid(4));
select public.set_email_sharing(false);
select is(pg_temp.vote(4, 'template', repeat('c', 64), 'offer'),
  '{"ok": false, "reason": "sharing_off"}'::jsonb, 'an account that switched sharing off before having an inbox doesn''t vote');
select is(pg_temp.vote(5, 'template', repeat('c', 64), 'offer'),
  '{"ok": true, "recorded": 1, "skipped": 0}'::jsonb, 'with no choice recorded, sharing stays on (the sign-up default)');

select * from finish();
rollback;
