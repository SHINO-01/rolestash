-- "Help improve automatic updates" (ADR-0022) is stored twice: on the account
-- profile (the choice made at sign-up and in Account) and on the email inbox
-- (copied when the inbox is made). Voting read only the inbox, so an account
-- that had switched sharing off but had no inbox yet, or whose two copies
-- disagreed, could still vote. Now a "no" in either place means no.

create function private.shares_learning(p_uid uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select p.share_learning from public.account_profiles p where p.user_id = p_uid), true)
     and coalesce((select i.share_learning from public.email_inboxes i where i.user_id = p_uid), true)
$$;
revoke execute on function private.shares_learning(uuid) from public, anon, authenticated;

-- Same signature and grants as before (create or replace keeps them); the
-- only change is the sharing check.
create or replace function private.vote_email_knowledge(p_votes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_voter bytea;
  v_vote jsonb;
  v_count int := 0;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if private.plan_tier_of(v_uid) <> 'advanced'
     or exists (select 1 from public.entitlements e where e.user_id = v_uid and e.status = 'trialing') then
    return jsonb_build_object('ok', false, 'reason', 'plan_required');
  end if;
  if not private.shares_learning(v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'sharing_off');
  end if;
  if jsonb_typeof(p_votes) <> 'array' or jsonb_array_length(p_votes) > 20 then
    raise exception 'send up to 20 votes at a time' using errcode = '22023';
  end if;

  v_voter := private.knowledge_voter(v_uid);
  perform pg_advisory_xact_lock(hashtext('knowledge:' || encode(v_voter, 'hex')));
  if (select count(*) from private.email_knowledge_votes
        where voter = v_voter and created_at > now() - interval '1 day')
     + jsonb_array_length(p_votes) > 100 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  for v_vote in select * from jsonb_array_elements(p_votes) loop
    insert into private.email_knowledge_votes as k (kind, key, value, voter)
      values (v_vote->>'kind', lower(v_vote->>'key'), v_vote->>'value', v_voter)
      on conflict (kind, key, voter) do update
        set value = excluded.value, created_at = now()
        where k.value is distinct from excluded.value;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('ok', true, 'recorded', v_count);
end;
$$;

-- Make the two copies agree, keeping any "no": that's what the person chose
-- last in at least one place, and voting is the only thing it controls.
update public.account_profiles p set share_learning = false, updated_at = now()
  where p.share_learning
    and exists (select 1 from public.email_inboxes i where i.user_id = p.user_id and not i.share_learning);
update public.email_inboxes i set share_learning = false
  where i.share_learning
    and exists (select 1 from public.account_profiles p where p.user_id = i.user_id and not p.share_learning);

-- Withdraw any votes from accounts that have sharing off.
delete from private.email_knowledge_votes
  where voter in (
    select private.knowledge_voter(p.user_id) from public.account_profiles p where not p.share_learning);
