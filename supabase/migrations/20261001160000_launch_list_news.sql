-- The launch list becomes an updates list (docs/guides/launch-list.md):
-- confirmed addresses are kept after launch for occasional product news,
-- until their owner unsubscribes (which deletes the row). Each send is a
-- named campaign; recording the last campaign per address makes a retried
-- send skip everyone who already got it.

alter table public.launch_subscribers
  add column last_campaign text,
  add column last_sent_at timestamptz;

/** Records that a campaign reached these addresses. */
create function public.launch_mark_sent(p_campaign text, p_tokens uuid[])
returns void
language sql
set search_path = ''
as $$
  update public.launch_subscribers s
    set last_campaign = p_campaign, last_sent_at = now()
    where s.token = any (p_tokens);
$$;

revoke execute on function public.launch_mark_sent(text, uuid[]) from public, anon, authenticated;
grant execute on function public.launch_mark_sent(text, uuid[]) to service_role;
