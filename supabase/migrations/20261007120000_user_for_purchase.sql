-- Purchases made on rolestash.com/pricing/ (not from the extension) carry no
-- user id. The billing webhook then finds the account by the Paddle
-- customer's email, creating one if needed, so "buy on the website, sign in
-- with the same email" just works. Only the service role (Edge Functions)
-- may look accounts up this way.

create function private.user_id_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
$$;

create function public.user_id_for_email(p_email text)
returns uuid language sql stable security invoker set search_path = ''
as $$ select private.user_id_for_email(p_email) $$;

revoke execute on function private.user_id_for_email(text) from public, anon, authenticated;
revoke execute on function public.user_id_for_email(text) from public, anon, authenticated;
grant execute on function private.user_id_for_email(text) to service_role;
grant execute on function public.user_id_for_email(text) to service_role;
grant usage on schema private to service_role;
