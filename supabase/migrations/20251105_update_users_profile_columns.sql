-- Drop legacy JSON column and ensure explicit profile fields exist
alter table if exists public.users
  drop column if exists profile_data;

alter table if exists public.users
  add column if not exists strength_1 text;

alter table if exists public.users
  add column if not exists strength_2 text;

alter table if exists public.users
  add column if not exists strength_3 text;

alter table if exists public.users
  add column if not exists strength_4 text;

alter table if exists public.users
  add column if not exists strength_5 text;

alter table if exists public.users
  add column if not exists age text;

alter table if exists public.users
  add column if not exists gender text;

alter table if exists public.users
  add column if not exists hometown text;
