begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email, aud, role) values
  ('cccccccc-3333-4ccc-8ccc-111111111111', 'sam@example.com', 'authenticated', 'authenticated');
insert into private.ops_admin_secret (sha256)
  values (extensions.digest(convert_to('ops-admin-test-secret', 'UTF8'), 'sha256'));
insert into public.bug_reports (id, created_at, user_id, contact_email, message, context, status)
  overriding system value values
  (901, now() - interval '2 days', 'cccccccc-3333-4ccc-8ccc-111111111111', 'sam@example.com',
   'The board is blank', '{"version":"0.5.0","where":"board"}', 'new'),
  (902, now() - interval '1 day', null, null, 'Autofill missed a field', '{}', 'seen'),
  (903, now(), null, 'pat@example.com', 'Fixed already', '{}', 'fixed');

create function pg_temp.admin(p_action text, p_args jsonb) returns jsonb language sql as $$
  select public.ops_admin('ops-admin-test-secret', 'owner@example.com', p_action, p_args) $$;

select is(jsonb_array_length(pg_temp.admin('reports.list', '{}')->'reports'), 2,
  'the default list is the open reports (new and seen)');
select is(pg_temp.admin('reports.list', '{}')->'reports'->0->>'id', '902', 'newest first');
select is(jsonb_array_length(pg_temp.admin('reports.list', '{"status":"all"}')->'reports'), 3,
  'all shows every report');
select is(pg_temp.admin('reports.list', '{"status":"fixed"}')->'reports'->0->>'contact_email',
  'pat@example.com', 'one status at a time, with the contact email');
select is(pg_temp.admin('reports.list', '{"status":"new"}')->'reports'->0->>'signed_in', 'true',
  'says whether the report came from an account');
select is(pg_temp.admin('reports.list', '{}')->'by_status'->>'new', '1', 'counts by status');
select throws_ok($$select pg_temp.admin('reports.list', '{"status":"nope"}')$$, 'P0001',
  'Unknown report status nope', 'an unknown filter is refused');

select is(pg_temp.admin('reports.set_status', '{"id":901,"status":"fixed"}')->>'outcome', 'fixed',
  'a report moves to fixed');
select is((select count(*)::int from private.ops_audit where action = 'reports.set_status'), 1,
  'the change is logged');
select is(pg_temp.admin('reports.set_status', '{"id":901,"status":"fixed"}')->>'outcome', 'none',
  'setting the same status again changes nothing');
select is(pg_temp.admin('overview', '{}')->>'reports_open', '1', 'the overview counts open reports');

select * from finish();
rollback;
