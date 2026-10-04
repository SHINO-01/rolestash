-- Operations dashboard counts (ADR-0026, owner-approved 2026-10-05). The ops
-- Worker calls public.ops_stats with the publishable key plus its own
-- secret, whose SHA-256 is kept in private.ops_stats_secret (the same pattern
-- as the email ingest secret). It returns counts only: no emails, names or ids.

create table private.ops_stats_secret (
  id boolean primary key default true check (id),
  sha256 bytea not null check (octet_length(sha256) = 32)
);
revoke all on table private.ops_stats_secret from public, anon, authenticated;

create function private.ops_stats(p_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_paid jsonb;
begin
  if p_secret is null or not exists (
    select 1 from private.ops_stats_secret s
    where s.sha256 = extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Paying accounts by tier (the rules of plan_tier, minus complimentary grants).
  select coalesce(jsonb_object_agg(tier, n), '{}'::jsonb) into v_paid
  from (
    select e.tier, count(*) as n
    from public.entitlements e
    where e.complimentary is null
      and e.status in ('active', 'past_due')
      and e.current_period_end + interval '3 days' > now()
    group by e.tier
  ) t;

  return jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'signups_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'trials_active', (select count(*) from public.entitlements
                       where status = 'trialing' and trial_ends_at > now()),
    'paid', v_paid,
    'past_due', (select count(*) from public.entitlements
                  where complimentary is null and status = 'past_due'),
    'cancelling', (select count(*) from public.entitlements
                    where complimentary is null and status = 'canceled' and current_period_end > now()),
    'complimentary', (select count(*) from public.entitlements where complimentary is not null),
    'devices_active_7d', (select count(*) from public.devices where last_seen_at > now() - interval '7 days'),
    'email_inboxes', (select count(*) from public.email_inboxes),
    'news_subscribers', (select count(*) from public.launch_subscribers where confirmed_at is not null),
    'problem_reports_new', (select count(*) from public.bug_reports where status = 'new'),
    'problem_reports_7d', (select count(*) from public.bug_reports where created_at > now() - interval '7 days')
  );
end;
$$;

create function public.ops_stats(p_secret text)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.ops_stats(p_secret) $$;

revoke execute on function private.ops_stats(text) from public, authenticated;
revoke execute on function public.ops_stats(text) from public, authenticated;
-- The Worker calls with the publishable key (anon) plus its secret.
grant execute on function private.ops_stats(text) to anon;
grant execute on function public.ops_stats(text) to anon;
