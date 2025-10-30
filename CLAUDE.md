# CLAUDE.md — Claude Integration Playbook (Coach)

> 本ドキュメントは、**Coach** プロダクトに Anthropic Claude を組み込むための実装ガイドです。  
> 目的は「既存（OpenAI ベース）のコードパスを保ちつつ、Claude を選択可能にする」こと。環境変数の切替だけでモデルを差し替えられるようにします。

---

## 0) ゴール / 使いどころ

- **ゴール**
  - 既存の OpenAI 実装と**同等の I/O スキーマ**（質問生成・要約・次の一歩・診断ループ）で Claude を選べるようにする
  - 将来の**Tool Use（関数呼び出し）**や**Structured JSON 出力**を使った高精度化に踏み出しやすい構造にする
- **主な使いどころ**
  1. **seed questions 生成**（YES/NO/内省促進）
  2. **インタビューの次の良問**（rag + 直近 Q/A を条件に）
  3. **要約 + 次の一歩**（STAR 等の様式制約）
  4. **診断の結語**（「あなたはこういう人です！」と DO/DON’T/来週のTODO）

---

## 1) 事前準備

### 1.1 アカウント & API キー

- Anthropic Console で API キーを発行（組織の利用ポリシーに合わせてローテーション設計を）
- `.env` に以下を追加：

```bash
# Claude (Anthropic)
ANTHROPIC_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# 既定モデル（存在しない場合は SDK 既定にフォールバック）
CLAUDE_MODEL=claude-3-5-sonnet-latest
```

> **NOTE:** モデル名・トークン上限・料金は随時更新されるため、最新版は Anthropic 公式を確認してください。

### 1.2 依存パッケージ

```bash
npm i @anthropic-ai/sdk
# or
yarn add @anthropic-ai/sdk
```

---

## 2) モデル選定ガイド（目安）

- `claude-3-5-sonnet-latest` … バランス良し（推論・長文・ツール）。まずはこれを既定化
- `claude-3-5-haiku-latest` … 低コスト・高速応答が必要なバッチ/テキスト整形
- `claude-3-opus-latest` … 高精度寄り（コストは高め）。実験/重要回答用にスポットで

> **推奨方針**: まず Sonnet を全パスで繋ぎ、パフォーマンス／コストを見て一部 Haiku に置き換える。

---

## 3) クライアント初期化（Node/TypeScript）

```ts
// server/lib/claudeClient.ts
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL =
  process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});
```

- **初期化は 1 回**にし、各ユースケースから import して使う（コネクション再生成を防ぐ）。
- OpenAI と同様に、**プロバイダ抽象化**（provider="openai"|"anthropic"）で切替可能な設計を推奨。

---

## 4) 最小利用例（メッセージ API）

```ts
import { anthropic, CLAUDE_MODEL } from "./lib/claudeClient";

export async function askClaude(prompt: string) {
  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: "あなたは1on1の質問設計アシスタントです。日本語で簡潔に答えてください。",
    messages: [{ role: "user", content: prompt }],
  });
  const text = resp.content
    .map((p) => ("text" in p ? p.text : ""))
    .join("")
    .trim();
  return text;
}
```

> Claude のレスポンスは `content` が**複合配列**（text/chunk/tool_use など）になり得る点に注意。

---

## 5) 構造化 JSON 出力（推奨）

Claude は**JSON スキーマに従った出力**をネイティブ指定できます（SDK/モデルの対応状況は要確認）。  
**目的**：パース事故を減らし、try-catch/extractJson の負荷を下げる。

```ts
const schema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          theme: { type: "string" },
          text: { type: "string" },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

const resp = await anthropic.messages.create({
  model: CLAUDE_MODEL,
  max_tokens: 1024,
  system: "JSONスキーマに厳密に従って出力してください。日本語。",
  messages: [{ role: "user", content: "質問を1件、最良の1問だけ生成して" }],
  // Structured Outputs（SDK/モデルの対応に依存）
  response_format: { type: "json_schema", json_schema: schema as any },
});
// resp.content[0].type === "tool_result" | "output_json" 等、SDK版に応じて取得方法が異なります。
// 実際の SDK 仕様に合わせてパースを実装してください。
```

> **互換方針**：Structured が安定するまでは、従来の「```json … ``` から抽出」も残し、**両対応**しておく。

---

## 6) 既存フローへ差し替え（サンプル関数群）

