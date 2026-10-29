-- Salary split: savings first, then needs and wants as wallets that roll over month to month.
-- Run once in the Supabase SQL editor. Safe to run again.

-- Plan: % of each salary (after tithe) kept as savings, and the needs % of what's left to spend.
alter table public.budget_settings add column if not exists savings_pct numeric check (savings_pct between 0 and 100);
alter table public.budget_settings add column if not exists needs_share numeric check (needs_share between 0 and 100);

-- Each salary remembers how it was split, so changing the plan later doesn't rewrite past months.
alter table public.salary_entries add column if not exists wants_alloc numeric;
alter table public.salary_entries add column if not exists savings_alloc numeric;
alter table public.salary_entries add column if not exists needs_alloc numeric;

-- When a salary pays back overspending, which wallet it comes from: both equally, needs only, or wants only.
alter table public.salary_entries add column if not exists repay_from text check (repay_from in ('both', 'need', 'want'));
