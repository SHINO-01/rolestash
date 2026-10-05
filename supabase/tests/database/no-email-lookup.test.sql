-- Run with: npm run test:db  (needs Docker; see docs/guides/backend.md)
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

-- ADR-0027: accounts are never looked up by email for purchases.
select hasnt_function('public', 'user_id_for_email', array['text'], 'no public email lookup');
select hasnt_function('private', 'user_id_for_email', array['text'], 'no private email lookup');

select * from finish();
rollback;
