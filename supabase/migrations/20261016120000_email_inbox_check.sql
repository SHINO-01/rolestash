-- The email Worker asks whether an address would take mail before it parses
-- or analyses anything (ADR-0018), so mail to unknown, paused or rate-limited
-- addresses costs no CPU. Same secret and rules as ingest_email_event, which
-- still checks everything itself when the event arrives.

create function private.email_inbox_check(p_secret text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inbox public.email_inboxes;
begin
  if p_secret is null or not exists (
    select 1 from private.email_ingest_secret s
    where s.sha256 = extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_inbox from public.email_inboxes where address_token = lower(p_token);
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown_address'); end if;

  if private.plan_tier_of(v_inbox.user_id) <> 'advanced' then
    update public.email_inboxes set paused_at = coalesce(paused_at, now()) where user_id = v_inbox.user_id;
    return jsonb_build_object('ok', false, 'reason', 'not_advanced');
  end if;

  if (select count(*) from public.email_events
        where user_id = v_inbox.user_id and created_at > now() - interval '1 hour') >= 30
     or (select count(*) from public.email_events
        where user_id = v_inbox.user_id and created_at > now() - interval '1 day') >= 200 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.email_inbox_check(p_secret text, p_token text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.email_inbox_check(p_secret, p_token) $$;

-- The Worker calls with the publishable key (anon) plus its ingest secret.
revoke execute on function private.email_inbox_check(text, text) from public, anon, authenticated;
grant execute on function private.email_inbox_check(text, text) to anon;
revoke execute on function public.email_inbox_check(text, text) from public, anon, authenticated;
grant execute on function public.email_inbox_check(text, text) to anon;
