-- Run with: npm run test:db  (needs Docker; see docs/guides/backend.md)
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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
grant execute on function pg_temp.uid(int) to authenticated, anon;

-- Users 1 and 2 are Advanced, without an inbox yet.
insert into auth.users (id, email, aud, role)
  select pg_temp.uid(i), 'u' || i || '@example.com', 'authenticated', 'authenticated'
  from generate_series(1, 2) i;
update public.entitlements set tier = 'advanced', status = 'active', current_period_end = now() + interval '20 days';

-- Profile: own row only ----------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(1));
select lives_ok($$insert into public.account_profiles (user_id, display_name, avatar)
  values (pg_temp.uid(1), 'Sam Taylor', 'data:image/webp;base64,UklGRg==')$$, 'a user creates their profile');
select throws_ok($$insert into public.account_profiles (user_id, display_name) values (pg_temp.uid(2), 'Not me')$$,
  '42501', null, 'not for someone else');
select lives_ok($$update public.account_profiles set display_name = 'Sammy' where user_id = pg_temp.uid(1)$$,
  'and updates it');
select throws_ok($$update public.account_profiles set avatar = 'https://tracker.example/p.gif' where user_id = pg_temp.uid(1)$$,
  '23514', null, 'the avatar must be an inline image, never a link');
select throws_ok($$update public.account_profiles set avatar = 'data:image/svg+xml;base64,PHN2Zz4=' where user_id = pg_temp.uid(1)$$,
  '23514', null, 'no SVG (it can carry script)');
select throws_ok($$update public.account_profiles set display_name = '   ' where user_id = pg_temp.uid(1)$$,
  '23514', null, 'a name is not blank');
select throws_ok($$update public.account_profiles set share_learning = false where user_id = pg_temp.uid(1)$$,
  '42501', null, 'sharing changes only through set_email_sharing');

select pg_temp.act_as(pg_temp.uid(2));
select is((select count(*)::int from public.account_profiles), 0, 'other profiles are invisible');

select pg_temp.act_as_anon();
select throws_ok($$select * from public.account_profiles$$, '42501', null, 'anon reads nothing');

-- Opting out at sign-up carries into the inbox ------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select is(public.set_email_sharing(false), '{"ok": true, "share_learning": false}'::jsonb,
  'opting out works before there is an inbox');
select is((public.my_inbox())->'share_learning', 'false'::jsonb, 'the new inbox starts opted out');
select is(public.set_email_sharing(true), '{"ok": true, "share_learning": true}'::jsonb, 'and can opt back in');
select is((public.my_inbox())->'share_learning', 'true'::jsonb, 'which the inbox follows');

select pg_temp.act_as(pg_temp.uid(1));
select is((public.my_inbox())->'share_learning', 'true'::jsonb, 'without a choice, sharing is on');

select * from finish();
rollback;
