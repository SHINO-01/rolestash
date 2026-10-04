-- Complimentary access (ADR-0025): an account that keeps a paid plan without
-- a subscription, such as the owner's. The grant is data, set by hand with
-- the service role; this migration only makes it permanent.
--
-- A complimentary entitlement is an ordinary active row (status 'active',
-- the plan's tier, current_period_end far in the future), so every existing
-- check (planOf, plan_tier, has_pro, the RLS on tier-gated tables) already
-- treats it as paid. The new column marks it, and apply_billing_event never
-- touches a marked row: no webhook can downgrade or overwrite it.

alter table public.entitlements
  add column complimentary text check (complimentary is null or length(complimentary) between 1 and 200);

comment on column public.entitlements.complimentary is
  'Why this account has complimentary access (e.g. owner). Null for normal accounts. Set by hand only; billing events never change a row where it is set.';

-- Same signature and grants as before (create or replace keeps them); the
-- only change is "and complimentary is null".
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
  return found;
end;
$$;
