-- Supabase → SQL Editor → выполните целиком

drop table if exists finance_vault;

create table finance_vault (
  id text primary key default 'main',
  salt text not null,
  ciphertext text not null,
  updated_at timestamptz default now()
);

alter table finance_vault enable row level security;

create policy "vault_anon_access"
  on finance_vault for all
  using (true)
  with check (true);
