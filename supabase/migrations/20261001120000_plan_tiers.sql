-- Free / Pro / Advanced (ADR-0013). A trial or subscription is for a tier;
-- Free is the absence of paid access. Trials are Pro.

alter table public.entitlements
  add column tier text not null default 'pro' check (tier in ('pro', 'advanced'));

comment on column public.entitlements.tier is
  'Plan of the trial or subscription. Set from the Paddle price by the billing webhook.';

-- apply_billing_event gains the tier; same ordering guarantees as before.
drop function public.apply_billing_event(
  uuid, timestamptz, public.entitlement_status, timestamptz, text, text, text, text
);

create function public.apply_billing_event(
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
     and (last_event_at is null or last_event_at < p_occurred_at);
  return found;
end;
$$;

revoke execute on function public.apply_billing_event(
  uuid, timestamptz, public.entitlement_status, timestamptz, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_billing_event(
  uuid, timestamptz, public.entitlement_status, timestamptz, text, text, text, text, text
) to service_role;

-- The caller's plan right now: 'free', 'pro' or 'advanced'. Server-side twin
-- of planOf() (minus the client-only offline grace). For RLS on tier-gated
-- tables, e.g. `using (public.plan_tier() = 'advanced')`.
create function public.plan_tier()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((
    select e.tier
    from public.entitlements e
    where e.user_id = (select auth.uid())
      and (
        (e.status = 'trialing' and e.trial_ends_at > now())
        or (e.status in ('active', 'past_due') and e.current_period_end + interval '3 days' > now())
        or (e.status = 'canceled' and e.current_period_end > now())
      )
  ), 'free');
$$;

revoke execute on function public.plan_tier() from public, anon;
grant execute on function public.plan_tier() to authenticated;
