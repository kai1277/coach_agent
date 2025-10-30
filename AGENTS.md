# AGENTS.md — Project Agent Guide (for Codex/Claude/AI Assistants)

このドキュメントは、**エージェント（AIコーディング支援）**が本リポジトリで安全・一貫・高品質に作業できるようにするための「実務ガイド」です。  
**人間向けの導入・起動方法は `README.md` を参照**し、ここでは方針・規約・落とし穴・変更手順を明文化します。

---

## 0) プロジェクト要約

- **目的**：ストレングス Top5 と基本属性を起点に、**質問ループ→推論→要約/次の一歩**を生成する「1on1コーチング用AI」MVP の実装。
- **構成**：
  - **Server**：Node.js（TypeScript）＋ Express ＋ Supabase（Postgres）＋ OpenAI SDK
  - **Frontend**：React（TypeScript）＋ Vite ＋ TanStack Query
  - **RAG**：Supabase 関数（`match_knowledge_chunks`, `match_casebook_cards`, `match_question_templates`）
  - **主なテーブル**：`sessions`, `turns`, `gen_traces`, `hitl_reviews`, `knowledge_docs`, `knowledge_chunks`, `conclusions`
- **非目標（現時点）**：本番認証・課金、重厚なRBAC、完全な評価指標/品質保証

---

## 1) 作業前の基本ルール（絶対遵守）

1. **JSON エラー形**：失敗時は `sendErr(res, status, error, hint?)` で `{ error, hint? }` を返すこと。
2. **DB 変更は必ず migration**：テーブルや列の追加/変更/削除は **migration** で。**直接 ALTER 禁止**。
3. **型安全**：TypeScript を厳格に。Union/Record を活用し暗黙 any を出さない。
4. **既存 API 互換性**：シグネチャ・JSON 形を壊さない（追加は OK / 変更は慎重に）。
5. **RAG の次元**：埋め込みベクトルの次元（例：1536）を **DDLとモデルで一致**させる。
6. **コスト/レイテンシ記録**：LLM 呼び出しは `recordTrace()` で **プロンプト・結果・latency** を記録（可能なら cost も）。
7. **セッション一貫性**：質問→回答のログは **`turns` に逐次保存**。**初手質問**を `assistant/question` として必ず入れる（後述の落とし穴参照）。
8. **i18n/JSON-only 出力**：LLM には **“JSONのみで出せ”** を強く指示し、`extractJson()` でパースする。
9. **安全な CORS**：`CORS_ORIGIN`（既定 `http://localhost:5173`）のみ許可。必要なときだけ拡張。

---

## 2) 重要ファイルと読み取り優先度

**まず読む**：
- `server/server.ts`（API 実装の中核）
- `frontend/*`（ページ/フック/クライアント）
- `README.md`（起動・環境変数・開発手順）
- `migrations/*`（DB 変更の履歴と現在の期待スキーマ）

**よく参照する**：
- `lib/apiClient.ts`（フロント→サーバの I/F）
- `types/api.ts`（型定義）
- `session` 関連（`useLoadSession`, `useNextStep`, `useTurns`, `SessionPage.tsx`）

---

## 3) 実行・環境（人間は README を参照）

