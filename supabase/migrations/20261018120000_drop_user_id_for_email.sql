-- Website purchases are no longer matched to accounts by email (ADR-0027):
-- buyers sign in before checkout, and the billing webhook never looks an
-- account up by email. Nothing calls user_id_for_email() any more, so it goes.
-- The service role keeps its usage on schema private (other functions use it).

drop function public.user_id_for_email(text);
drop function private.user_id_for_email(text);
