-- Run with: npm run test:db  (needs Docker; see docs/guides/backend.md)
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.act_as_admin() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

-- New sign-ups start a Pro trial (entitlements trigger).
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'pro@example.com', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'adv@example.com', 'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', 'free@example.com', 'authenticated', 'authenticated');
-- Sign-ups start on an Advanced trial; these fixtures start as Pro, then set what they need.
update public.entitlements set tier = 'pro';
update public.entitlements set tier = 'advanced', status = 'active',
  current_period_end = now() + interval '20 days'
  where user_id = '22222222-2222-4222-8222-222222222222';
update public.entitlements set status = 'expired'
  where user_id = '33333333-3333-4333-8333-333333333333';

-- Device limits ----------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(public.register_device('a0000000-0000-4000-8000-000000000001', 'Chrome on Mac', 'computer'),
  '{"ok": true}'::jsonb, 'Pro registers a computer');
select is(public.register_device('a0000000-0000-4000-8000-000000000001', 'Chrome on macOS', 'computer'),
  '{"ok": true}'::jsonb, 'registering again just refreshes it');
select public.register_device('a0000000-0000-4000-8000-000000000002', 'Laptop', 'computer');
select public.register_device('a0000000-0000-4000-8000-000000000003', 'Work PC', 'computer');
select is(public.register_device('a0000000-0000-4000-8000-000000000004', 'Fourth', 'computer'),
  '{"ok": false, "limit": 3, "reason": "device_limit"}'::jsonb, 'Pro stops at 3 computers');
select is(public.register_device('a0000000-0000-4000-8000-000000000005', 'Phone', 'web'),
  '{"ok": false, "limit": 0, "reason": "web_board_advanced"}'::jsonb, 'the web board is Advanced');
select is((select count(*)::int from public.devices), 3, 'a user sees only their devices');
select is((select name from public.devices where id = 'a0000000-0000-4000-8000-000000000001'),
  'Chrome on macOS', 'and the refreshed name');
delete from public.devices where id = 'a0000000-0000-4000-8000-000000000003';
select is(public.register_device('a0000000-0000-4000-8000-000000000004', 'Fourth', 'computer'),
  '{"ok": true}'::jsonb, 'removing a device frees its place');

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select throws_ok($$select public.register_device('a0000000-0000-4000-8000-000000000001', 'Steal', 'computer')$$,
  '23505', 'device id in use', 'another user cannot take a device id');
select is(public.register_device('b0000000-0000-4000-8000-000000000001', 'Phone', 'web'),
  '{"ok": true}'::jsonb, 'Advanced can use the web board');
select public.register_device(('b0000000-0000-4000-8000-00000000000' || i)::uuid, 'D' || i, 'computer')
  from generate_series(2, 5) i;
select is(public.register_device('b0000000-0000-4000-8000-000000000006', 'Sixth', 'computer'),
  '{"ok": false, "limit": 5, "reason": "device_limit"}'::jsonb, 'Advanced stops at 5 devices');

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select is(public.register_device('c0000000-0000-4000-8000-000000000001', 'Free', 'computer'),
  '{"ok": false, "limit": 0, "reason": "plan_required"}'::jsonb, 'Free cannot sync');

-- Push and pull ------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(public.push_jobs('a0000000-0000-4000-8000-000000000001', $$[
  {"id": "j1", "updatedAt": "2026-10-01T10:00:00Z", "data": {"id": "j1", "title": "First"}},
  {"id": "j2", "updatedAt": "2026-10-01T10:00:00Z", "data": {"id": "j2", "title": "Second"}}
]$$::jsonb), 2, 'pushes new jobs');
select is(public.push_jobs('a0000000-0000-4000-8000-000000000002', $$[
  {"id": "j1", "updatedAt": "2026-10-01T09:00:00Z", "data": {"id": "j1", "title": "Stale"}}
]$$::jsonb), 0, 'an older edit never overwrites a newer one');
select is(public.push_jobs('a0000000-0000-4000-8000-000000000002', $$[
  {"id": "j1", "updatedAt": "2026-10-01T11:00:00Z", "data": {"id": "j1", "title": "Newer"}},
  {"id": "j2", "updatedAt": "2026-10-01T11:00:00Z", "deleted": true}
]$$::jsonb), 2, 'a newer edit and a deletion apply');

select is((select count(*)::int from public.pull_jobs('a0000000-0000-4000-8000-000000000001', 0)), 2,
  'pull returns each job once, at its latest');
select is((select data->>'title' from public.pull_jobs('a0000000-0000-4000-8000-000000000001', 0) where job_id = 'j1'),
  'Newer', 'with the newest data');
select is((select deleted and data is null from public.pull_jobs('a0000000-0000-4000-8000-000000000001', 0) where job_id = 'j2'),
  true, 'and deletions as tombstones');
select is((select count(*)::int from public.pull_jobs('a0000000-0000-4000-8000-000000000001',
  (select max(revision) from public.pull_jobs('a0000000-0000-4000-8000-000000000001', 0)))), 0,
  'nothing after the latest revision');

select throws_ok($$select public.push_jobs('a0000000-0000-4000-8000-000000000003', '[]'::jsonb)$$,
  '42501', null, 'a removed device cannot push');
select throws_ok($$select * from public.synced_jobs$$, '42501', null, 'the table is not readable directly');

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.pull_jobs('b0000000-0000-4000-8000-000000000001', 0)), 0,
  'another user sees none of these jobs');

-- Lapsed plans stop syncing ------------------------------------------------------
select pg_temp.act_as_admin();
update public.entitlements set status = 'expired' where user_id = '11111111-1111-4111-8111-111111111111';
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok($$select * from public.pull_jobs('a0000000-0000-4000-8000-000000000001', 0)$$,
  '42501', null, 'a lapsed plan cannot pull');
select pg_temp.act_as_admin();
select is((select count(*)::int from public.synced_jobs where user_id = '11111111-1111-4111-8111-111111111111'), 2,
  'but its synced data is kept');

delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is((select count(*)::int from public.synced_jobs where user_id = '11111111-1111-4111-8111-111111111111')
  + (select count(*)::int from public.devices where user_id = '11111111-1111-4111-8111-111111111111'), 0,
  'deleting the account deletes synced jobs and devices');

select * from finish();
rollback;
