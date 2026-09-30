-- Billing webhook → entitlement (ADR-0011). Called only by the paddle-webhook
-- Edge Function with the service role. Atomic, and ignores events older than
-- the newest one already applied (providers don't guarantee delivery order).

create function public.apply_billing_event(
  p_user_id uuid,
  p_occurred_at timestamptz,
  p_status public.entitlement_status,
  p_current_period_end timestamptz,
  p_billing_interval text,
  p_provider text,
  p_customer_id text,
  p_subscription_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.entitlements
     set status = p_status,
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
  uuid, timestamptz, public.entitlement_status, timestamptz, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_billing_event(
  uuid, timestamptz, public.entitlement_status, timestamptz, text, text, text, text
) to service_role;
