-- Saving the profile is an upsert (PostgREST: INSERT … ON CONFLICT (user_id)
-- DO UPDATE SET user_id = EXCLUDED.user_id, …), and Postgres requires UPDATE
-- on every column in that SET, user_id included, even when nothing conflicts.
-- Without it every save failed. RLS (user_id = auth.uid() on both USING and
-- WITH CHECK) still keeps each user to their own row.
grant update (user_id) on table public.account_profiles to authenticated;
