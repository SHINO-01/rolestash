-- Shared-learning hardening (ADR-0019 trust model, ADR-0028):
--
-- 1. A vote needs a ticket: ingest_email_event() now gives each stored event
--    an HMAC "ticket" per template and sender domain, bound to the receiving
--    account and the day. vote_email_knowledge() skips votes without a valid
--    ticket under 90 days old, so an account can only vote on emails it
--    actually received. Nothing extra is stored on the server.
-- 2. The server refuses company votes for shared mail and recruiting
--    platforms' domains (the extension already filtered them).
-- 3. An entry needs 5 agreeing paid voters, not 3, with the same 3x margin.
-- 4. A decided template never applies 'rejected' or 'offer' on its own: when
--    the email's own reading didn't apply that move, it becomes a suggestion.

-- Keep in step with isPlatformDomain() in src/email/ats.ts (a unit test
-- compares the two).
create function private.is_platform_domain(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_domain ~ '(^|\.)(greenhouse(-mail)?\.io|lever\.co|(myworkday|workday|myworkdayjobs)\.com|smartrecruiters(mail)?\.com|ashbyhq\.com|icims\.com|seek\.(com\.au|co\.nz|com)|linkedin\.com)$'
      or p_domain ~ '(^|\.)(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|proton|protonmail|sendgrid|mailgun|mandrillapp|amazonses|indeed|indeedemail|jobadder|pageuppeople|bamboohr|workable|jobvite|teamtailor|recruitee|breezy|jazzhr|successfactors|taleo|oraclecloud)\.(com|net|io|me|co|hr)$';
$$;

-- "YYYYMMDD.<64 hex>": an HMAC, under the knowledge key, of the voter, kind,
-- key and issue day.
create function private.knowledge_ticket(p_voter bytea, p_kind text, p_key text, p_day date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select to_char(p_day, 'YYYYMMDD') || '.' || encode(extensions.hmac(
    convert_to('ticket:' || p_kind || ':' || p_key || ':' || to_char(p_day, 'YYYYMMDD') || ':', 'UTF8') || p_voter,
    k.key, 'sha256'), 'hex')
  from private.email_knowledge_key k;
$$;

create function private.knowledge_ticket_ok(p_voter bytea, p_kind text, p_key text, p_ticket text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date;
begin
  if p_ticket is null or p_ticket !~ '^[0-9]{8}\.[0-9a-f]{64}$' or p_kind is null or p_key is null then
    return false;
  end if;
  begin
    v_day := to_date(left(p_ticket, 8), 'YYYYMMDD');
  exception when others then
    return false;
  end;
  if to_char(v_day, 'YYYYMMDD') <> left(p_ticket, 8)
     or v_day > current_date + 1 or v_day < current_date - 90 then
    return false;
  end if;
  return p_ticket = private.knowledge_ticket(p_voter, p_kind, p_key, v_day);
end;
$$;

revoke execute on function private.is_platform_domain(text) from public, anon, authenticated;
revoke execute on function private.knowledge_ticket(bytea, text, text, date) from public, anon, authenticated;
revoke execute on function private.knowledge_ticket_ok(bytea, text, text, text) from public, anon, authenticated;

-- Same signatures and grants as before (create or replace keeps them).
create or replace function private.knowledge_lookup(p_kind text, p_key text)
returns table (value text, decides boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible as (
    select voter from private.knowledge_eligible_voters() as voter
  ), tally as (
    select v.value, count(*) as n
    from private.email_knowledge_votes v
    where v.kind = p_kind and v.key = p_key
      and v.voter in (select voter from eligible)
      and not exists (select 1 from private.email_knowledge_blocked b where b.kind = p_kind and b.key = p_key)
    group by v.value
  ), ranked as (
    select t.value, t.n, row_number() over (order by t.n desc, t.value) as r from tally t
  )
  select top.value, top.n >= 3 * coalesce((select n from ranked where r = 2), 0)
  from ranked top
  where top.r = 1 and top.n >= 5;
$$;

create or replace function private.vote_email_knowledge(p_votes jsonb)
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
  v_skipped int := 0;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if private.plan_tier_of(v_uid) <> 'advanced'
     or exists (select 1 from public.entitlements e where e.user_id = v_uid and e.status = 'trialing') then
    return jsonb_build_object('ok', false, 'reason', 'plan_required');
  end if;
  if not private.shares_learning(v_uid) then
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
    -- Only for an email this account received, and never for a shared mail
    -- or recruiting platform's domain.
    if not private.knowledge_ticket_ok(v_voter, v_vote->>'kind', lower(v_vote->>'key'), v_vote->>'ticket')
       or (v_vote->>'kind' = 'domain' and private.is_platform_domain(lower(v_vote->>'key'))) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into private.email_knowledge_votes as k (kind, key, value, voter)
      values (v_vote->>'kind', lower(v_vote->>'key'), v_vote->>'value', v_voter)
      on conflict (kind, key, voter) do update
        set value = excluded.value, created_at = now()
        where k.value is distinct from excluded.value;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('ok', true, 'recorded', v_count, 'skipped', v_skipped);
end;
$$;

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
  -- Shared knowledge may only suggest these, never apply them on its own.
  v_big constant text[] := array['rejected', 'offer'];
  v_voter bytea;
  v_domain text := lower(p_event #>> '{sender,domain}');
  v_tickets jsonb := '{}'::jsonb;
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
          'action', case
            when not v_known.value = any(v_status) then 'none'
            -- A big move the email's own reading didn't reach is only suggested.
            when v_known.value = any(v_big) and v_known.value <> v_event->>'intent' then 'suggest'
            when v_known.value = any(v_big) and v_event->>'action' <> 'apply' then 'suggest'
            else 'apply'
          end,
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

  -- Vote tickets: proof, for vote_email_knowledge(), that this account
  -- received an email with this template and sender domain.
  v_voter := private.knowledge_voter(v_inbox.user_id);
  if p_event->>'intent' <> 'forwarding_verification' and (p_event->>'template') ~ '^[0-9a-f]{64}$' then
    v_tickets := v_tickets || jsonb_build_object(
      'template', private.knowledge_ticket(v_voter, 'template', p_event->>'template', current_date));
  end if;
  if v_domain is not null and not private.is_platform_domain(v_domain) then
    v_tickets := v_tickets || jsonb_build_object(
      'domain', private.knowledge_ticket(v_voter, 'domain', v_domain, current_date));
  end if;
  v_event := v_event || jsonb_build_object('tickets', v_tickets);

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

-- Votes cast before tickets existed (none in production on 5 October) can't
-- be checked, so they go.
delete from private.email_knowledge_votes;