- サーバ：`npm run dev:server`（PORT 既定: `8787`）
- フロント：`npm run dev`（Vite 既定: `5173`）
- 環境変数（例）：  
  - `OPENAI_API_KEY`, `OPENAI_MODEL`（既定 `gpt-4o-mini`）  
  - `OPENAI_EMBED_MODEL`（既定 `text-embedding-3-small`）  
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`（or `ANON_KEY`）  
  - `CORS_ORIGIN`（カンマ区切りで複数可）
- CORS：`ALLOWED_ORIGINS` に含まれないオリジンは拒否。

---

## 4) データモデル（主要テーブル）

- `sessions`：セッション本体（`id`, `title`, `summary`, `metadata(jsonb)`, `created_at`, `status?`, `asked_count?`, `max_questions?` など）
- `turns`：対話ログ（`session_id`, `role: 'assistant'|'user'`, `content(jsonb)`）  
  - `content.type` は `question` / `answer` / `instruction` / `summary` など
- `gen_traces`：LLM 呼び出しの監査（`session_id`, `turn_id`, `model`, `prompt`, `completion`, `latency_ms`, `cost_usd?`）
- `hitl_reviews`：HITL 評価
- `knowledge_docs` / `knowledge_chunks(embedding vector)`：RAG 知識ベース
- `conclusions`：結論（you_are / management / next_week_plan 等）

**関数**（Supabase RPC）：  
- `match_knowledge_chunks(query_embedding, match_count)`  
- `match_casebook_cards(query_embedding, match_count)`  
- `match_question_templates(query_embedding, match_count)`

> **方針**：**追記型**でログを残し、最終状態は `sessions.summary`・`sessions.metadata.next_steps` などにも永続化。

---

## 5) API 一覧（重要 I/F と返却形）

### セッション
- `POST /api/sessions`  
  - body: `{ transcript: string, strengths_top5?: string[], demographics?: any }`  
  - 返却: `{ id, createdAt, output:{ summary, next_steps, ... }, loop }`
- `GET /api/sessions?limit=20` → `{ sessions: [{id,title,created_at,...}] }`
- `GET /api/sessions/:id` → セッション本体（存在しない場合は **dev-fallback** を返す実装あり）
- `DELETE /api/sessions/:id` → 関連 `turns` 削除後に `sessions` 削除

### 回答ログ / 質問ループ
- `GET /api/sessions/:id/turns`  
  - `order=asc|desc`, `limit` で取得
- `POST /api/sessions/:id/seed-questions`  
  - LLM で初期質問を生成し、`sessions.metadata.seed_questions` に保存
- `GET /api/sessions/:id/questions/next`  
  - **未完了**：`{ done:false, question:{id,text}, progress, posterior, trace_id? }`  
  - **完了**：`{ done:true, next_steps, persona_statement, ... }` を返す  
  - **重要**：**初手のときだけ** `assistant/question` を `turns` に保存する
- `POST /api/sessions/:id/answers`  
  - body: `{ questionId, answer }`（`answer` は `'YES'|'PROB_YES'|'UNKNOWN'|'PROB_NO'|'NO'`）  
  - 処理：`turns` に `user/answer` を保存 → `posterior` 更新 → `asked_count` 進捗 → **収束なら** `genPersonaAndNextSteps` & `runManager` で結論を生成・保存、**継続なら** `runInterviewer` で次質問を用意し `metadata.next_step` 更新、`assistant/question` を `turns` にも保存
- `POST /api/sessions/:id/answers/undo`  
  - 直近回答を巻き戻す（`turns` 削除＋進捗/バッファ調整）
- `PATCH /api/sessions/:id/loop`  
  - 質問ループ設定（`threshold`, `maxQuestions`, `minQuestions`）をメタへ保存

### 追加指示・HITL・RAG
- `POST /api/sessions/:id/actions`  
  - 要約/次の一歩の再生成（`instruction`） → `summary`/`metadata.next_steps` 更新
- `POST /api/hitl/reviews`  
  - HITL レビュー行を `hitl_reviews` に追加
- `POST /api/knowledge/import`  
  - RAG ドキュメント＆チャンク upsert
- `GET /api/knowledge/search?q=...&k=3`  
  - RAG 検索プレビュー

**エラー共通形**：`{ error: string, hint?: string }` （`sendErr()`使用）

---

## 6) LLM 呼び出し方針

- **モデル**：`OPENAI_MODEL`（既定 `gpt-4o-mini`）/ `OPENAI_EMBED_MODEL`（既定 `text-embedding-3-small`）
- **プロンプト**：  
  - **ルール**：「**JSONのみ**」「**日本語**」「**短く具体的**」「**配列は最大 n 件**」を **system** と **user** に明記
  - `extractJson()` で安全に抽出（```json フェンス内 or 本体）  
- **トレース**：`recordTrace()` に **prompt/completion/latency** を記録。`session_id`/`turn_id` を付与可能。

---

## 7) 型・フロント規約（よくある落とし穴）

- **回答ラベルの型安全**：  
  ```ts
  // types/api.ts などに定義されていることを前提
  export type Answer5 = 'YES'|'PROB_YES'|'UNKNOWN'|'PROB_NO'|'NO';

  export const ANSWER_LABEL: Record<Answer5, string> = {
    YES: 'はい',
    PROB_YES: 'たぶんはい',
    UNKNOWN: 'わからない',
    PROB_NO: 'たぶんいいえ',
    NO: 'いいえ',
  };

  // 使う側：e.answer が Answer5 であることを保証して参照
  const label = ANSWER_LABEL[e.answer as Answer5];
  ```
  > 暗黙 any で `{}[e.answer]` を引くと型エラーになりやすい。**`Record<Answer5,string>` を使う**。

- **セッション not found 問題**：  
  回答 POST が 404 のとき、**`assistant/question` が最初に `turns` に保存されていない**ケースが多い。  
  → **初手**（`asked===0`）のとき **`questions/next`** で **必ず** `assistant/question` を `turns` に挿入する（実装済み）。

- **`normalizeSession`**：サーバの **旧/新形** 両対応のために存在。**next_steps** は `output.next_steps` もしくは `plan.next_steps` から正規化して参照する。

- **TanStack Query**：  
  - **読み取り**は `useQuery`、**変更**は `useMutation`。  
  - **キャッシュキー**は配列（例：`['turns', sessionId]`）で安定化。  
  - 変更後は `invalidateQueries` で明示リフレッシュ。

---

