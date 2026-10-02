-- Account profile (ADR-0022): a display name, a small avatar picture and the
-- "Help improve automatic updates" preference, chosen when the account is set
-- up. One row per account, readable and writable only by its owner.
--
-- The avatar is a 128-pixel picture resized on the device and stored inline
-- as a data: URL (about 10 KB), so it needs no storage bucket and is never
-- loaded from a third party (such as Google's photo servers).

create table public.account_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (
    display_name is null
    or (length(btrim(display_name)) between 1 and 50 and display_name !~ '[[:cntrl:]]')
  ),
  avatar text check (
    avatar is null
    or (avatar ~ '^data:image/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'
        and octet_length(avatar) <= 60000)
  ),
  share_learning boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.account_profiles enable row level security;
create policy "Users read their own profile" on public.account_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users create their own profile" on public.account_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users update their own profile" on public.account_profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on table public.account_profiles from public, anon, authenticated;
grant select on table public.account_profiles to authenticated;
-- Sharing changes go through set_email_sharing(), which also withdraws votes.
grant insert (user_id, display_name, avatar, updated_at) on table public.account_profiles to authenticated;
grant update (display_name, avatar, updated_at) on table public.account_profiles to authenticated;

-- set_email_sharing() now also works before the inbox exists (at sign-up),
-- and remembers the choice for when it's created ---------------------------------

create or replace function private.set_email_sharing(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  insert into public.account_profiles (user_id, share_learning) values (v_uid, p_on)
    on conflict (user_id) do update set share_learning = excluded.share_learning, updated_at = now();
  update public.email_inboxes set share_learning = p_on where user_id = v_uid;
  if not p_on then
    delete from private.email_knowledge_votes where voter = private.knowledge_voter(v_uid);
  end if;
  return jsonb_build_object('ok', true, 'share_learning', p_on);
end;
$$;

create or replace function private.my_inbox()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.email_inboxes;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if private.plan_tier_of(v_uid) <> 'advanced' then
    return jsonb_build_object('ok', false, 'reason', 'plan_required');
  end if;
  -- A new inbox starts with the choice made when the account was set up.
  insert into public.email_inboxes (user_id, address_token, share_learning)
    values (
      v_uid,
      private.new_address_token(),
      coalesce((select p.share_learning from public.account_profiles p where p.user_id = v_uid), true))
    on conflict (user_id) do nothing;
  update public.email_inboxes set paused_at = null where user_id = v_uid and paused_at is not null;
  select * into v_row from public.email_inboxes where user_id = v_uid;
  return jsonb_build_object(
    'ok', true,
    'address', v_row.address_token || '@in.rolestash.com',
    'created_at', v_row.created_at,
    'rotated_at', v_row.rotated_at,
    'share_learning', v_row.share_learning);
end;
$$;
