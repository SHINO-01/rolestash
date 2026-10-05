-- Shared learning counts only voters who could vote today (ADR-0019). Votes
-- used to count forever, so accounts that paid once kept deciding after
-- they lapsed. A vote now counts while its voter holds a paid Advanced plan:
-- plan_tier_of()'s rule without the trial branch. A subscription cancelled
-- at period end ('canceled' with a future current_period_end) still counts,
-- and a lapsed voter's votes count again if they resubscribe.
--
-- Voters are HMACs of user ids, so the eligible set is computed by hashing
-- the paid Advanced accounts, once per lookup.

create function private.knowledge_eligible_voters()
returns setof bytea
language sql
stable
security definer
set search_path = ''
as $$
  select private.knowledge_voter(e.user_id)
  from public.entitlements e
  where e.tier = 'advanced'
    and (
      (e.status in ('active', 'past_due') and e.current_period_end + interval '3 days' > now())
      or (e.status = 'canceled' and e.current_period_end > now())
    );
$$;

-- Same signature and grants as before; the only change is the voter filter.
create or replace function private.knowledge_lookup(p_kind text, p_key text)
returns table (value text, decides boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible as (
    select voter from private.knowledge_eligible_voters() as voter
  ), tally as (
    select v.value, count(*) as n
    from private.email_knowledge_votes v
    where v.kind = p_kind and v.key = p_key
      and v.voter in (select voter from eligible)
      and not exists (select 1 from private.email_knowledge_blocked b where b.kind = p_kind and b.key = p_key)
    group by v.value
  ), ranked as (
    select t.value, t.n, row_number() over (order by t.n desc, t.value) as r from tally t
  )
  select top.value, top.n >= 3 * coalesce((select n from ranked where r = 2), 0)
  from ranked top
  where top.r = 1 and top.n >= 3;
$$;

revoke execute on function private.knowledge_eligible_voters() from public, anon, authenticated;
