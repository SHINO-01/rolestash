-- Shared learning for email updates (ADR-0014 §6, ADR-0019). When an
-- Advanced user confirms or corrects an update, their device votes for
-- general, non-personal knowledge:
--
--   template → intent   key: SHA-256 of the email's skeleton (names, numbers,
--                         dates and links removed), value: the intent
--   domain   → company  key: the sender's domain, value: a normalised
--                         company name
--
-- Voters are an HMAC of the user id under a server-only key, so votes can be
-- counted and removed but not linked to accounts without that key. An entry
-- decides for everyone once 3 distinct voters agree with a clear margin; a
-- contested entry only suggests. ingest_email_event applies it as mail
-- arrives. Votes are never readable by clients.

create extension if not exists pgcrypto with schema extensions;

-- The HMAC key: generated here, never leaves the database.
create table private.email_knowledge_key (
  id boolean primary key default true check (id),
  key bytea not null check (octet_length(key) = 32)
);
insert into private.email_knowledge_key (key) values (extensions.gen_random_bytes(32));
revoke all on table private.email_knowledge_key from public, anon, authenticated;

create table private.email_knowledge_votes (
  kind text not null check (kind in ('template', 'domain')),
  key text not null,
  value text not null,
  voter bytea not null check (octet_length(voter) = 32),
  created_at timestamptz not null default now(),
  primary key (kind, key, voter),
  check (
    (kind = 'template'
      and key ~ '^[0-9a-f]{64}$'
      and value in ('received', 'assessment', 'interview', 'rejected', 'offer', 'other'))
    or (kind = 'domain'
      and key ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      and length(key) <= 253
      and value ~ '^[a-z0-9]+( [a-z0-9]+)*$'
      and length(value) between 2 and 100)
  )
);
create index email_knowledge_votes_voter_idx on private.email_knowledge_votes (voter, created_at);
revoke all on table private.email_knowledge_votes from public, anon, authenticated;

-- Entries the owner has revoked (review: docs/guides/email-updates.md).
create table private.email_knowledge_blocked (
  kind text not null,
  key text not null,
  blocked_at timestamptz not null default now(),
  primary key (kind, key)
);
revoke all on table private.email_knowledge_blocked from public, anon, authenticated;

-- "Help improve automatic updates" (on by default; disclosed in the privacy policy).
alter table public.email_inboxes add column share_learning boolean not null default true;

-- Helpers ----------------------------------------------------------------------

create function private.knowledge_voter(p_user uuid)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select extensions.hmac(convert_to(p_user::text, 'UTF8'), k.key, 'sha256')
  from private.email_knowledge_key k;
$$;

/**
 * What everyone knows about (kind, key): the leading value and whether it
 * decides (3+ voters and at least 3 times the runner-up) or only suggests
 * (3+ voters but contested). No row when unknown, too few voters or revoked.
 */
