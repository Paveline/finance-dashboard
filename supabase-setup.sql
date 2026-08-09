-- Supabase → SQL Editor → New query → Run
-- Если таблица уже была создана раньше — сначала выполните:
-- drop table if exists finance_vault;

create table if not exists finance_vault (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"projects":[],"works":[],"staff":[]}'::jsonb,
  updated_at timestamptz default now()
);

alter table finance_vault enable row level security;

drop policy if exists "vault_select_own" on finance_vault;
drop policy if exists "vault_insert_own" on finance_vault;
drop policy if exists "vault_update_own" on finance_vault;

create policy "vault_select_own"
  on finance_vault for select
  using (auth.uid() = user_id);

create policy "vault_insert_own"
  on finance_vault for insert
  with check (auth.uid() = user_id);

create policy "vault_update_own"
  on finance_vault for update
  using (auth.uid() = user_id);