以下は **OpenAI 実装と同じ I/O** を維持した Claude 版のサンプルです。  
必要に応じて `server/server.ts` の既存関数を**プロバイダ別に分割**してください。

### 6.1 Seed Questions（YES/NO × 内省促進）

```ts
// server/llm/claude/seedQuestions.ts
import { anthropic, CLAUDE_MODEL } from "../../lib/claudeClient";

type Question = { id: string; theme: string; text: string };

export async function genQuestionsClaude(opts: {
  strengths_top5?: string[];
  demographics?: Record<string, any>;
  n: number;
  avoid_texts?: string[];
}): Promise<Question[]> {
  const { strengths_top5 = [], demographics = {}, n, avoid_texts = [] } = opts;

  const system = `あなたは1on1の質問設計アシスタントです。
- YES/NOで答えられるが内省を促す
- 既出文面(avoid_texts)の再利用を避ける
- 日本語 15〜40 文字程度`;

  const user = `入力:
- strengths_top5: ${JSON.stringify(strengths_top5)}
- demographics: ${JSON.stringify(demographics)}
- n: ${n}
- avoid_texts: ${JSON.stringify(avoid_texts)}

出力(JSON):
{ "questions": [ { "theme": "", "text": "..." } ] }`;

  const r = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = r.content.map((c) => ("text" in c ? c.text : "")).join("");
  const json = safeParseJson(text);
  const raw = Array.isArray(json?.questions) ? json.questions : [];
  return raw.slice(0, n).map((q: any, i: number) => ({
    id: q?.id || `CQ${Date.now()}_${i + 1}`,
    theme: String(q?.theme ?? ""),
    text: String(q?.text ?? ""),
  })).filter((q: Question) => q.text);
}

function safeParseJson(s: string) {
  try {
    const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (m) return JSON.parse(m[1].trim());
    const i = s.indexOf("{"), j = s.lastIndexOf("}");
    if (i >= 0 && j > i) return JSON.parse(s.slice(i, j + 1));
    return JSON.parse(s);
  } catch { return null; }
}
```

### 6.2 Persona + Next Steps（結語）

```ts
// server/llm/claude/personaNext.ts
import { anthropic, CLAUDE_MODEL } from "../../lib/claudeClient";

export async function genPersonaAndNextStepsClaude(opts: {
  strengths_top5?: string[];
  demographics?: Record<string, any>;
  answers: Array<{ question_id: string | null; answer: string | null }>;
}): Promise<{ persona_statement: string; next_steps: string[] }> {
  const { strengths_top5 = [], demographics = {}, answers = [] } = opts;

  const system = `あなたは1on1の要約・提案アシスタントです。日本語で断定的に簡潔に。`;

  const user = `入力:
- strengths_top5: ${JSON.stringify(strengths_top5)}
- demographics: ${JSON.stringify(demographics)}
- answers(時系列): ${JSON.stringify(answers)}

要件:
- persona_statement: 「あなたは〜な人です。」の断定文 1〜2文
- next_steps: 1〜3 個。短く具体的な TODO

出力(JSON):
{ "persona_statement": "...", "next_steps": ["..."] }`;

  const r = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = r.content.map((c) => ("text" in c ? c.text : "")).join("");
  const j = safeParseJson(text) || {};
  const persona_statement =
    typeof j.persona_statement === "string" ? j.persona_statement.trim() : "";
  const next_steps: string[] = (Array.isArray(j.next_steps) ? j.next_steps : [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);
  return { persona_statement, next_steps };
}
// safeParseJson は上の例と同じ
```

### 6.3 Interviewer（次の良問）

```ts
// server/llm/claude/interviewer.ts
import { anthropic, CLAUDE_MODEL } from "../../lib/claudeClient";

export async function runInterviewerClaude(opts: {
  hypotheses?: string[];
  qa_pairs?: Array<{ q: string; a: string }>;
}): Promise<{ question: { id: string; text: string; goal: string } }> {
  const { hypotheses = [], qa_pairs = [] } = opts;

  const system = `あなたはインタビュアーです。次に聞くべき「最良の1問」を出力します。日本語。`;
  const user = `仮説: ${JSON.stringify(hypotheses)}
