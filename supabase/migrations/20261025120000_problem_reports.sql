-- Problem reports in the operations dashboard (ADR-0024, ADR-0037).
--
-- Reports from "Report a problem" were only emailed to support and counted
-- on the Overview. ops_admin now lists them (reports.list) and moves them
-- through new → seen → fixed / closed (reports.set_status, logged), and the
-- overview counts new and open ones. Nothing else changes: the table stays
-- unreadable through the API, and the bug-report function still deletes
-- reports after 12 months.

/**
 * Everything the dashboard reads or changes here (ADR-0037; emails, ADR-0038; two-step sign-in, ADR-0036;
 * problem reports, ADR-0024). Every change is
 * logged in private.ops_audit with the Access-verified email as the actor.
 */
create or replace function private.ops_admin(p_secret text, p_actor text, p_action text, p_args jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a jsonb := coalesce(p_args, '{}'::jsonb);
  v_actor text := left(coalesce(nullif(trim(p_actor), ''), 'dashboard'), 100);
  v_out jsonb;
  v_text text;
  v_user uuid;
  v_count int;
  r private.referrals;
  v_status text;
begin
  if not private.ops_admin_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  case p_action
  -- Reading ------------------------------------------------------------------------
  when 'grants.list' then
    select coalesce(jsonb_agg(to_jsonb(g)), '[]') into v_out
      from private.list_grants(coalesce((a->>'all')::boolean, false)) g;
    return v_out;

  when 'grants.preview' then
    v_user := private.user_for_email(a->>'email');
    select jsonb_build_object(
      'has_account', v_user is not null,
      'status', e.status, 'complimentary', e.complimentary,
      'current_period_end', e.current_period_end,
      'active_grant', (select to_jsonb(g) from private.list_grants(false) g
                        where g.id = (select max(x.id) from private.grants x
                                       where x.revoked_at is null
                                         and (x.user_id = v_user or (x.user_id is null
                                              and x.email_claim = private.email_claim(a->>'email'))))),
      'ends', private.sydney_end_of_day(a->>'until'))
      into v_out
      from (select 1) one left join public.entitlements e on e.user_id = v_user;
    return v_out;

  when 'referrals.summary' then
    return jsonb_build_object(
      'settings', (select jsonb_object_agg(key, value) from private.program_settings),
      'codes', (select count(*) from private.referral_codes),
      'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from
                     (select status, count(*) n from private.referrals group by status) s),
      'awaiting_paddle', (select count(*) from private.referrals
                           where status = 'qualified' and reward = 'paddle_month'),
      'top', (select coalesce(jsonb_agg(t), '[]') from (
                select u.email, count(*) filter (where x.status <> 'void') as joined,
                       count(*) filter (where x.status = 'rewarded' and x.reward <> 'not_needed') as earned
                  from private.referrals x left join auth.users u on u.id = x.referrer_id
                 group by u.email order by 2 desc, 3 desc limit 10) t),
      'recent', (select coalesce(jsonb_agg(t), '[]') from (
                   select x.id, u.email as referrer, x.friend_hint as friend, x.status, x.reward,
                          x.note, x.created_at, x.rewarded_at
                     from private.referrals x left join auth.users u on u.id = x.referrer_id
                    order by x.created_at desc, x.id desc limit 50) t));

  when 'referrals.paddle_due' then
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'subscription_id', e.provider_subscription_id)), '[]')
      into v_out
      from private.referrals x join public.entitlements e on e.user_id = x.referrer_id
     where x.status = 'qualified' and x.reward = 'paddle_month';
    return v_out;

  when 'audit.list' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v_out from (
      select at, actor, action, detail, outcome from private.ops_audit
       order by at desc, id desc limit least(coalesce((a->>'limit')::int, 50), 200)) t;
    return v_out;

  when 'overview' then
    return jsonb_build_object(
      'grants_active', (select count(*) from private.grants where revoked_at is null),
      'grants_pending', (select count(*) from private.grants where revoked_at is null and user_id is null),
      'grants_ending_14d', (select count(*) from private.grants where revoked_at is null
                             and expires_at < now() + interval '14 days'),
      'referrals_enabled', coalesce((private.setting('referrals_enabled'))::boolean, false),
      'referrals_pending', (select count(*) from private.referrals where status = 'pending'),
      'referrals_awaiting_paddle', (select count(*) from private.referrals
                                     where status = 'qualified' and reward = 'paddle_month'),
      'referrals_rewarded_30d', (select count(*) from private.referrals
                                  where status = 'rewarded' and rewarded_at > now() - interval '30 days'),
      'reports_new', (select count(*) from public.bug_reports where status = 'new'),
      'reports_open', (select count(*) from public.bug_reports where status in ('new', 'seen')),
      'last_change', (select to_jsonb(t) from (select at, actor, action, outcome from private.ops_audit
                                                order by at desc, id desc limit 1) t));

  when 'audience.count' then
    select jsonb_build_object(
      'count', count(*),
      'sample', coalesce((select jsonb_agg(private.email_hint(s.email)) from
                  (select x.email from private.audience(a->>'segment', private.email_list(a->'emails')) x
                    order by x.email limit 3) s), '[]'),
      'unknown', (select count(*) from jsonb_array_elements_text(coalesce(a->'emails', '[]')) e(v)
                   where private.user_for_email_or_null(e.v) is null))
      into v_out
      from private.audience(a->>'segment', private.email_list(a->'emails'));
    return v_out;

  when 'emails.summary' then
    return jsonb_build_object(
      'opted_out', (select count(*) from private.marketing_contacts where opted_out_at is not null),
      'emailed_7d', (select count(*) from private.marketing_contacts
                      where last_offer_at > now() - interval '7 days'),
      'recent', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from (
                   select at, actor, action, detail - 'emails' as detail, outcome from private.ops_audit
                    where action like 'email.%' order by at desc, id desc limit 20) t));

  when 'accounts.two_step' then
    v_user := private.user_for_email(a->>'email');
    return jsonb_build_object(
      'has_account', v_user is not null,
      'authenticators', (select count(*) from auth.mfa_factors f
                          where f.user_id = v_user and f.status = 'verified'));

  when 'reports.list' then
    -- "open" (new and seen, the default), one status, or "all"; newest first.
    v_status := coalesce(nullif(a->>'status', ''), 'open');
    if v_status not in ('open', 'all', 'new', 'seen', 'fixed', 'closed') then
      raise exception 'Unknown report status %', v_status;
    end if;
    return jsonb_build_object(
      'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from
                     (select status, count(*) n from public.bug_reports group by status) s),
      'reports', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from (
                    select b.id, b.created_at, b.message, b.contact_email, b.context, b.status,
                           b.user_id is not null as signed_in,
                           (select e.status from public.entitlements e where e.user_id = b.user_id) as plan_status
                      from public.bug_reports b
                     where v_status = 'all' or b.status = v_status
                        or (v_status = 'open' and b.status in ('new', 'seen'))
                     order by b.created_at desc, b.id desc
                     limit least(coalesce((a->>'limit')::int, 100), 500)) t));

  -- Changing (logged) -----------------------------------------------------------------
  when 'audience.claim' then
    -- The recipients of one offer email, marked as emailed now so a retry
    -- or a second campaign this week skips them (at most once a week each).
    with picked as (
      select x.user_id, x.email from private.audience(a->>'segment', private.email_list(a->'emails')) x
       order by x.email limit least(coalesce((a->>'limit')::int, 1000), 1000)),
    contacts as (
      insert into private.marketing_contacts (user_id, last_offer_at)
        select p.user_id, now() from picked p
      on conflict (user_id) do update set last_offer_at = now()
      returning user_id, token)
    select coalesce(jsonb_agg(jsonb_build_object('email', p.email, 'token', c.token)), '[]')
      into v_out
      from picked p join contacts c using (user_id);
    insert into private.ops_audit (actor, action, detail, outcome)
      values (v_actor, 'email.recipients', a - 'emails' || jsonb_build_object(
                'listed', jsonb_array_length(coalesce(a->'emails', '[]'))),
              jsonb_array_length(v_out)::text || ' recipients');
    return v_out;

  when 'accounts.two_step_off' then
    -- Support for someone who lost their authenticator (ADR-0036): remove
    -- every factor and end every session, so they sign in again with a code.
    v_user := private.user_for_email(a->>'email');
    if v_user is null then
      raise exception 'No account for %', a->>'email';
    end if;
    delete from auth.mfa_factors where user_id = v_user;
    get diagnostics v_count = row_count;
    delete from auth.sessions where user_id = v_user;
    v_out := jsonb_build_object('outcome', case when v_count > 0 then 'removed' else 'none' end,
                                'removed', v_count);

  when 'reports.set_status' then
    if a->>'status' not in ('new', 'seen', 'fixed', 'closed') then
      raise exception 'Unknown report status %', a->>'status';
    end if;
    update public.bug_reports set status = a->>'status'
     where id = (a->>'id')::bigint and status <> a->>'status';
    get diagnostics v_count = row_count;
    v_out := jsonb_build_object('outcome', case when v_count > 0 then a->>'status' else 'none' end);

  when 'grants.grant' then
    v_text := private.grant_access(a->>'email', a->>'reason', private.sydney_end_of_day(a->>'until'),
                                   nullif(a->>'note', ''), v_actor);
    v_out := jsonb_build_object('outcome', v_text);

  when 'grants.revoke' then
    v_text := private.revoke_access(a->>'email', nullif(a->>'note', ''), v_actor);
    v_out := jsonb_build_object('outcome', v_text);

  when 'referrals.void' then
    update private.referrals
       set status = 'void', voided_at = now(), note = left(coalesce(nullif(a->>'note', ''), 'voided by the owner'), 300)
     where id = (a->>'id')::bigint and status in ('pending', 'qualified', 'capped')
    returning * into r;
    v_out := jsonb_build_object('outcome', case when r.id is null then 'none' else 'void' end);

  when 'referrals.process' then
    v_out := private.process_referrals();

  when 'referrals.paddle_done' then
    -- The dashboard moved the referrer's renewal (ok), or couldn't: their
    -- subscription is gone, so the month becomes a dated grant instead.
    select * into r from private.referrals
     where id = (a->>'id')::bigint and status = 'qualified' and reward = 'paddle_month';
    if r.id is null then
      v_out := jsonb_build_object('outcome', 'none');
    elsif coalesce((a->>'ok')::boolean, false) then
      update private.referrals set status = 'rewarded', rewarded_at = now(),
             note = left(nullif(a->>'detail', ''), 300) where id = r.id;
      v_out := jsonb_build_object('outcome', 'rewarded');
    else
      v_text := private.referral_grant(r.referrer_id);
      update private.referrals set status = 'rewarded', reward = v_text, rewarded_at = now(),
             note = left(coalesce(nullif(a->>'detail', ''), 'Paddle renewal not moved'), 300)
       where id = r.id;
      v_out := jsonb_build_object('outcome', v_text);
    end if;

  when 'settings.set' then
    if a->>'key' not in ('referrals_enabled', 'referral_discount_id', 'referral_percent') then
      raise exception 'Unknown setting %', a->>'key';
    end if;
    if a->>'key' = 'referral_percent' and not (jsonb_typeof(a->'value') = 'number'
         and (a->>'value') ~ '^\d+$' and (a->>'value')::int between 1 and 100) then
      raise exception 'The referral percent is a whole number from 1 to 100';
    end if;
    if a->>'key' = 'referrals_enabled' and jsonb_typeof(a->'value') <> 'boolean' then
      raise exception 'referrals_enabled is true or false';
    end if;
    if a->>'key' = 'referral_discount_id' and not (jsonb_typeof(a->'value') = 'string'
         and (a->>'value') ~ '^dsc_[a-z0-9]{10,60}$') then
      raise exception 'The referral discount is a Paddle discount id (dsc_…)';
    end if;
    insert into private.program_settings (key, value, updated_at, updated_by)
      values (a->>'key', a->'value', now(), v_actor)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = v_actor;
    v_out := jsonb_build_object('outcome', 'saved');

  when 'audit.log' then
    -- Changes made at Paddle from the dashboard (discount codes), logged here.
    v_out := jsonb_build_object('outcome', 'logged');
    insert into private.ops_audit (actor, action, detail, outcome)
      values (v_actor, left(coalesce(a->>'action', 'paddle'), 60), coalesce(a->'detail', '{}'),
              left(coalesce(a->>'outcome', ''), 500));
    return v_out;

  else
    raise exception 'Unknown action %', p_action;
  end case;

  insert into private.ops_audit (actor, action, detail, outcome)
    values (v_actor, p_action, a, left(coalesce(v_out->>'outcome', v_out::text), 500));
  return v_out;
end;
$$;

revoke execute on function private.ops_admin(text, text, text, jsonb) from public, anon, authenticated;
