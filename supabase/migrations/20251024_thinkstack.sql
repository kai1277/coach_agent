-- ============ 基本拡張 ============
create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- ============ 既存テーブルの拡張 ============
alter table if exists public.sessions
  add column if not exists subject_profile_id uuid,
  add column if not exists status text default 'active',
  add column if not exists asked_count integer default 0,
  add column if not exists max_questions integer default 8,
  add column if not exists next_step jsonb;

alter table if exists public.turns
  add column if not exists hypothesis jsonb,
  add column if not exists posterior jsonb,
  add column if not exists question_id text,
  add column if not exists meta jsonb;

-- ============ 1) 被験者プロフィール ============
create table if not exists public.strength_profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid,
  top5 jsonb not null,               -- ["Woo","Analytical",...]
  basic jsonb,                       -- {"years_exp":1,"role":"営業",...}
  embedding vector(1536),
  created_at timestamp with time zone default now()
);

create index if not exists strength_profiles_embed_idx
  on public.strength_profiles using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============ 2) Casebook カード ============
create table if not exists public.casebook_cards (
  id text primary key,
  title text,
  conditions jsonb,
  hypotheses jsonb,
  probes jsonb,
  management_tips jsonb,
  evidence_snippets jsonb,
  tags jsonb,
  raw_yaml text,
  embedding vector(1536),
  updated_by text,
  version int default 1,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists casebook_cards_embed_idx
  on public.casebook_cards using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============ 3) Question Templates ============
create table if not exists public.question_templates (
  id text primary key,
  goal text,
  template text,
  when_to_use jsonb,
  followups jsonb,
  tags jsonb,
  embedding vector(1536),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists question_templates_embed_idx
  on public.question_templates using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============ 4) Evidence Snippets ============
create table if not exists public.evidence_snippets (
  id uuid primary key default uuid_generate_v4(),
  text text not null,
  tags jsonb,
  source jsonb,
  embedding vector(1536),
  created_at timestamp with time zone default now()
);

create index if not exists evidence_snippets_embed_idx
  on public.evidence_snippets using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============ 5) 評価／結論 ============
create table if not exists public.evals (
  session_id uuid references public.sessions(id) on delete cascade,
  final_confidence numeric,
  that_is_me_score int,
  nps int,
  notes text,
  based_on jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists public.conclusions (
  session_id uuid unique references public.sessions(id) on delete cascade,
  you_are text,
  management_do jsonb,
  management_dont jsonb,
  next_week_plan jsonb,
  created_at timestamp with time zone default now()
);

-- ============ 6) マッチ RPC ============
drop function if exists public.match_casebook_cards(vector,int);
create function public.match_casebook_cards(query_embedding vector, match_count int)
returns table (
  id text,
  title text,
  hypotheses jsonb,
  probes jsonb,
  management_tips jsonb,
  evidence_snippets jsonb,
  similarity float4
)
language sql stable as $$
  select
    c.id, c.title, c.hypotheses, c.probes, c.management_tips, c.evidence_snippets,
    (1 - (c.embedding <=> query_embedding))::float4 as similarity
  from public.casebook_cards c
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

drop function if exists public.match_question_templates(vector,int);
create function public.match_question_templates(query_embedding vector, match_count int)
returns table (
  id text,
  template text,
  goal text,
  followups jsonb,
  similarity float4
)
language sql stable as $$
  select
    q.id, q.template, q.goal, q.followups,
    (1 - (q.embedding <=> query_embedding))::float4 as similarity
  from public.question_templates q
  order by q.embedding <=> query_embedding
  limit match_count;
$$;
