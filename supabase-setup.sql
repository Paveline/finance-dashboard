-- Выполните в Supabase: SQL Editor → New query → Run

create table if not exists finance_vault (
  user_id uuid primary key references auth.users(id) on delete cascade,
  salt text not null,
  ciphertext text not null,
  updated_at timestamptz default now()
);

alter table finance_vault enable row level security;

create policy "vault_select_own"
  on finance_vault for select
  using (auth.uid() = user_id);

create policy "vault_insert_own"
  on finance_vault for insert
  with check (auth.uid() = user_id);

create policy "vault_update_own"
  on finance_vault for update
  using (auth.uid() = user_id);