Q/A(抜粋): ${JSON.stringify(qa_pairs)}
出力(JSON):
{ "question": { "text": "...", "goal": "..." } }`;

  const r = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 512,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = r.content.map((c) => ("text" in c ? c.text : "")).join("");
  const j = safeParseJson(text) || {};
  const q = j?.question ?? {};
  return {
    question: {
      id: q?.template_id || `CQ_${Date.now()}`,
      text: (q?.text || "最近の仕事で一番うまくいったことは？").trim(),
      goal: String(q?.goal ?? ""),
    },
  };
}
```

### 6.4 Manager（結論ブロック）

```ts
// server/llm/claude/manager.ts
import { anthropic, CLAUDE_MODEL } from "../../lib/claudeClient";

export async function runManagerClaude(opts: {
  strengths_top5?: string[];
  demographics?: Record<string, any>;
  qa_pairs: Array<{ q: string; a: string }>;
}): Promise<{
  you_are: string;
  management: { do: string[]; dont: string[] };
  next_week_plan: string[];
}> {
  const { strengths_top5 = [], demographics = {}, qa_pairs } = opts;

  const system = `あなたはマネジメント設計者。日本語で JSON のみ出力。`;
  const user = `Top5: ${JSON.stringify(strengths_top5)}
Demographics: ${JSON.stringify(demographics)}
Q/A: ${JSON.stringify(qa_pairs)}
出力(JSON):
{
  "you_are": "...",
  "management": { "do": ["..."], "dont": ["..."] },
  "next_week_plan": ["..."]
}`;

  const r = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = r.content.map((c) => ("text" in c ? c.text : "")).join("");
  const j = safeParseJson(text) || {};
  const you_are = String(j.you_are ?? "").trim();
  const management = {
    do: Array.isArray(j?.management?.do) ? j.management.do.slice(0, 3) : [],
    dont: Array.isArray(j?.management?.dont) ? j.management.dont.slice(0, 3) : [],
  };
  const next_week_plan = Array.isArray(j?.next_week_plan)
    ? j.next_week_plan.slice(0, 3)
    : [];
  return { you_are, management, next_week_plan };
}
```

---

## 7) RAG との接続方針

- 既存の `retrieveTopK()` / `ragCasebook()` / `ragQuestionTemplates()` を **そのまま併用** 可能
- Claude は**長文コンテキスト**が比較的得意 ⇒ 過度な圧縮をせず、**「上位数件を素直に貼る」** で良い
- ただし**重複**・**誘導漏れ**を避けるために、
  - `avoid_texts` をプロンプトに入れる
  - 「目的」「様式」等の**明示的制約**を system / user に記述

---

## 8) Tool Use（関数呼び出し）の導入（将来拡張）

Claude の **Tool Use** を使うと、LLM から「サーバの関数」を呼び出せます（例：RAG検索や社内 API）。

### 8.1 ツール定義（例）

```ts
const tools = [
  {
    name: "search_knowledge",
    description: "社内の知識ベースから関連文書を検索する",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, k: { type: "number" } },
      required: ["query"],
    },
  },
];
```

### 8.2 実行ループ（擬似コード）

```ts
const resp = await anthropic.messages.create({
  model: CLAUDE_MODEL,
  max_tokens: 1024,
  system: "必要なら search_knowledge ツールを使ってください。",
  tools,
  messages: [
    { role: "user", content: "次の良問を1件。必要なら社内KBを検索して。" },
  ],
  tool_choice: "auto",
});

// resp.content に tool_use が含まれる場合は、指定ツールを実装側で実行し、
// その結果を tool_result として messages に追送して再度 create()。
```

> **実装メモ**: Tool Use は SDK のイベント/型が頻繁に更新されるため、**SDK の最新版に合わせて**実装してください。

---

## 9) ストリーミング（オプション）

- ユーザ体験向上のため、**ストリーミング表示**を検討
- @anthropic-ai/sdk の streaming API に合わせ、**テキストチャンクを順次連結**しつつ、
  - JSON を期待する場合は**末尾で only-parse**（中間は UI 表示のみに使用）

---

## 10) 例：既存 API の Claude 化（差し替え方針）

- `server/server.ts` の以下の関数に「Claude 版実装」を用意し、**プロバイダ抽象化**で切替
  - `genQuestionsLLM` → `genQuestionsClaude`
  - `genPersonaAndNextSteps` → `genPersonaAndNextStepsClaude`
  - `runInterviewer` → `runInterviewerClaude`
  - `runManager` → `runManagerClaude`
