-- Referrals, codes at checkout, and dashboard actions (ADR-0035 parts 2-3,
-- ADR-0037).
--
-- - Referral codes and referrals: every account can get a code; a friend's
--   first paid subscription through it is recorded, waits out the 14-day
--   refund window, then rewards the referrer with a free month (a Paddle
--   renewal moved out by the dashboard's daily job, or a dated grant).
-- - private.program_settings: the referral programme's switch, discount and
--   percent, set from the dashboard.
-- - public.checkout_code: what create-checkout asks about a code typed or
--   carried to checkout (referral or not), rate-limited per account.
-- - public.ops_admin: the dashboard's only way to change anything here,
--   gated by its own secret (SHA-256 in private.ops_admin_secret, separate
--   from the read-only stats secret) and logged in private.ops_audit.

-- Settings -------------------------------------------------------------------------

create table private.program_settings (
  key text primary key check (key in ('referrals_enabled', 'referral_discount_id', 'referral_percent')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into private.program_settings (key, value, updated_by) values
  ('referrals_enabled', 'false', 'migration'),
  ('referral_percent', '50', 'migration');
revoke all on table private.program_settings from public, anon, authenticated;

create function private.setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select value from private.program_settings where key = p_key;
$$;

-- The dashboard's secret and audit log ------------------------------------------------

create table private.ops_admin_secret (
  id boolean primary key default true check (id),
  sha256 bytea not null check (octet_length(sha256) = 32)
);
revoke all on table private.ops_admin_secret from public, anon, authenticated;

create table private.ops_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null check (length(actor) between 1 and 200),
  action text not null check (length(action) between 1 and 60),
  detail jsonb not null default '{}'::jsonb,
  outcome text not null check (length(outcome) <= 500)
);
comment on table private.ops_audit is
  'Every change made from the operations dashboard (ADR-0037): who, what, and the result.';
create index ops_audit_at on private.ops_audit (at desc);
revoke all on table private.ops_audit from public, anon, authenticated;

-- Referral codes and referrals ---------------------------------------------------------

-- 8 characters of unambiguous base32 (no 0, 1, I or O), random, not derived from the email.
create table private.referral_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^[2-9A-HJ-NP-Z]{8}$'),
  created_at timestamptz not null default now()
);
revoke all on table private.referral_codes from public, anon, authenticated;

create table private.referrals (
  id bigint generated always as identity primary key,
  referrer_id uuid references auth.users (id) on delete set null,
  code text not null,
  friend_id uuid references auth.users (id) on delete set null,
  -- One referral per friend, ever (the trial-claims HMAC of the canonical email).
  friend_email_claim bytea not null unique check (octet_length(friend_email_claim) = 32),
  friend_hint text check (friend_hint is null or length(friend_hint) <= 100),
  transaction_id text,
  subscription_id text,
  customer_id text,
  status text not null default 'pending'
    check (status in ('pending', 'qualified', 'rewarded', 'void', 'capped')),
  reward text check (reward in ('paddle_month', 'grant_month', 'not_needed')),
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  qualified_at timestamptz,
  rewarded_at timestamptz,
  voided_at timestamptz
);
comment on table private.referrals is
  'Each friend who subscribed through a referral code, and what happened to the reward (ADR-0035).';
create index referrals_referrer on private.referrals (referrer_id);
create index referrals_transaction on private.referrals (transaction_id);
revoke all on table private.referrals from public, anon, authenticated;

-- Lookups of codes at checkout, for the rate limit (kept a day).
create table private.code_lookups (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index code_lookups_user_at on private.code_lookups (user_id, at);
revoke all on table private.code_lookups from public, anon, authenticated;

create function private.new_referral_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
    end loop;
    exit when not exists (select 1 from private.referral_codes where code = v_code);
  end loop;
  return v_code;
end;
$$;

/** The signed-in account's referral link and counts; creates its code on first use. */
create function public.my_referral()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not coalesce((private.setting('referrals_enabled'))::boolean, false) then
    return jsonb_build_object('enabled', false);
  end if;
  select code into v_code from private.referral_codes where user_id = v_user;
  if v_code is null then
    insert into private.referral_codes (user_id, code)
      values (v_user, private.new_referral_code())
      on conflict (user_id) do nothing;
    select code into v_code from private.referral_codes where user_id = v_user;
  end if;
  return jsonb_build_object(
    'enabled', true,
    'code', v_code,
    'percent', coalesce((private.setting('referral_percent'))::int, 50),
    'joined', (select count(*) from private.referrals r
                where r.referrer_id = v_user and r.status <> 'void'),
    'earned', (select count(*) from private.referrals r
                where r.referrer_id = v_user and r.status = 'rewarded' and r.reward <> 'not_needed'),
    'pending', (select count(*) from private.referrals r
                 where r.referrer_id = v_user and r.status in ('pending', 'qualified'))
  );
end;
$$;

/** A new code for the signed-in account; the old link stops working. */
create function public.rotate_referral_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text := private.new_referral_code();
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into private.referral_codes (user_id, code) values (v_user, v_code)
    on conflict (user_id) do update set code = excluded.code, created_at = now();
  return v_code;
end;
$$;

/**
 * What create-checkout should do with a code (service role only). A referral
 * code: whether this account can use it, and the discount to attach. Anything
 * else is 'unknown' (create-checkout then asks Paddle for a discount code).
 * More than 30 lookups an hour per account are refused.
 */
create function public.checkout_code(p_user uuid, p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_referrer uuid;
  v_friend_email text;
begin
  delete from private.code_lookups where at < now() - interval '1 day';
  if (select count(*) from private.code_lookups
       where user_id = p_user and at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('kind', 'rate_limited');
  end if;
  insert into private.code_lookups (user_id) values (p_user);

  if v_code !~ '^[2-9A-HJ-NP-Z]{8}$' then
    return jsonb_build_object('kind', 'unknown');
  end if;
  select user_id into v_referrer from private.referral_codes where code = v_code;
  if v_referrer is null then
    return jsonb_build_object('kind', 'unknown');
  end if;
  if not coalesce((private.setting('referrals_enabled'))::boolean, false) then
    return jsonb_build_object('kind', 'referral', 'eligible', false, 'reason', 'programme_off');
  end if;
  select email into v_friend_email from auth.users where id = p_user;
  if v_referrer = p_user
     or private.email_claim(v_friend_email) = private.email_claim((select email from auth.users where id = v_referrer)) then
    return jsonb_build_object('kind', 'referral', 'eligible', false, 'reason', 'own_code');
  end if;
  if exists (select 1 from private.referrals where friend_email_claim = private.email_claim(v_friend_email))
     or exists (select 1 from public.entitlements where user_id = p_user and provider_subscription_id is not null) then
    return jsonb_build_object('kind', 'referral', 'eligible', false, 'reason', 'not_first_purchase');
  end if;
  return jsonb_build_object(
    'kind', 'referral',
    'eligible', true,
    'code', v_code,
    'percent', coalesce((private.setting('referral_percent'))::int, 50),
    'discount_id', private.setting('referral_discount_id') #>> '{}'
  );
end;
$$;

/**
 * Records a friend's subscription through a referral code (service role, from
 * the webhook, before the event is applied). Returns 'recorded', 'void:<why>'
 * (kept so the owner can see it), 'duplicate' or 'unknown_code'.
 */
create function public.record_referral(
  p_code text,
  p_friend uuid,
  p_transaction_id text,
  p_subscription_id text,
  p_customer_id text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_referrer uuid;
  v_friend_email text;
  v_claim bytea;
  v_why text;
begin
  select user_id into v_referrer from private.referral_codes where code = v_code;
  if v_referrer is null then
    return 'unknown_code';
  end if;
  select email into v_friend_email from auth.users where id = p_friend;
  if v_friend_email is null then
    return 'unknown_friend';
  end if;
  v_claim := private.email_claim(v_friend_email);
  if exists (select 1 from private.referrals where friend_email_claim = v_claim) then
    return 'duplicate';
  end if;

  v_why := case
    when v_referrer = p_friend
      or v_claim = private.email_claim((select email from auth.users where id = v_referrer))
      then 'self-referral'
    when p_customer_id is not null and exists (
      select 1 from public.entitlements where user_id = v_referrer and provider_customer_id = p_customer_id)
      then 'same Paddle customer as the referrer'
    when exists (
      select 1 from public.entitlements where user_id = p_friend
         and provider_subscription_id is not null and provider_subscription_id <> coalesce(p_subscription_id, ''))
      then 'friend had paid before'
  end;

  insert into private.referrals (referrer_id, code, friend_id, friend_email_claim, friend_hint,
      transaction_id, subscription_id, customer_id, status, note, voided_at)
    values (v_referrer, v_code, p_friend, v_claim, private.email_hint(v_friend_email),
      p_transaction_id, p_subscription_id, p_customer_id,
      case when v_why is null then 'pending' else 'void' end, v_why,
      case when v_why is null then null else now() end)
  on conflict (friend_email_claim) do nothing;
  return case when v_why is null then 'recorded' else 'void:' || v_why end;
end;
$$;

/** A refund or chargeback of the friend's payment voids the referral (service role). */
create function public.void_referral(p_transaction_id text, p_reason text)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update private.referrals
     set status = 'void', voided_at = now(), note = left(p_reason, 300)
   where transaction_id = p_transaction_id and status in ('pending', 'qualified')
     and reward is distinct from 'paddle_month';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/** Gives a referrer a month as a dated grant, stacking on an earlier referral month. */
create function private.referral_grant(p_referrer uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g private.grants;
  v_end timestamptz;
begin
  select * into g from private.grants
   where user_id = p_referrer and revoked_at is null
   order by granted_at desc, id desc limit 1;
  if found and g.reason <> 'referral' then
    return 'not_needed'; -- already on another grant (team, tester…)
  end if;
  if found then
    v_end := greatest(g.expires_at, now()) + interval '30 days';
    update private.grants set expires_at = v_end where id = g.id;
    update public.entitlements set current_period_end = v_end where user_id = p_referrer;
  else
    v_end := now() + interval '30 days';
    insert into private.grants (user_id, reason, expires_at, note, granted_by)
      values (p_referrer, 'referral', v_end, 'Referral reward', 'referral');
    perform private.apply_grant(p_referrer, 'referral', v_end);
  end if;
  return 'grant_month';
end;
$$;

/**
 * The daily step (also runnable from the dashboard): referrals past the 14-day
 * refund window qualify; qualified ones are rewarded, at most 12 a year per
 * referrer. Paying referrers' months are left for the dashboard's job to apply
 * in Paddle (reward 'paddle_month', not yet rewarded).
 */
create function private.process_referrals()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r private.referrals;
  v_qualified int;
  v_granted int := 0;
  v_paddle int := 0;
  v_capped int := 0;
  v_result text;
begin
  update private.referrals set status = 'qualified', qualified_at = now()
   where status = 'pending' and created_at <= now() - interval '14 days';
  get diagnostics v_qualified = row_count;

  for r in select * from private.referrals
            where status = 'qualified' and reward is null
            order by qualified_at, id
  loop
    if r.referrer_id is null then
      update private.referrals set status = 'void', voided_at = now(), note = 'referrer deleted'
       where id = r.id;
    elsif (select count(*) from private.referrals x
            where x.referrer_id = r.referrer_id and x.status = 'rewarded'
              and x.rewarded_at > now() - interval '365 days'
              and x.reward <> 'not_needed') >= 12 then
      update private.referrals set status = 'capped', note = '12 rewards in a year' where id = r.id;
      v_capped := v_capped + 1;
    elsif exists (select 1 from public.entitlements e
                   where e.user_id = r.referrer_id and e.complimentary is null
                     and e.provider_subscription_id is not null
                     and e.status in ('active', 'past_due')) then
      update private.referrals set reward = 'paddle_month' where id = r.id;
      v_paddle := v_paddle + 1;
    else
      v_result := private.referral_grant(r.referrer_id);
      update private.referrals set status = 'rewarded', reward = v_result, rewarded_at = now()
       where id = r.id;
      v_granted := v_granted + 1;
    end if;
  end loop;
  return jsonb_build_object('qualified', v_qualified, 'granted', v_granted,
                            'awaiting_paddle', v_paddle, 'capped', v_capped);
end;
$$;

-- The dashboard's actions --------------------------------------------------------------

create function private.ops_admin_allowed(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_secret is not null and exists (
    select 1 from private.ops_admin_secret s
     where s.sha256 = extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'));
$$;

/** The end of a Sydney day (YYYY-MM-DD), or null. */
create function private.sydney_end_of_day(p_date text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_date, '') = '' then null
              else (p_date || ' 23:59:59')::timestamp at time zone 'Australia/Sydney' end;
$$;

/**
 * Everything the dashboard reads or changes here (ADR-0037). Every change is
 * logged in private.ops_audit with the Access-verified email as the actor.
 */
create function private.ops_admin(p_secret text, p_actor text, p_action text, p_args jsonb)
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
  r private.referrals;
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
      'last_change', (select to_jsonb(t) from (select at, actor, action, outcome from private.ops_audit
                                                order by at desc, id desc limit 1) t));

  -- Changing (logged) -----------------------------------------------------------------
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

-- The public entry point the Worker calls (publishable key + secret), like ops_stats.
create function public.ops_admin(p_secret text, p_actor text, p_action text, p_args jsonb)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.ops_admin(p_secret, p_actor, p_action, p_args);
$$;

-- Access ----------------------------------------------------------------------------------

revoke execute on function private.setting(text) from public, anon, authenticated;
revoke execute on function private.new_referral_code() from public, anon, authenticated;
revoke execute on function private.referral_grant(uuid) from public, anon, authenticated;
revoke execute on function private.process_referrals() from public, anon, authenticated;
revoke execute on function private.ops_admin_allowed(text) from public, anon, authenticated;
revoke execute on function private.sydney_end_of_day(text) from public, anon, authenticated;
revoke execute on function private.ops_admin(text, text, text, jsonb) from public, anon, authenticated;

revoke execute on function public.my_referral() from public, anon;
grant execute on function public.my_referral() to authenticated;
revoke execute on function public.rotate_referral_code() from public, anon;
grant execute on function public.rotate_referral_code() to authenticated;
revoke execute on function public.checkout_code(uuid, text) from public, anon, authenticated;
revoke execute on function public.record_referral(text, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.void_referral(text, text) from public, anon, authenticated;
revoke execute on function public.ops_admin(text, text, text, jsonb) from public, authenticated;
grant execute on function public.ops_admin(text, text, text, jsonb) to anon;

-- Referrals qualify and are rewarded daily (the dashboard's job applies Paddle months).
select cron.schedule('referrals-daily', '33 3 * * *', $$select private.process_referrals()$$);
