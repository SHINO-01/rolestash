-- Indexes for two foreign keys the database advisor flagged: deleting an
-- account (on delete set null / cascade) would otherwise scan these tables.

create index if not exists bug_reports_user_id on public.bug_reports (user_id);
create index if not exists referrals_friend on private.referrals (friend_id);