- ルーティングは現状維持（/api/sessions/...）。**バックエンド内部の呼び出し先のみ切替**。
- 切替キー例：`LLM_PROVIDER=anthropic|openai`。なければ OpenAI を既定。

---

## 11) エラー処理 / リトライ

- 代表的な失敗
  - `401 Unauthorized`：API キー不正/権限
  - `429 Rate limit`：レート超過 → **指数バックオフ + ジッター**
  - `context_length_exceeded`：プロンプト長超過 → コンテキスト縮約（最近 10 件に制限 等）
- 推奨：**最長 3 回**の指数バックオフ（200ms, 800ms, 2.4s 程度 + ±20% ジッター）

---

## 12) コスト管理

- **プロンプト縮約**：RAG の貼付けは上位 3～5 件程度に抑える
- **出力量制御**：`max_tokens` を用途別に設定（seed=512 / summary=768 / manager=1024 など）
- **モデル選択**：バッチ処理は Haiku、ユーザ可視の最終出力は Sonnet を既定 など

---

## 13) セキュリティ / 運用

- API キーは**必ずサーバ側**で保持（フロントへ露出しない）
- ログ（prompt/completion）は**PII マスキング**と**保持期間**を定義（`gen_traces` の運用）
- 機密文書は**最小限の抜粋**のみ LLM へ渡す（RAG 側での前処理を徹底）

---

## 14) テスト

- **スナップショットテスト**（プロンプト → 期待 JSON スキーマ）
- **回帰テスト**：質問文が `avoid_texts` を二重出力しないか
- **RAG の結合テスト**：ヒット無しに対し、**フェイルセーフな既定文**を返すか

```ts
// 例: vitest
import { describe, it, expect } from "vitest";
import { genQuestionsClaude } from "../server/llm/claude/seedQuestions";

it("returns at least 1 question", async () => {
  const out = await genQuestionsClaude({ n: 1 });
  expect(out.length).toBe(1);
  expect(out[0].text.length).toBeGreaterThan(0);
});
```

---

## 15) トラブルシュート

- **空配列が返る**：JSON パース失敗の可能性 → `safeParseJson` の分岐ログ出力を強化
- **同じ質問が繰り返される**：`avoid_texts` が UI から渡っているか確認
- **長文になりがち**：system で「40 文字以内」「名詞で始める」等の**明示制約**を追加
- **429 が頻発**：並列数を減らす / バッチを Haiku に切替 / キャッシュ導入

---

## 16) ロールアウト手順（提案）

1. `.env` に `ANTHROPIC_API_KEY` を追加（Secrets 連携）
2. `LLM_PROVIDER=anthropic` を**ステージング**で適用
3. 4 つの関数（seed / interviewer / persona+steps / manager）を Claude 版で差し替え
4. ログ（`gen_traces`）でレイテンシ・成功率・文字数を観測
5. 本番は**%ロールアウト**（10% → 30% → 100%）

---

## 17) 参考（プロンプトのテンプレ原則）

- **目的ファースト**（system に「あなたは◯◯アシスタント」）
- **出力様式の厳密化**（JSON スキーマ or フェンス）
- **短く具体**（文字数/文体/主体/制約を列挙）
- **重複抑止**（avoid_texts / recentTexts）
- **安全規定**（個人特定の配慮・危険行動の回避・中傷 NG などの明文化）

---

## 18) cURL / HTTP 直叩き（デバッグ用）

```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model":"claude-3-5-sonnet-latest",
    "max_tokens":512,
    "system":"日本語でJSONのみ",
    "messages":[{"role":"user","content":"{ \"ask\": \"質問1件\" }"}]
  }'
```

---

## 19) 変更履歴（この文書）

- v0.1 (初版): Claude 組み込み方針と API 例、RAG/Tool/JSON テンプレを記載
- v0.2 (以降): SDK の Structured Outputs / Tool Use 仕様確定に合わせて更新予定

---

## 20) まとめ

- Claude を**フラグで切替**できるようにし、OpenAI 実装と**共通スキーマ**を維持
- まずは **seed / interviewer / persona+steps / manager** の 4 パスで置換
- Structured/Tool Use は SDK 追随で段階導入 → 将来的に **厳密 JSON** & **自動ツール呼び**へ拡張

以上。運用や実装で不明点があれば、このドキュメントに追記してください。

