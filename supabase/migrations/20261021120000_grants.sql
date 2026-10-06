-- Complimentary grants you can revoke (ADR-0035, part 1).
--
-- ADR-0025 made complimentary access data: an active entitlement marked
-- `complimentary`, which billing events never touch. This adds what it
-- lacked: a log of who was granted what and why, end dates, revoking, and
-- grants by email for people who haven't signed up yet.
--
-- - private.grants: one row per grant, revoked in place (never deleted).
-- - The entitlement stays the single source of truth: a grant sets the
--   ADR-0025 shape, with current_period_end = the grant's end (or 9999-12-31).
-- - private.billing_shadow: while a grant covers an account, Paddle events
--   for it are kept here instead of being dropped, so revoking returns the
--   account to its real subscription, trial or Free.
-- - Everything runs as the database owner (scripts/grants.ts, through the
--   management API) or from the daily job; nothing is callable by clients.

create table private.grants (
  id bigint generated always as identity primary key,
  -- Null while the grant waits for someone to sign up (email_claim is set).
  user_id uuid references auth.users (id) on delete set null,
  -- Keyed hash of the canonical email (the trial-claims HMAC), for grants
  -- made before sign-up. Never the address itself.
  email_claim bytea check (email_claim is null or octet_length(email_claim) = 32),
  -- Enough of the address for the owner to recognise it in a list ("da…@example.com").
  email_hint text check (email_hint is null or length(email_hint) <= 100),
  reason text not null check (reason in ('owner', 'team', 'tester', 'partner', 'support', 'referral')),
  -- Null means indefinite.
  expires_at timestamptz,
  note text check (note is null or length(note) <= 500),
  granted_at timestamptz not null default now(),
  granted_by text not null check (length(granted_by) between 1 and 100),
  revoked_at timestamptz,
  revoked_by text check (revoked_by is null or length(revoked_by) between 1 and 100),
  revoke_note text check (revoke_note is null or length(revoke_note) <= 500)
);

comment on table private.grants is
  'Complimentary access grants (ADR-0035): who, why, until when, and who revoked them. No client access.';

create index grants_active_user on private.grants (user_id) where revoked_at is null;
create index grants_active_pending on private.grants (email_claim)
  where revoked_at is null and user_id is null;
revoke all on table private.grants from public, anon, authenticated;

create table private.billing_shadow (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status public.entitlement_status not null,
  tier text not null,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  billing_interval text,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  last_event_at timestamptz
);

comment on table private.billing_shadow is
  'The entitlement an account would have without its grant: saved when the grant starts, kept current by billing events, restored when it ends.';

revoke all on table private.billing_shadow from public, anon, authenticated;

-- Helpers -----------------------------------------------------------------------

create function private.email_claim(p_email text)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select private.trial_claim_of(extensions.digest(private.canonical_email(p_email), 'sha256'));
$$;

