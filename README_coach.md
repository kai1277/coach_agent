# Coach (MVP) — 開発者向けREADME

> これは **Coach** プロジェクト（MVP）の開発者向けドキュメントです。  
> サーバ: Node.js (TypeScript) / Express / Supabase / OpenAI  
> フロント: React / Vite / Tailwind / React Query

---

## 0. TL;DR（最短セットアップ）

```bash
# 1) .env を用意（例は下に雛形あり）
cp .env.example .env

# 2) 依存をインストール
npm i

# 3) 開発サーバ起動
# サーバ（:8787）
npm run dev:server

# 別シェルでフロント（:5173）
npm run dev:web
```

---

## 1. プロジェクト概要

- **目的**: StrengthsFinder Top5 と基本属性を起点に、良質な Yes/No 質問を反復し、  
  **「あなたはこういう人です！」** と **「次の一歩（ToDo）」** を導く 1on1 支援エージェント。
- **MVPの構成**
  - サーバ: `server/server.ts`
    - セッションAPI（作成/取得/削除）
    - 質問ループ（次の質問・回答受付・取り消し）
    - LLM 生成（質問/要約/次の一歩）
    - RAG（Supabase + ベクトル検索関数）
    - HITL（生成品質の簡易評価）
  - フロント: `frontend-v2/`（例）
    - `SessionPage.tsx` を中心に、セッションの開始/診断/結果表示

---

## 2. ディレクトリ構成（例）

```
.
├─ server/
│  ├─ server.ts            # Expressメイン
│  ├─ routes/              # ルーター分割するなら
│  ├─ lib/                 # 汎用関数
│  └─ ...                  
├─ frontend-v2/
│  ├─ src/
│  │  ├─ features/coach/SessionPage.tsx
│  │  ├─ api/              # react-query hooks
│  │  ├─ components/       # UI
│  │  └─ ...
│  └─ index.html / vite.config.ts
├─ supabase/
│  ├─ migrations/          # DDL / RPC / index作成など
│  └─ seed/                # 初期データ
├─ package.json
└─ .env / .env.local       # 環境変数
```

---

## 3. 主要技術

- **Server**: Node.js (TypeScript), Express, `@supabase/supabase-js`, OpenAI API
- **DB**: Supabase (PostgreSQL + pgvector), RLS off（MVP想定）
- **Frontend**: React 18, Vite, TailwindCSS, React Router, React Query
- **品質**: ESLint, Prettier, TypeScript, Husky + lint-staged

---

## 4. 環境変数（.env の例）

```dotenv
# OpenAI
OPENAI_API_KEY=sk-***
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBED_MODEL=text-embedding-3-small

# Supabase
SUPABASE_URL=http://127.0.0.1:54323
# Service Role があれば優先。無い場合は ANON を暫定使用（MVP）
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi***
# or
# SUPABASE_ANON_KEY=eyJhbGciOi***

# Server
PORT=8787
CORS_ORIGIN=http://localhost:5173
```

> **注意**: `.env` は Git にコミットしない。`.gitignore` に含める。

---

## 5. DB スキーマ（必須テーブルと関数）

### 5.1 テーブル

- `sessions`
  - `id uuid pk`
  - `title text`
  - `summary text`
  - `metadata jsonb` … `{ strengths_top5, demographics, next_steps, seed_questions, loop, ... }`
  - `status text` … `'concluded'` など
  - `asked_count int` … 質問数の進捗
  - `created_at timestamptz default now()`

- `turns`
  - `id uuid pk`
  - `session_id uuid fk -> sessions.id`
  - `role text` … `'assistant' | 'user'`
  - `content jsonb` … `{ type: 'question'|'answer'|'instruction', ... }`
  - `created_at timestamptz`

- `gen_traces`（LLM トレース）
  - `id uuid pk`
  - `session_id uuid null`
  - `turn_id uuid null`
  - `model text`
  - `prompt text`
  - `completion text`
  - `latency_ms int`
  - `cost_usd numeric null`
  - `created_at timestamptz`

- `conclusions`（確定結果の永続化）
  - `session_id uuid pk`
  - `you_are text`
  - `management_do text[]`
  - `management_dont text[]`
  - `next_week_plan text[]`

- RAG 用
  - `knowledge_docs(id, source, title, url, metadata, created_at)`
  - `knowledge_chunks(id, doc_id fk, chunk_index int, content text, embedding vector(1536), metadata jsonb)`

- HITL
  - `hitl_reviews(id, target_type text, target_id text, reviewer text, rating int null, comment text, created_at)`

### 5.2 RPC（pg関数）

- `match_knowledge_chunks(query_embedding vector(1536), match_count int)`  
  `knowledge_chunks.embedding` 対して近傍検索を返す。

- （任意）`match_casebook_cards`, `match_question_templates`  
  実装例は `server.ts` 参照。

> **pgvector の型**は埋め込みモデルに合わせる（例: `text-embedding-3-small` なら 1536 次元）。

---

## 6. サーバ実装の要点（`server/server.ts`）

- **エンドポイント**
  - `POST /api/sessions` … セッション作成
  - `GET /api/sessions?limit=20` … 一覧
  - `GET /api/sessions/:id` … 取得
  - `DELETE /api/sessions/:id` … 削除
  - `GET /api/sessions/:id/turns` … 回答ログ（turns）
  - `POST /api/sessions/:id/seed-questions` … LLMで初手候補生成
  - `GET /api/sessions/:id/questions/next` … 次の質問（seed優先→LLM）
  - `POST /api/sessions/:id/answers` … 回答受付、収束判定→確定 or 継続
  - `POST /api/sessions/:id/answers/undo` … 直近回答の取り消し
  - `PATCH /api/sessions/:id/loop` … ループ閾値/最大数を更新
  - `POST /api/hitl/reviews` … 生成品質レビューを保存
  - `POST /api/sessions/:id/actions` … 追加指示で summary/next_steps 更新
  - RAG: `POST /api/knowledge/import`, `GET /api/knowledge/search`

