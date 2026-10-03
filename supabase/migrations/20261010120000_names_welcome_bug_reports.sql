-- Names, the welcome email and bug reports (ADR-0024).
--
-- 1. account_profiles.display_name is the account's full name again (the
--    name on Google, or what the person typed once), shown in Account and
--    sent to Paddle for receipts. Legal names can run past 50 characters.
-- 2. account_profiles.welcome_sent_at: when the welcome email went out.
--    Written only by the welcome function (service role); clients have no
--    grant on it, so it can't be reset to send the email again.
-- 3. bug_reports: what people send from "Report a problem". Written only by
--    the bug-report function; nobody reads it through the API. Rows lose
--    their account link when the account is deleted, and the function
--    deletes reports older than 12 months.

alter table public.account_profiles
  drop constraint if exists account_profiles_display_name_check;
alter table public.account_profiles
  add constraint account_profiles_display_name_check check (
    display_name is null
    or (length(btrim(display_name)) between 1 and 100 and display_name !~ '[[:cntrl:]]')
  );

alter table public.account_profiles add column welcome_sent_at timestamptz;
-- Column grants stay as they were: clients may write display_name, avatar
-- and updated_at only (and user_id for upserts).

create table public.bug_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  contact_email text check (
    contact_email is null or (length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+$')
  ),
  message text not null check (length(btrim(message)) between 1 and 5000),
  context jsonb not null default '{}'::jsonb check (octet_length(context::text) <= 4000),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'new' check (status in ('new', 'seen', 'fixed', 'closed'))
);

create index bug_reports_ip_recent on public.bug_reports (ip_hash, created_at);

alter table public.bug_reports enable row level security;
-- No policies: only the service role (the bug-report function) touches it.
revoke all on table public.bug_reports from public, anon, authenticated;
