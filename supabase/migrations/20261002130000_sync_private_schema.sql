-- Security advisor follow-up (lint 0029) for sync (ADR-0016). The privileged
-- sync functions move to a `private` schema that the Data API doesn't expose;
-- the public RPCs become thin SECURITY INVOKER wrappers. Same behaviour, and
-- nothing privileged is reachable straight from /rest/v1/rpc.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.register_device(uuid, text, text) set schema private;
alter function public.push_jobs(uuid, jsonb) set schema private;
alter function public.pull_jobs(uuid, bigint, int) set schema private;
alter function public.sync_device_ok(uuid) set schema private;
alter function public.device_allowance(text, text) set schema private;
alter function public.synced_jobs_cap() set schema private;

-- Moved functions keep their bodies, which name public.* helpers; repoint them.
create or replace function private.sync_device_ok(p_device uuid)
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
      and private.device_allowance(public.plan_tier(), d.kind) > 0
  );
$$;

create or replace function private.register_device(p_id uuid, p_name text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tier text := public.plan_tier();
  v_limit int := private.device_allowance(v_tier, p_kind);
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

create or replace function private.push_jobs(p_device uuid, p_changes jsonb)
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
  if not private.sync_device_ok(p_device) then
    raise exception 'sync not allowed for this device' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 500 then
    raise exception 'send up to 500 changes at a time' using errcode = '22023';
  end if;

  for v_change in select * from jsonb_array_elements(p_changes) loop
    if not exists (select 1 from public.synced_jobs where user_id = v_uid and job_id = v_change->>'id')
       and (select count(*) from public.synced_jobs where user_id = v_uid) >= private.synced_jobs_cap() then
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

create or replace function private.pull_jobs(p_device uuid, p_after bigint, p_limit int default 500)
returns table (job_id text, data jsonb, deleted boolean, updated_at timestamptz, revision bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.sync_device_ok(p_device) then
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

-- Public RPCs: unprivileged wrappers (same names and arguments as before).
create function public.register_device(p_id uuid, p_name text, p_kind text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.register_device(p_id, p_name, p_kind) $$;

create function public.push_jobs(p_device uuid, p_changes jsonb)
returns int language sql security invoker set search_path = ''
as $$ select private.push_jobs(p_device, p_changes) $$;

create function public.pull_jobs(p_device uuid, p_after bigint, p_limit int default 500)
returns table (job_id text, data jsonb, deleted boolean, updated_at timestamptz, revision bigint)
language sql stable security invoker set search_path = ''
as $$ select * from private.pull_jobs(p_device, p_after, p_limit) $$;

revoke execute on all functions in schema private from public, anon;
grant execute on function private.register_device(uuid, text, text) to authenticated;
grant execute on function private.push_jobs(uuid, jsonb) to authenticated;
grant execute on function private.pull_jobs(uuid, bigint, int) to authenticated;
revoke execute on function public.register_device(uuid, text, text) from public, anon;
revoke execute on function public.push_jobs(uuid, jsonb) from public, anon;
revoke execute on function public.pull_jobs(uuid, bigint, int) from public, anon;
grant execute on function public.register_device(uuid, text, text) to authenticated;
grant execute on function public.push_jobs(uuid, jsonb) to authenticated;
grant execute on function public.pull_jobs(uuid, bigint, int) to authenticated;
