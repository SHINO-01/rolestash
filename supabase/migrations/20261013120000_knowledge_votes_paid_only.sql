-- Shared-learning votes come from paying Advanced accounts only (ADR-0019:
-- "Poisoning takes several paying accounts"). Since the 14-day Advanced
-- trial (20261006120000_advanced_trial.sql), plan_tier_of() reports every
-- new sign-up as 'advanced', so a few free, card-less sign-ups could decide
-- how everyone's forwarded mail is read. A trial still gets email updates
-- and applies shared knowledge; it just doesn't vote.

-- Same signature and grants as before (create or replace keeps them); the
-- only change is the trial check next to plan_tier_of().
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
  if not coalesce((select share_learning from public.email_inboxes where user_id = v_uid), true) then
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

-- Withdraw the votes trial accounts already cast. An account still on
-- 'trialing' isn't paying, so every vote it holds was cast on the trial.
delete from private.email_knowledge_votes
  where voter in (
    select private.knowledge_voter(e.user_id)
    from public.entitlements e
    where e.status = 'trialing');
