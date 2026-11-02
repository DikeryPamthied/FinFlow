-- Moves between any two places money sits: savings, needs, wants, the emergency fund and investments.
-- Run once in the Supabase SQL editor. Safe to run again; no rows are changed or deleted.
-- (Supabase warns about "drop constraint" below: it only replaces the rule for which places are allowed.)

-- Where a move came from. Moves made before this all came out of savings.
alter table public.savings_transfers add column if not exists source text not null default 'Savings';

alter table public.savings_transfers drop constraint if exists savings_transfers_destination_check;
alter table public.savings_transfers add constraint savings_transfers_destination_check
  check (destination in ('Savings', 'Needs', 'Wants', 'Emergency', 'Investment'));

alter table public.savings_transfers drop constraint if exists savings_transfers_source_check;
alter table public.savings_transfers add constraint savings_transfers_source_check
  check (source in ('Savings', 'Needs', 'Wants', 'Emergency', 'Investment') and source <> destination);
