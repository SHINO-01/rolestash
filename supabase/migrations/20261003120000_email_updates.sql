-- Email status updates (ADR-0014, ADR-0018). Each Advanced account gets a
-- forwarding address, <token>@in.rolestash.com. The Cloudflare Email Worker
-- reads forwarded mail in memory and stores only the extracted event here:
-- never the email itself. Events are deleted after 90 days.
--
-- The Worker holds no service-role key. It can call exactly one function,
-- ingest_email_event, with a dedicated secret whose SHA-256 is kept in
-- private.email_ingest_secret. Everything privileged lives in the `private`
-- schema behind SECURITY INVOKER wrappers, like sync (ADR-0016).

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, anon;

-- Tables ----------------------------------------------------------------------

create table public.email_inboxes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The bearer secret in the address. Lower-case, no look-alike characters.
  address_token text not null unique check (address_token ~ '^[a-km-np-z2-9]{20}$'),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  -- Set when mail arrived while the account wasn't on Advanced (shown once).
  paused_at timestamptz
);
alter table public.email_inboxes enable row level security;
-- Read through my_inbox() only, so the token never lands in a cached select.
revoke all on table public.email_inboxes from public, anon, authenticated;

create table public.email_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id text check (length(message_id) <= 998),
  intent text not null check (intent in
    ('received', 'assessment', 'interview', 'rejected', 'offer', 'other', 'forwarding_verification')),
  -- The extracted event (src/email EmailEventSchema): no email body.
  event jsonb not null check (jsonb_typeof(event) = 'object' and octet_length(event::text) <= 16384),
  received_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index email_events_user_cursor_idx on public.email_events (user_id, id);
create index email_events_created_idx on public.email_events (created_at);
-- One event per message per user: re-forwarding the same email changes nothing.
create unique index email_events_user_message_idx on public.email_events (user_id, message_id)
  where message_id is not null;

alter table public.email_events enable row level security;
create policy "Users read their own email events" on public.email_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users delete their own email events" on public.email_events
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on table public.email_events from public, anon;
grant select, delete on table public.email_events to authenticated;

create table private.email_ingest_secret (
  id boolean primary key default true check (id),
  sha256 bytea not null check (octet_length(sha256) = 32)
);
revoke all on table private.email_ingest_secret from public, anon, authenticated;

-- Helpers -----------------------------------------------------------------------

/** The plan tier of any user (plan_tier() is the caller's own). Same rules. */
create function private.plan_tier_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select e.tier
    from public.entitlements e
    where e.user_id = p_user
      and (
        (e.status = 'trialing' and e.trial_ends_at > now())
        or (e.status in ('active', 'past_due') and e.current_period_end + interval '3 days' > now())
        or (e.status = 'canceled' and e.current_period_end > now())
      )
  ), 'free');
$$;

/** 20 characters from a 32-character alphabet (no l, o, 0 or 1): 100 random bits. */
create function private.new_address_token()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  v_bytes bytea := extensions.gen_random_bytes(20);
  v_out text := '';
begin
  -- 256 is a multiple of 32, so the low five bits pick uniformly.
  for i in 0..19 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
  end loop;
  return v_out;
end;
$$;

-- Client RPCs (Advanced) --------------------------------------------------------

/**
 * The caller's forwarding address, created on first use. Advanced only.
 * Returns { ok, address, created_at, rotated_at, paused_at } or
 * { ok: false, reason: 'plan_required' }.
 */
create function private.my_inbox()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.email_inboxes;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if private.plan_tier_of(v_uid) <> 'advanced' then
    return jsonb_build_object('ok', false, 'reason', 'plan_required');
  end if;
  insert into public.email_inboxes (user_id, address_token)
    values (v_uid, private.new_address_token())
    on conflict (user_id) do nothing;
  -- Back on Advanced: clear the pause notice.
  update public.email_inboxes set paused_at = null where user_id = v_uid and paused_at is not null;
  select * into v_row from public.email_inboxes where user_id = v_uid;
  return jsonb_build_object(
    'ok', true,
    'address', v_row.address_token || '@in.rolestash.com',
    'created_at', v_row.created_at,
    'rotated_at', v_row.rotated_at);
