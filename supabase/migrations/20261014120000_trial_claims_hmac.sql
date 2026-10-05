-- Trial claims, hardened (ADR-0011):
--
-- 1. Emails are canonicalised before hashing, so one mailbox gets one trial:
--    lowercased and trimmed, a "+tag" stripped, and for Gmail the dots
--    removed and googlemail.com read as gmail.com.
-- 2. Claims are an HMAC under a server-only key instead of a plain SHA-256,
--    so the table can't be reversed by guessing addresses. Existing rows are
--    rekeyed in place (HMAC of the old digest), so no plain digest remains
--    and a returning email still matches its old claim.

create extension if not exists pgcrypto with schema extensions;

-- The HMAC key: generated here, never leaves the database.
create table private.trial_claim_key (
  id boolean primary key default true check (id),
  key bytea not null check (octet_length(key) = 32)
);
insert into private.trial_claim_key (key) values (extensions.gen_random_bytes(32));
revoke all on table private.trial_claim_key from public, anon, authenticated;

create function private.canonical_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  with parts as (
    select split_part(e, '@', 1) as local,
           case split_part(e, '@', 2) when 'googlemail.com' then 'gmail.com' else split_part(e, '@', 2) end as domain
    from (select lower(trim(p_email)) as e) s
  ), untagged as (
    select split_part(local, '+', 1) as local, domain from parts
  )
  select case when domain = 'gmail.com' then replace(local, '.', '') else local end || '@' || domain
  from untagged;
$$;

-- HMAC of a SHA-256 digest; the digest step keeps old rows convertible.
create function private.trial_claim_of(p_digest bytea)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select extensions.hmac(p_digest, k.key, 'sha256') from private.trial_claim_key k;
$$;

alter table public.trial_claims add column claim bytea;
update public.trial_claims set claim = private.trial_claim_of(decode(email_sha256, 'hex'));
alter table public.trial_claims drop constraint trial_claims_pkey;
alter table public.trial_claims drop column email_sha256;
alter table public.trial_claims alter column claim set not null;
alter table public.trial_claims add constraint trial_claims_claim_length check (octet_length(claim) = 32);
alter table public.trial_claims add primary key (claim);
comment on table public.trial_claims is
  'Keyed hashes of canonical emails that have used a trial. No client access.';

-- Existing accounts also claim their canonical form, so their aliases match.
insert into public.trial_claims (claim)
  select private.trial_claim_of(extensions.digest(private.canonical_email(email), 'sha256'))
  from auth.users where email is not null
  on conflict (claim) do nothing;

drop function public.email_sha256(text);

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
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function private.canonical_email(text) from public, anon, authenticated;
revoke execute on function private.trial_claim_of(bytea) from public, anon, authenticated;
