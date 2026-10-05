-- One paid plan (ADR-0029): Pro and Advanced merged into Pro, which has
-- everything Advanced had. The database keeps `advanced` as the stored tier
-- of the full plan, so every check written as `plan_tier() = 'advanced'`
-- (email updates, the web board, shared learning, five devices) holds for
-- every paying or trialling account, without rewriting those functions.
--
-- Subscribers on the old Pro price keep paying it and get everything; the
-- webhook now records `advanced` for every one of our prices.

update public.entitlements
set tier = 'advanced'
where tier = 'pro';

alter table public.entitlements
  alter column tier set default 'advanced';

comment on column public.entitlements.tier is
  'Paid plan of the trial or subscription. Always ''advanced'' (sold as Pro) since ADR-0029; ''pro'' is a legacy value.';