end;
$$;

/** Replaces the address; mail to the old one is dropped from now on. */
create function private.rotate_inbox()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if private.plan_tier_of(v_uid) <> 'advanced' then
    return jsonb_build_object('ok', false, 'reason', 'plan_required');
  end if;
  insert into public.email_inboxes (user_id, address_token)
    values (v_uid, private.new_address_token())
    on conflict (user_id) do update
      set address_token = excluded.address_token, rotated_at = now();
  return private.my_inbox();
end;
$$;

-- Worker RPC --------------------------------------------------------------------

/**
 * Stores one extracted event for the inbox `p_token`. Called by the Email
 * Worker with its ingest secret. Returns { ok: true, stored } or
 * { ok: false, reason } where reason is 'unknown_address', 'not_advanced'
 * or 'rate_limited'. Limits per address: 30 events an hour, 200 a day.
 */
create function private.ingest_email_event(p_secret text, p_token text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inbox public.email_inboxes;
  v_count int;
begin
  if p_secret is null or not exists (
    select 1 from private.email_ingest_secret s
    where s.sha256 = extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_inbox from public.email_inboxes where address_token = lower(p_token);
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown_address'); end if;

  if private.plan_tier_of(v_inbox.user_id) <> 'advanced' then
    update public.email_inboxes set paused_at = coalesce(paused_at, now()) where user_id = v_inbox.user_id;
    return jsonb_build_object('ok', false, 'reason', 'not_advanced');
  end if;

  perform pg_advisory_xact_lock(hashtext('email_events:' || v_inbox.user_id::text));
  if (select count(*) from public.email_events
        where user_id = v_inbox.user_id and created_at > now() - interval '1 hour') >= 30
     or (select count(*) from public.email_events
        where user_id = v_inbox.user_id and created_at > now() - interval '1 day') >= 200 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  insert into public.email_events (user_id, message_id, intent, event, received_at)
    values (
      v_inbox.user_id,
      left(p_event #>> '{thread,messageId}', 998),
      p_event->>'intent',
      p_event,
      coalesce((p_event->>'receivedAt')::timestamptz, now()))
    on conflict (user_id, message_id) where message_id is not null do nothing;
  get diagnostics v_count = row_count;

  -- Retention, also enforced daily by pg_cron below.
  delete from public.email_events
    where user_id = v_inbox.user_id and created_at < now() - interval '90 days';
  return jsonb_build_object('ok', true, 'stored', v_count = 1);
end;
$$;

-- Public wrappers -----------------------------------------------------------------

create function public.my_inbox()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.my_inbox() $$;

create function public.rotate_inbox()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.rotate_inbox() $$;

create function public.ingest_email_event(p_secret text, p_token text, p_event jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.ingest_email_event(p_secret, p_token, p_event) $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_inbox() to authenticated;
grant execute on function private.rotate_inbox() to authenticated;
-- The Worker calls with the publishable key (anon) plus its ingest secret.
grant execute on function private.ingest_email_event(text, text, jsonb) to anon;

revoke execute on function public.my_inbox() from public, anon;
revoke execute on function public.rotate_inbox() from public, anon;
revoke execute on function public.ingest_email_event(text, text, jsonb) from public, authenticated;
grant execute on function public.my_inbox() to authenticated;
grant execute on function public.rotate_inbox() to authenticated;
grant execute on function public.ingest_email_event(text, text, jsonb) to anon;

-- The earlier private functions keep their grants (sync). Re-grant what the
-- blanket revoke above removed.
grant execute on function private.register_device(uuid, text, text) to authenticated;
grant execute on function private.push_jobs(uuid, jsonb) to authenticated;
grant execute on function private.pull_jobs(uuid, bigint, int) to authenticated;

-- Retention ------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'email-events-retention',
  '17 3 * * *',
  $$delete from public.email_events where created_at < now() - interval '90 days'$$
);
