-- Accounts and entitlements (ADR-0009, ADR-0011).
--
-- Clients (the extension, with the public anon key and a user's JWT) may only
-- READ their own entitlement. Every write comes from Edge Functions using the
-- service role: the billing webhook, and account deletion. Row Level Security
-- enforces this even if a client is modified.

create type public.entitlement_status as enum (
  'trialing',
  'active',
  'past_due',
  'paused',
  'canceled',
  'expired'
);

create table public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status public.entitlement_status not null default 'trialing',
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  billing_interval text check (billing_interval in ('month', 'year')),
  provider text check (provider in ('paddle', 'creem')),
  provider_customer_id text,
  provider_subscription_id text unique,
  -- occurred_at of the newest billing event applied; older events are ignored
  -- because providers don't guarantee delivery order.
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.entitlements is
  'One row per account. Readable by its owner; written only by Edge Functions (service role).';

alter table public.entitlements enable row level security;

create policy "Owners can read their entitlement"
  on public.entitlements for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Defence in depth: no write policies exist, and no write grants either.
revoke all on public.entitlements from anon, authenticated;
grant select on public.entitlements to authenticated;

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger entitlements_touch_updated_at
  before update on public.entitlements
  for each row execute function public.touch_updated_at();

-- One free trial per email address, even across account deletion. Stores a
-- SHA-256 of the normalised address, never the address itself.
create table public.trial_claims (
  email_sha256 text primary key,
  claimed_at timestamptz not null default now()
);

comment on table public.trial_claims is
  'Hashed emails that have used a trial. No client access.';

alter table public.trial_claims enable row level security;
revoke all on public.trial_claims from anon, authenticated;

create function public.email_sha256(email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(lower(trim(email)), 'sha256'), 'hex');
$$;

-- New account → 30-day trial, unless this email already had one.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim text := case when new.email is null then null else public.email_sha256(new.email) end;
  first_trial boolean := true;
begin
  if claim is not null then
    insert into public.trial_claims (email_sha256) values (claim)
      on conflict (email_sha256) do nothing;
    first_trial := found;
  end if;

  insert into public.entitlements (user_id, status, trial_ends_at)
  values (
    new.id,
    case when first_trial then 'trialing' else 'expired' end::public.entitlement_status,
    case when first_trial then now() + interval '30 days' else now() end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Server-side twin of planOf() in src/domain/plan.ts (minus the client-only
-- offline grace), for the calling user only. Used by RLS policies on Pro-only
-- tables such as sync: `using (public.has_pro())`.
create function public.has_pro()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.entitlements e
    where e.user_id = (select auth.uid())
      and (
        (e.status = 'trialing' and e.trial_ends_at > now())
        or (e.status in ('active', 'past_due') and e.current_period_end + interval '3 days' > now())
        or (e.status = 'canceled' and e.current_period_end > now())
      )
  );
$$;

revoke execute on function public.has_pro() from public, anon;
grant execute on function public.has_pro() to authenticated;