create function private.email_hint(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(split_part(lower(trim(p_email)), '@', 1), 2) || '…@' || split_part(lower(trim(p_email)), '@', 2);
$$;

/** The account for an email: an exact match first, then the canonical form. */
create function private.user_for_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count int;
begin
  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if found then
    return v_id;
  end if;
  select count(*), min(id::text)::uuid into v_count, v_id
    from auth.users
   where email is not null and private.canonical_email(email) = private.canonical_email(p_email);
  if v_count > 1 then
    raise exception 'More than one account matches %; use the exact address', p_email;
  end if;
  return v_id;
end;
$$;

/** Puts an account on a grant: saves its own entitlement first, unless a grant already covers it. */
create function private.apply_grant(p_user uuid, p_reason text, p_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.billing_shadow (user_id, status, tier, trial_ends_at, current_period_end,
      billing_interval, provider, provider_customer_id, provider_subscription_id, last_event_at)
    select user_id, status, tier, trial_ends_at, current_period_end, billing_interval, provider,
           provider_customer_id, provider_subscription_id, last_event_at
      from public.entitlements
     where user_id = p_user and complimentary is null
  on conflict (user_id) do nothing;

  update public.entitlements
     set status = 'active',
         tier = 'advanced',
         trial_ends_at = null,
         current_period_end = coalesce(p_expires_at, '9999-12-31T00:00:00Z'),
         complimentary = p_reason
   where user_id = p_user;
  if not found then
    raise exception 'Account % has no entitlement row', p_user;
  end if;
end;
$$;

/**
 * Ends complimentary access: back to the saved entitlement (kept current by
 * billing events), or to Free when there's none. Data is never touched.
 */
create function private.restore_entitlement(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.billing_shadow;
begin
  select * into s from private.billing_shadow where user_id = p_user;
  if found then
    update public.entitlements
       set status = s.status, tier = s.tier, trial_ends_at = s.trial_ends_at,
           current_period_end = s.current_period_end, billing_interval = s.billing_interval,
           provider = s.provider,
           provider_customer_id = coalesce(s.provider_customer_id, provider_customer_id),
           provider_subscription_id = coalesce(s.provider_subscription_id, provider_subscription_id),
           last_event_at = s.last_event_at, complimentary = null
     where user_id = p_user;
    delete from private.billing_shadow where user_id = p_user;
  else
    update public.entitlements
       set status = 'expired', current_period_end = now(), trial_ends_at = null,
           complimentary = null
     where user_id = p_user and complimentary is not null;
  end if;
end;
$$;

-- What scripts/grants.ts calls -------------------------------------------------

/**
 * Grants complimentary Pro to an email: at once if it has an account, else
 * when it first signs in. A new grant replaces the account's current one.
 * Returns 'granted' or 'pending'.
 */
create function private.grant_access(
  p_email text,
  p_reason text,
  p_expires_at timestamptz,
  p_note text,
  p_by text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_claim bytea;
begin
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Not an email address: %', p_email;
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The end date must be in the future';
  end if;
  v_user := private.user_for_email(p_email);
  v_claim := private.email_claim(p_email);

  update private.grants
     set revoked_at = now(), revoked_by = p_by, revoke_note = 'Replaced by a new grant'
   where revoked_at is null
     and ((v_user is not null and user_id = v_user) or (user_id is null and email_claim = v_claim));

  insert into private.grants (user_id, email_claim, email_hint, reason, expires_at, note, granted_by)
    values (v_user, v_claim, private.email_hint(p_email), p_reason, p_expires_at, p_note, p_by);

  if v_user is null then
    return 'pending';
  end if;
  perform private.apply_grant(v_user, p_reason, p_expires_at);
  return 'granted';
end;
$$;

/** Revokes an email's grant (applied or pending). Returns 'revoked' or 'none'. */
create function private.revoke_access(p_email text, p_note text, p_by text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.user_for_email(p_email);
  v_claim bytea := private.email_claim(p_email);
  v_count int;
  v_comp boolean;
begin
  update private.grants
     set revoked_at = now(), revoked_by = p_by, revoke_note = p_note
   where revoked_at is null
     and ((v_user is not null and user_id = v_user) or (user_id is null and email_claim = v_claim));
  get diagnostics v_count = row_count;

  select complimentary is not null into v_comp from public.entitlements where user_id = v_user;
  if coalesce(v_comp, false) then
    perform private.restore_entitlement(v_user);
  end if;
  return case when v_count > 0 or coalesce(v_comp, false) then 'revoked' else 'none' end;
end;
$$;

/** Ends grants whose date has passed (the daily job). Returns how many ended. */
create function private.expire_grants()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
  v_count int := 0;
begin
  for g in
    update private.grants
       set revoked_at = now(), revoked_by = 'expiry', revoke_note = 'Reached its end date'
     where revoked_at is null and expires_at <= now()
    returning user_id
  loop
    v_count := v_count + 1;
    if g.user_id is not null
       and not exists (select 1 from private.grants
                        where user_id = g.user_id and revoked_at is null) then
      perform private.restore_entitlement(g.user_id);
    end if;
  end loop;
  return v_count;
end;
$$;

/** Every grant, newest first, with the account's email (or the hint, while pending). */
create function private.list_grants(p_all boolean default false)
returns table (
  id bigint,
  email text,
  reason text,
  expires_at timestamptz,
  note text,
  granted_at timestamptz,
  granted_by text,
  state text,
  revoked_at timestamptz,
  revoked_by text,
  revoke_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id,
         coalesce(u.email, g.email_hint),
         g.reason, g.expires_at, g.note, g.granted_at, g.granted_by,
         case when g.revoked_at is not null then 'revoked'
              when g.user_id is null then 'pending'
              else 'active' end,
         g.revoked_at, g.revoked_by, g.revoke_note
    from private.grants g
    left join auth.users u on u.id = g.user_id
   where p_all or g.revoked_at is null
   order by g.granted_at desc, g.id desc;
$$;

-- Pending grants apply at sign-up ------------------------------------------------

create function private.apply_pending_grants(p_user uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g private.grants;
begin
  if p_email is null then
    return;
  end if;
  update private.grants
     set user_id = p_user
   where revoked_at is null and user_id is null
     and email_claim = private.email_claim(p_email)
     and (expires_at is null or expires_at > now());
  select * into g from private.grants
   where user_id = p_user and revoked_at is null
   order by granted_at desc, id desc limit 1;
  if found then
    perform private.apply_grant(p_user, g.reason, g.expires_at);
  end if;
end;
$$;

-- Same as 20261014120000, plus the last line before return.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim bytea;
  v_legacy bytea;
  first_trial boolean := true;
begin
  if new.email is not null then
    v_claim := private.trial_claim_of(extensions.digest(private.canonical_email(new.email), 'sha256'));
    -- Claims made before canonicalisation hashed the lowercased, trimmed email.
    v_legacy := private.trial_claim_of(extensions.digest(lower(trim(new.email)), 'sha256'));
    insert into public.trial_claims (claim) values (v_claim)
      on conflict (claim) do nothing;
    first_trial := found and not exists (
      select 1 from public.trial_claims t where t.claim = v_legacy and v_legacy <> v_claim);
  end if;

  insert into public.entitlements (user_id, status, trial_ends_at, tier)
  values (
    new.id,
    case when first_trial then 'trialing' else 'expired' end::public.entitlement_status,
    case when first_trial then now() + interval '14 days' else now() end,
    'advanced'
  )
  on conflict (user_id) do nothing;

  -- A grant made for this email before it had an account (ADR-0035).
  perform private.apply_pending_grants(new.id, new.email);
  return new;
end;
$$;

-- Billing events for a covered account go to its shadow ---------------------------

-- Same signature and grants as 20261011120000. A complimentary row is still
-- never changed, and the function still returns false for it; the event is
-- kept in the shadow so revoking the grant restores the real subscription.
create or replace function public.apply_billing_event(
  p_user_id uuid,
  p_occurred_at timestamptz,
  p_status public.entitlement_status,
  p_current_period_end timestamptz,
  p_billing_interval text,
  p_provider text,
  p_customer_id text,
  p_subscription_id text,
  p_tier text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.entitlements
     set status = p_status,
         tier = p_tier,
         current_period_end = p_current_period_end,
         billing_interval = coalesce(p_billing_interval, billing_interval),
         provider = p_provider,
         provider_customer_id = coalesce(p_customer_id, provider_customer_id),
         provider_subscription_id = coalesce(p_subscription_id, provider_subscription_id),
         last_event_at = p_occurred_at
   where user_id = p_user_id
     and complimentary is null
     and (last_event_at is null or last_event_at < p_occurred_at);
  if found then
    return true;
  end if;

  if exists (select 1 from public.entitlements where user_id = p_user_id and complimentary is not null) then
    insert into private.billing_shadow as s (user_id, status, tier, current_period_end,
        billing_interval, provider, provider_customer_id, provider_subscription_id, last_event_at)
      values (p_user_id, p_status, p_tier, p_current_period_end, p_billing_interval, p_provider,
              p_customer_id, p_subscription_id, p_occurred_at)
    on conflict (user_id) do update
      set status = excluded.status,
          tier = excluded.tier,
          trial_ends_at = null,
          current_period_end = excluded.current_period_end,
          billing_interval = coalesce(excluded.billing_interval, s.billing_interval),
          provider = excluded.provider,
          provider_customer_id = coalesce(excluded.provider_customer_id, s.provider_customer_id),
          provider_subscription_id = coalesce(excluded.provider_subscription_id, s.provider_subscription_id),
          last_event_at = excluded.last_event_at
      where s.last_event_at is null or s.last_event_at < excluded.last_event_at;
  end if;
  return false;
end;
$$;

-- The grants made before this log, so the list is complete (the owner's) ------------

insert into private.grants (user_id, reason, expires_at, note, granted_at, granted_by)
  select user_id,
         case when complimentary in ('owner', 'team', 'tester', 'partner', 'support', 'referral')
              then complimentary else 'support' end,
         case when current_period_end >= '9999-01-01' then null else current_period_end end,
         'Granted before the grants log (ADR-0025): ' || complimentary,
         updated_at,
         'migration'
    from public.entitlements
   where complimentary is not null;

-- Access ---------------------------------------------------------------------------

revoke execute on function private.email_claim(text) from public, anon, authenticated;
revoke execute on function private.email_hint(text) from public, anon, authenticated;
revoke execute on function private.user_for_email(text) from public, anon, authenticated;
revoke execute on function private.apply_grant(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function private.restore_entitlement(uuid) from public, anon, authenticated;
revoke execute on function private.grant_access(text, text, timestamptz, text, text) from public, anon, authenticated;
revoke execute on function private.revoke_access(text, text, text) from public, anon, authenticated;
revoke execute on function private.expire_grants() from public, anon, authenticated;
revoke execute on function private.list_grants(boolean) from public, anon, authenticated;
revoke execute on function private.apply_pending_grants(uuid, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Dated grants end on their own, daily.
select cron.schedule('grants-expiry', '23 3 * * *', $$select private.expire_grants()$$);
