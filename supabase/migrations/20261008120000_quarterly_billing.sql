-- Quarterly plans (ADR-0013 revision, 2026-10-02): Paddle bills them every
-- 3 months; the webhook records them as 'quarter'.
alter table public.entitlements drop constraint entitlements_billing_interval_check;
alter table public.entitlements add constraint entitlements_billing_interval_check
  check (billing_interval in ('month', 'quarter', 'year'));
