-- Security advisor follow-up (lint 0029). has_pro() only reads the caller's
-- own entitlement, which RLS already allows, so it doesn't need to run with
-- the owner's rights. Internal helpers are not part of the client API.

alter function public.has_pro() security invoker;

revoke execute on function public.email_sha256(text) from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
