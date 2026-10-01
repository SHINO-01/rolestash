-- Sync (ADR-0016). Devices with per-plan limits, and synced jobs with
-- last-writer-wins and a revision cursor. Every write goes through the
-- security-definer functions below, which check the plan and the device;
-- clients can read only their own rows, and only on a paid plan.

-- Devices ---------------------------------------------------------------------

create table public.devices (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  kind text not null check (kind in ('computer', 'web')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index devices_user_id_idx on public.devices (user_id);

alter table public.devices enable row level security;
create policy "Users read their own devices" on public.devices
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users remove their own devices" on public.devices
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on table public.devices from anon;
grant select, delete on table public.devices to authenticated;

/** How many devices a plan may sync, and whether it may use the web board. */
create function public.device_allowance(p_tier text, p_kind text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when p_tier = 'advanced' then 5
    when p_tier = 'pro' and p_kind = 'computer' then 3
    else 0
  end;
$$;

/**
 * Registers (or refreshes) the calling user's device. Returns
 * { ok: true } or { ok: false, reason, limit }.
 */
create function public.register_device(p_id uuid, p_name text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tier text := public.plan_tier();
  v_limit int := public.device_allowance(v_tier, p_kind);
  v_owner uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtext('devices:' || v_uid::text));

  select user_id into v_owner from public.devices where id = p_id;
  if v_owner is not null and v_owner <> v_uid then
    raise exception 'device id in use' using errcode = '23505';
  end if;
  if v_owner = v_uid then
    update public.devices
      set name = left(btrim(p_name), 80), last_seen_at = now()
      where id = p_id;
    return jsonb_build_object('ok', true);
  end if;

  if v_limit = 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', case when p_kind = 'web' and v_tier = 'pro' then 'web_board_advanced' else 'plan_required' end,
      'limit', 0);
  end if;
  if (select count(*) from public.devices where user_id = v_uid) >= v_limit then
    return jsonb_build_object('ok', false, 'reason', 'device_limit', 'limit', v_limit);
  end if;

  insert into public.devices (id, user_id, name, kind)
    values (p_id, v_uid, left(btrim(p_name), 80), p_kind);
  return jsonb_build_object('ok', true);
end;
$$;

/** The caller's registered device, if its plan still allows it to sync. */
create function public.sync_device_ok(p_device uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.devices d
    where d.id = p_device
      and d.user_id = (select auth.uid())
      and public.device_allowance(public.plan_tier(), d.kind) > 0
  );
$$;

-- Synced jobs --------------------------------------------------------------------

create sequence public.synced_revision;

create table public.synced_jobs (
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id text not null check (length(job_id) between 1 and 100),
  data jsonb check (data is null or octet_length(data::text) <= 400000),
  deleted boolean not null default false,
  updated_at timestamptz not null,
  revision bigint not null default nextval('public.synced_revision'),
  device_id uuid,
  primary key (user_id, job_id)
);
create index synced_jobs_cursor_idx on public.synced_jobs (user_id, revision);

alter table public.synced_jobs enable row level security;
-- Reads and writes go through pull_jobs / push_jobs only.
revoke all on table public.synced_jobs from public, anon, authenticated;

/** Max rows one board may keep (jobs, tombstones and settings). */
create function public.synced_jobs_cap() returns int language sql immutable set search_path = '' as $$ select 5000 $$;

/**
 * Applies changes [{ id, updatedAt, deleted?, data? }]; a change wins only
 * when its updatedAt is newer than the stored one. Returns how many applied.
 */
create function public.push_jobs(p_device uuid, p_changes jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_change jsonb;
  v_applied int := 0;
  v_count int;
begin
  if not public.sync_device_ok(p_device) then
    raise exception 'sync not allowed for this device' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 500 then
    raise exception 'send up to 500 changes at a time' using errcode = '22023';
  end if;

  for v_change in select * from jsonb_array_elements(p_changes) loop
    if not exists (select 1 from public.synced_jobs where user_id = v_uid and job_id = v_change->>'id')
       and (select count(*) from public.synced_jobs where user_id = v_uid) >= public.synced_jobs_cap() then
      raise exception 'too many synced jobs' using errcode = '54000';
    end if;
    insert into public.synced_jobs as s (user_id, job_id, data, deleted, updated_at, device_id)
      values (
        v_uid,
        v_change->>'id',
        case when coalesce((v_change->>'deleted')::boolean, false) then null else v_change->'data' end,
        coalesce((v_change->>'deleted')::boolean, false),
        (v_change->>'updatedAt')::timestamptz,
        p_device)
      on conflict (user_id, job_id) do update
        set data = excluded.data,
            deleted = excluded.deleted,
            updated_at = excluded.updated_at,
            device_id = excluded.device_id,
            revision = nextval('public.synced_revision')
        where s.updated_at < excluded.updated_at;
    get diagnostics v_count = row_count;
    v_applied := v_applied + v_count;
  end loop;

  update public.devices set last_seen_at = now() where id = p_device;
  return v_applied;
end;
$$;

/** Rows changed after revision `p_after`, oldest first. */
create function public.pull_jobs(p_device uuid, p_after bigint, p_limit int default 500)
returns table (job_id text, data jsonb, deleted boolean, updated_at timestamptz, revision bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.sync_device_ok(p_device) then
    raise exception 'sync not allowed for this device' using errcode = '42501';
  end if;
  return query
    select s.job_id, s.data, s.deleted, s.updated_at, s.revision
    from public.synced_jobs s
    where s.user_id = (select auth.uid()) and s.revision > p_after
    order by s.revision
    limit least(greatest(p_limit, 1), 500);
end;
$$;

revoke execute on function public.device_allowance(text, text) from public, anon;
revoke execute on function public.register_device(uuid, text, text) from public, anon;
revoke execute on function public.sync_device_ok(uuid) from public, anon, authenticated;
revoke execute on function public.push_jobs(uuid, jsonb) from public, anon;
revoke execute on function public.pull_jobs(uuid, bigint, int) from public, anon;
revoke execute on function public.synced_jobs_cap() from public, anon, authenticated;
grant execute on function public.register_device(uuid, text, text) to authenticated;
grant execute on function public.push_jobs(uuid, jsonb) to authenticated;
grant execute on function public.pull_jobs(uuid, bigint, int) to authenticated;
