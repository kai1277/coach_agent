-- 拡張（UUID/ベクター）
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- セッションと発話（turns）
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  title text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  content jsonb not null,                    -- テキストでもよければ text に変更
  tokens int,
  created_at timestamptz not null default now()
);
create index if not exists idx_turns_session_created on public.turns(session_id, created_at);

-- ナレッジ（文書とチャンク）
create table if not exists public.knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  source text,           -- 例: 'web', 'pdf', 'notion' など
  title text,
  url text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.knowledge_docs(id) on delete cascade,
  chunk_index int,
  content text not null,
  embedding vector(1536),                    -- モデルに合わせて次元は後で調整
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_chunks_doc on public.knowledge_chunks(doc_id);
-- ベクター近傍検索（ivfflat）。リスト数は後でチューニング（例: 100）。
create index if not exists idx_chunks_embedding on public.knowledge_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- 生成トレース（プロンプト/モデル/コストなど）
create table if not exists public.gen_traces (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete set null,
  turn_id uuid references public.turns(id) on delete set null,
  model text,
  prompt text,
  completion text,
  latency_ms int,
  cost_usd numeric(10,4),
  created_at timestamptz not null default now()
);
create index if not exists idx_traces_session_created on public.gen_traces(session_id, created_at);

-- HITLレビュー（人手評価）
create table if not exists public.hitl_reviews (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('turn','trace')),
  target_id uuid not null,                   -- turns.id or gen_traces.id を入れる
  reviewer text,                             -- 例: email or user_id
  rating int check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists idx_reviews_target on public.hitl_reviews(target_type, target_id);
