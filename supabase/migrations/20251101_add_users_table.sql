-- users テーブル追加と既存テーブルの外部キー整備
create table if not exists public.users (
  id uuid primary key default uuid_generate_v4(),
  email text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.sessions
  add constraint sessions_user_id_fkey
  foreign key (user_id) references public.users(id) on delete set null;

alter table if exists public.strength_profiles
  add constraint strength_profiles_user_id_fkey
  foreign key (user_id) references public.users(id) on delete set null;
