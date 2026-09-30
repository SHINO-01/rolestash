-- Launch list: people who asked rolestash.com to email them when Rolestash
-- launches (docs/guides/launch-list.md). Double opt-in: an address is only
-- emailed about the launch after its owner clicks the confirmation link.
-- Unsubscribing deletes the row, and the launch email is the last one we
-- send, after which the whole list is deleted. Only the launch-list Edge
-- Function (service role) touches this table.

create table public.launch_subscribers (
  email text primary key
    check (email = lower(btrim(email)) and length(email) between 3 and 254 and email like '%_@_%'),
  plan text check (plan in ('free', 'pro', 'advanced')),
  -- Unguessable; carried only in the emails we send to this address.
  token uuid not null unique default gen_random_uuid(),
  confirmed_at timestamptz,
  confirmations_sent int not null default 0,
  last_confirmation_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.launch_subscribers enable row level security;
-- No policies: clients can't read or write it. The service role bypasses RLS.
revoke all on table public.launch_subscribers from public, anon, authenticated;

/**
 * Adds (or refreshes) a signup and says whether to send a confirmation email.
 * Limits keep the form from being used to flood someone's inbox:
 *  - at most 3 confirmation emails per address, 10 minutes apart;
 *  - at most 30 confirmation emails per hour in total;
 *  - confirmed addresses never get another confirmation.
 * Unconfirmed signups older than 30 days are forgotten.
 */
create function public.launch_signup(p_email text, p_plan text)
returns table (send boolean, token uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_plan text := case when p_plan in ('free', 'pro', 'advanced') then p_plan end;
  v_row public.launch_subscribers;
begin
  delete from public.launch_subscribers
    where confirmed_at is null and created_at < now() - interval '30 days';

  insert into public.launch_subscribers (email, plan) values (v_email, v_plan)
    on conflict (email) do nothing;
  select * into v_row from public.launch_subscribers s where s.email = v_email for update;

  if v_row.confirmed_at is not null then
    update public.launch_subscribers s set plan = coalesce(v_plan, s.plan) where s.email = v_email;
    return query select false, v_row.token;
    return;
  end if;

  if v_row.confirmations_sent >= 3
     or v_row.last_confirmation_at > now() - interval '10 minutes'
     or (select count(*) from public.launch_subscribers s
           where s.last_confirmation_at > now() - interval '1 hour') >= 30 then
    return query select false, v_row.token;
    return;
  end if;

  update public.launch_subscribers s
    set confirmations_sent = s.confirmations_sent + 1,
        last_confirmation_at = now(),
        plan = coalesce(v_plan, s.plan)
    where s.email = v_email;
  return query select true, v_row.token;
end;
$$;

/** Confirms a signup. `newly` is false when it was already confirmed. */
create function public.launch_confirm(p_token uuid)
returns table (email text, plan text, newly boolean)
language sql
set search_path = ''
as $$
  with target as (
    select s.email, s.confirmed_at is null as newly
      from public.launch_subscribers s where s.token = p_token for update
  ), done as (
    update public.launch_subscribers s set confirmed_at = coalesce(s.confirmed_at, now())
      from target where s.email = target.email
      returning s.email, s.plan, target.newly
  )
  select done.email, done.plan, done.newly from done;
$$;

/** Unsubscribes by deleting the address. True if there was one to delete. */
create function public.launch_unsubscribe(p_token uuid)
returns boolean
language sql
set search_path = ''
as $$
  with gone as (delete from public.launch_subscribers s where s.token = p_token returning 1)
  select exists (select 1 from gone);
$$;

revoke execute on function public.launch_signup(text, text) from public, anon, authenticated;
revoke execute on function public.launch_confirm(uuid) from public, anon, authenticated;
revoke execute on function public.launch_unsubscribe(uuid) from public, anon, authenticated;
grant execute on function public.launch_signup(text, text) to service_role;
grant execute on function public.launch_confirm(uuid) to service_role;
grant execute on function public.launch_unsubscribe(uuid) to service_role;
grant select, delete on table public.launch_subscribers to service_role;
