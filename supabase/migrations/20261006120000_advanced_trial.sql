-- The free trial is now 14 days of Advanced (ADR-0013 revision, 2026-10-02):
-- people try the full product, then pick Pro or Advanced, or stay on Free.
-- Still one trial per email, still no card. Trials already running keep
-- their tier and end date.

create or replace function public.handle_new_user()
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
