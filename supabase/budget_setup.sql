-- FinFlow: budget plan + savings moves
-- Run once: Supabase dashboard → SQL Editor → New query → paste this file → Run.
-- Safe to run again; it only adds what's missing and never deletes data.

-- Each person's plan: optional tithe, and needs / wants spending limits (% of salary)
create table if not exists public.budget_settings (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  tithe_on     boolean not null default true,
  tithe_pct    numeric not null default 10 check (tithe_pct >= 0 and tithe_pct <= 100),
  needs_pct    numeric not null default 50 check (needs_pct >= 0 and needs_pct <= 100),
  wants_pct    numeric not null default 30 check (wants_pct >= 0 and wants_pct <= 100),
  updated_at   timestamptz not null default now()
);

alter table public.budget_settings enable row level security;

drop policy if exists "Own budget settings" on public.budget_settings;
create policy "Own budget settings" on public.budget_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Money moved out of savings into the emergency fund or investments
create table if not exists public.savings_transfers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date         date not null,
  amount       numeric not null check (amount > 0),
  destination  text not null check (destination in ('Emergency', 'Investment')),
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists savings_transfers_user_date on public.savings_transfers (user_id, date desc);

alter table public.savings_transfers enable row level security;

drop policy if exists "Own savings transfers" on public.savings_transfers;
create policy "Own savings transfers" on public.savings_transfers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Expenses are now marked as a need or a want. Existing expenses count as wants.
alter table public.expenses add column if not exists kind text not null default 'want';
alter table public.expenses drop constraint if exists expenses_kind_check;
alter table public.expenses add constraint expenses_kind_check check (kind in ('need', 'want'));

-- New salaries are stored with savings_tag 'Salary'. Remove an old restriction on that column if one exists.
alter table public.salary_entries drop constraint if exists salary_entries_savings_tag_check;