- **インメモリ状態**
  - `LOOP[id]` に asked / recentTexts / loop 設定
  - 初手のみ assistant/question を `turns` に挿入するのがポイント

- **LLM呼び出し**
  - `genQuestionsLLM` … Yes/Noだが深掘れる良問
  - `genNextStepsLLM` … 行動へ落とす ToDo（短く具体的）
  - `genPersonaAndNextSteps` … 最終の断定文 + ToDo
  - `runInterviewer` … {q,a}履歴から次の1問
  - `runManager` … you_are + management(do/don't) + next_week_plan

- **RAG**
  - `retrieveTopK(query | object, k)` → `match_knowledge_chunks` を叩く薄いユーティリティ
  - インポートは `/api/knowledge/import` にてまとめて upsert 可能

---

## 7. フロント実装の要点（`SessionPage.tsx`）

- `useCreateSession`, `useLoadSession`, `useNextStep`, `useTurns` など React Query Hook 経由で呼び出し
- **URLクエリ**: `?session=<uuid>` で復元
- **キー操作**: 質問画面で `1..5` → YES/PROB_YES/UNKNOWN/PROB_NO/NO
- **注意**: ボタン押下で `404 session not found` が出る場合は  
  - DB に `sessions` レコードが存在するか
  - マイグレーション（テーブル/関数）が適用済みか
  - `POST /api/sessions` 後にその `id` で `/answers` を叩いているか  
  を確認。

---

## 8. スクリプト（例）

`package.json`:

```jsonc
{
  "scripts": {
    "dev:server": "tsx server/server.ts",
    "dev:web": "vite --host",
    "format": "prettier -w .",
    "lint": "eslint . --ext .ts,.tsx",
    "typecheck": "tsc --noEmit",
    "prepare": "husky install"
  }
}
```

---

## 9. 開発フロー（推奨）

1. **ブランチ**: `feature/<scope>-<short-desc>` 例: `feature/coach-next-question`
2. **コミット**（日本語OK）: 1コミット=1変更の原則 / `lint-staged` が整形
3. **PR**: スクショ / 動作gif / 確認観点を添付
4. **レビュー**: 小さく、早く、具体的に
5. **マージ**: Squash推奨（履歴を読みやすく）

---

## 10. テスト（任意）

- 単体: Vitest
- E2E: Playwright
- モック: MSW（フロント）、`supertest`（サーバ）

---

## 11. ロギング/トレーシング

- LLM呼び出しは `gen_traces` に保存（model/prompt/completion/latency）
- 問題の再現は `trace_id` をキーに調査

---

## 12. エラーハンドリングとデバッグ

- サーバ: `sendErr(res, code, message, hint?)` を統一利用
- 典型
  - `404 session not found` → セッション未作成/ID不一致/DB未適用
  - `Not allowed by CORS` → `CORS_ORIGIN` 設定を確認
  - `pgvector 次元不一致` → DDL の `vector(1536)` と Embed モデルが不一致

---

## 13. セキュリティ（MVPの割り切り）

- **Service Role Key をサーバ側のみ**で使用（ブラウザに晒さない）
- RLS/認可は将来対応（MVPでは簡易）
- APIキーは `.env` のみ / GitHubに上げない

---

## 14. パフォーマンスの注意

- EmbeddingやLLMへの入力は `clampText` で安全カット
- RAGの k は小さく（3〜5）
- 進捗は `metadata.loop.progressAsked` に永続化してクラッシュ時も復旧

---

## 15. リリース・チェックリスト（抜粋）

- [ ] マイグレーション適用（テーブル/関数）
- [ ] `.env` 本番値
- [ ] OpenAI キー&レート制限
- [ ] CORS 設定
- [ ] フロントのビルド・静的配信
- [ ] 最低限の監視（サーバログ/DB残量/OpenAI失敗率）

---

## 16. よくある質問（FAQ）

- **Q. 回答後に「質問が出ない」**  
  A. 初手の `assistant/question` を `turns` に保存しているか、`seed-questions` が空でないか確認。

- **Q. 「session not found」**  
  A. `POST /api/sessions` で生成した `id` と同じものを `/answers` に渡しているか。DBに実レコードがあるか。マイグレーション済みか。

- **Q. pgvector の次元は？**  
  A. `text-embedding-3-small` → **1536**。DDL: `embedding vector(1536)`。

---

## 17. ライセンス / 著作権

- 社内（または個人）利用前提のMVP。外部公開時は LICENSE を別途整備。

---

## 18. 付録：cURL 例

```bash
# セッション作成
curl -X POST http://localhost:8787/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"transcript":"Top5に基づく初期セッション","strengths_top5":["戦略性","最上志向"],"demographics":{"ageRange":"20s"}}'

# 次の質問
curl http://localhost:8787/api/sessions/<id>/questions/next

# 回答送信
curl -X POST http://localhost:8787/api/sessions/<id>/answers \
  -H 'Content-Type: application/json' \
  -d '{"questionId":"Q_123","answer":"YES"}'
```

---

Happy hacking! 🚀