## 8) エージェント用タスクテンプレ（必ずこの順に実施）

### A. 新しい API を追加する
1. **目的の明確化**（入出力スキーマを先に箇条書き）
2. `server/server.ts` にルート追加
3. **入力バリデーション**：`ensureString` 等で必須を確認
4. **ビジネスロジック**：Supabase I/O・LLM 呼び出し
5. **レスポンス**：成功 2xx（JSON）/ 失敗 `sendErr`
6. **トレース**：LLM を叩く場合は `recordTrace`
7. **フロント**：`lib/apiClient.ts` にクライアント関数、フック追加
8. **UI**：画面/状態/トースト、アクセシビリティ
9. **動作確認**：Happy/Edge/Error の3系統
10. **コミット**：下記規約・PR テンプレに従う

### B. DB 変更を伴う改修
1. **migration 追加**（`migrations/xxxx.sql`）  
   - 例：`ALTER TABLE sessions ADD COLUMN status text;`
2. **DDL とアプリの整合**（埋め込み次元など）  
3. **リードオンリー実装 → 適用 → ライタ実装** の順で安全に
4. **起動して動作確認** → 失敗時は **ROLLBACK migration** を用意

### C. 質問ループにロジックを足す
1. `questions/next` の完了判定・`asked` の扱いを変更  
2. 初手 `assistant/question` 保存の挙動は**壊さない**  
3. `answers` 側の分岐（収束→結論／継続→Interviewer）を調整  
4. 返却 JSON を Front も更新

---

## 9) コーディング規約・スタイル

- **エラーハンドリング**：`try/catch` → `sendErr()` または 200/JSON フォールバック（MVP 互換のため）
- **ログ**：`console.error` は要点のみ。PII/Secrets を出さない。
- **関数分割**：LLM 呼び出しは小関数（`genQuestionsLLM`, `runInterviewer`, `runManager` 等）で整理。
- **テキスト長**：`clampText()` で Embedding 入力は上限管理（デフォ 2000 文字）。

---

## 10) セキュリティ・性能・コスト

- **キー管理**：`OPENAI_API_KEY` は `.env`。**gitignore 済**。誤コミット厳禁。
- **コスト抑制**：  
  - `temperature` は 0.2〜0.3  
  - `n` を過剰に増やさない（LLM側3件まで、RAG k=3〜5）  
  - プロンプトは**短く具体**に（`extractJson` でJSON抽出）
- **性能**：Embedding / RAG query は例外復帰（エンプティ fallback）。UI は Skeleton/トーストで体験担保。

---

## 11) PR / コミット運用

- **ブランチ**：`feature/...`, `fix/...`, `chore/...` など
- **コミットメッセージ**（日本語・種別先頭）：
  - `feat(server): /answers に収束分岐を追加`
  - `fix(frontend): Answer5 の型エラーを解消`
  - `chore(db): sessions に status 列を追加（migration）`
- **PR テンプレ（提案メッセージ例）**：
  ```
  目的:
  - 質問ループ収束時に persona_statement と next_steps を返す

  変更点:
  - server: POST /answers の収束分岐を追加、runManager 呼び出し
  - front: 完了UIで persona_statement/next_steps を表示
  - db: migration なし

  リスク/互換性:
  - 既存の JSON 形は維持（フィールド追加のみ）

  動作確認:
  - 正常系/未完了/Undo/404 を手動テスト
  ```

---

## 12) よくある問題と対処

- **「session not found」**：  
  - DB に `sessions.id` が無い、または初手の `assistant/question` を保存していない。  
  - ✅ `questions/next` の初手で **必ず** `turns` に `assistant/question` を insert 済みか確認。
- **回答ラベルの表示で型エラー**：  
  - ✅ `Record<Answer5,string>` を使い、`e.answer as Answer5` で参照。
- **RAG が空で精度が微妙**：  
  - ✅ `retrieveTopK` は空でも安全。プロンプト側で **「参考（なければなし）」** と書く。

---

## 13) 拡張の指針（P1+）

- **Classifier LLM の導入**：`updatePosterior` を本格推定器に置換（スコア/根拠を `evidence` に）
- **HITL 充実**：`hitl_reviews` の粒度アップ、悪問再学習のワークフロー整備
- **評価**：`gen_traces` にオフライン評価メタを追加（BLEU/ROUGE 的でなく、rubric ベース）

---

## 14) まとめ（エージェントへの指示）

- **最初に `README.md` とこの `AGENTS.md` を熟読**し、変更計画を**箇条書き**で提案してから差分を行ってください。
- **DBは必ず migration 経由**。  
- **API は JSON 互換とエラー形を維持**。  
- **セッションの初手質問は `turns` に保存**。  
- **LLM 出力は JSON-only**、`recordTrace()` でトレース。  
- 以上に従えば、**安全に機能追加・修正**できます。
