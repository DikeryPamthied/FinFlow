-- FinFlow: goals + lending, stored in the database so they sync across devices
-- (before this they lived only in each browser's local storage).
-- Run once: Supabase dashboard → SQL Editor → New query → paste this file → Run.
-- Safe to run again; it only adds what's missing and never deletes data.
-- After it's run, the app uploads any goals and loans still saved in a browser the next time that browser opens it.

create table if not exists public.goals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null,
  target_amount   numeric not null check (target_amount > 0),
  current_amount  numeric not null default 0 check (current_amount >= 0),
  color           text,
  created_at      timestamptz not null default now()
);

create index if not exists goals_user on public.goals (user_id, created_at desc);

alter table public.goals enable row level security;

drop policy if exists "Own goals" on public.goals;
create policy "Own goals" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.loans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null,
  amount          numeric not null check (amount > 0),
  repaid_amount   numeric not null default 0 check (repaid_amount >= 0),
  date            date not null,
  note            text,
  status          text not null default 'pending' check (status in ('pending', 'repaid')),
  created_at      timestamptz not null default now()
);

create index if not exists loans_user on public.loans (user_id, date desc);

alter table public.loans enable row level security;

drop policy if exists "Own loans" on public.loans;
create policy "Own loans" on public.loans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