create function private.knowledge_lookup(p_kind text, p_key text)
returns table (value text, decides boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with tally as (
    select v.value, count(*) as n
    from private.email_knowledge_votes v
    where v.kind = p_kind and v.key = p_key
      and not exists (select 1 from private.email_knowledge_blocked b where b.kind = p_kind and b.key = p_key)
    group by v.value
  ), ranked as (
    select t.value, t.n, row_number() over (order by t.n desc, t.value) as r from tally t
  )
  select top.value, top.n >= 3 * coalesce((select n from ranked where r = 2), 0)
  from ranked top
  where top.r = 1 and top.n >= 3;
$$;

-- Voting (Advanced, signed in) -------------------------------------------------------

/**
 * Records the caller's votes: [{ kind, key, value }, …], at most 20 per call
 * and 100 a day. Voting again on the same key replaces the earlier vote.
 * Returns { ok: true, recorded } or { ok: false, reason } with reason
 * 'plan_required', 'sharing_off' or 'rate_limited'.
 */
create function private.vote_email_knowledge(p_votes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_voter bytea;
  v_vote jsonb;
  v_count int := 0;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if private.plan_tier_of(v_uid) <> 'advanced' then
    return jsonb_build_object('ok', false, 'reason', 'plan_required');
  end if;
  if not coalesce((select share_learning from public.email_inboxes where user_id = v_uid), true) then
    return jsonb_build_object('ok', false, 'reason', 'sharing_off');
  end if;
  if jsonb_typeof(p_votes) <> 'array' or jsonb_array_length(p_votes) > 20 then
    raise exception 'send up to 20 votes at a time' using errcode = '22023';
  end if;

  v_voter := private.knowledge_voter(v_uid);
  perform pg_advisory_xact_lock(hashtext('knowledge:' || encode(v_voter, 'hex')));
  if (select count(*) from private.email_knowledge_votes
        where voter = v_voter and created_at > now() - interval '1 day')
     + jsonb_array_length(p_votes) > 100 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  for v_vote in select * from jsonb_array_elements(p_votes) loop
    insert into private.email_knowledge_votes as k (kind, key, value, voter)
      values (v_vote->>'kind', lower(v_vote->>'key'), v_vote->>'value', v_voter)
      on conflict (kind, key, voter) do update
        set value = excluded.value, created_at = now()
        where k.value is distinct from excluded.value;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('ok', true, 'recorded', v_count);
end;
$$;

/** Turns "Help improve automatic updates" on or off; off also withdraws the caller's votes. */
create function private.set_email_sharing(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  update public.email_inboxes set share_learning = p_on where user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_inbox'); end if;
  if not p_on then
    delete from private.email_knowledge_votes where voter = private.knowledge_voter(v_uid);
  end if;
  return jsonb_build_object('ok', true, 'share_learning', p_on);
end;
$$;

-- Deleting an account deletes its votes (they carry no user id to cascade on).
create function private.forget_knowledge_votes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.email_knowledge_votes where voter = private.knowledge_voter(old.id);
  return old;
end;
$$;
create trigger forget_knowledge_votes
  after delete on auth.users
  for each row execute function private.forget_knowledge_votes();

-- my_inbox() now also reports the sharing switch -----------------------------------

create or replace function private.my_inbox()
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
  update public.email_inboxes set paused_at = null where user_id = v_uid and paused_at is not null;
  select * into v_row from public.email_inboxes where user_id = v_uid;
  return jsonb_build_object(
    'ok', true,
    'address', v_row.address_token || '@in.rolestash.com',
    'created_at', v_row.created_at,
    'rotated_at', v_row.rotated_at,
    'share_learning', v_row.share_learning);
end;
$$;

-- ingest_email_event() now applies shared knowledge ------------------------------

create or replace function private.ingest_email_event(p_secret text, p_token text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inbox public.email_inboxes;
  v_count int;
  v_event jsonb := p_event;
  v_known record;
  v_status constant text[] := array['received', 'assessment', 'interview', 'rejected', 'offer'];
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

  -- Shared knowledge (ADR-0014 §6). A known template decides the intent (or,
  -- when contested, suggests it); a known sender domain names the company.
  if v_event->>'intent' <> 'forwarding_verification' and (v_event->>'template') ~ '^[0-9a-f]{64}$' then
    select * into v_known from private.knowledge_lookup('template', v_event->>'template');
    if found then
      if v_known.decides then
        v_event := v_event || jsonb_build_object(
          'intent', v_known.value,
          'action', case when v_known.value = any(v_status) then 'apply' else 'none' end,
          'confidence', 0.95,
          'reasons', jsonb_build_array('shared: known template') || coalesce(v_event->'reasons', '[]'::jsonb));
      elsif v_known.value = any(v_status) and v_known.value <> v_event->>'intent' then
        v_event := v_event || jsonb_build_object(
          'intent', v_known.value,
          'action', 'suggest',
          'confidence', 0.6,
          'reasons', jsonb_build_array('shared: template, contested') || coalesce(v_event->'reasons', '[]'::jsonb));
      end if;
    end if;
  end if;
  if v_event->>'companyHint' is null and (v_event #>> '{sender,domain}') is not null then
    select * into v_known from private.knowledge_lookup('domain', lower(v_event #>> '{sender,domain}'));
    if found and v_known.decides then
      v_event := v_event || jsonb_build_object('companyHint', v_known.value);
    end if;
  end if;

  insert into public.email_events (user_id, message_id, intent, event, received_at)
    values (
      v_inbox.user_id,
      left(v_event #>> '{thread,messageId}', 998),
      v_event->>'intent',
      v_event,
      coalesce((v_event->>'receivedAt')::timestamptz, now()))
    on conflict (user_id, message_id) where message_id is not null do nothing;
  get diagnostics v_count = row_count;

  delete from public.email_events
    where user_id = v_inbox.user_id and created_at < now() - interval '90 days';
  return jsonb_build_object('ok', true, 'stored', v_count = 1);
end;
$$;

-- Public wrappers ---------------------------------------------------------------------

create function public.vote_email_knowledge(p_votes jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.vote_email_knowledge(p_votes) $$;

create function public.set_email_sharing(p_on boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_email_sharing(p_on) $$;

revoke execute on function private.knowledge_voter(uuid) from public, anon, authenticated;
revoke execute on function private.knowledge_lookup(text, text) from public, anon, authenticated;
revoke execute on function private.forget_knowledge_votes() from public, anon, authenticated;
revoke execute on function private.vote_email_knowledge(jsonb) from public, anon;
revoke execute on function private.set_email_sharing(boolean) from public, anon;
grant execute on function private.vote_email_knowledge(jsonb) to authenticated;
grant execute on function private.set_email_sharing(boolean) to authenticated;

revoke execute on function public.vote_email_knowledge(jsonb) from public, anon;
revoke execute on function public.set_email_sharing(boolean) from public, anon;
grant execute on function public.vote_email_knowledge(jsonb) to authenticated;
grant execute on function public.set_email_sharing(boolean) to authenticated;
