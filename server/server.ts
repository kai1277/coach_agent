// server/server.ts
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

type JsonError = { error: string; hint?: string };
function sendErr(res: express.Response, status: number, error: string, hint?: string) {
  const body: JsonError = { error, ...(hint ? { hint } : {}) };
  return res.status(status).json(body);
}

function ensureString(v: any, name: string, min = 1) {
  if (typeof v !== 'string' || v.trim().length < min) throw new Error(`${name} is required`);
}

/* ----------------------------- OpenAI / Supabase ---------------------------- */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!, // .env に設定
});

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY)!,
  {
    global: { fetch: globalThis.fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  }
);


/* --------------------------------- Helpers --------------------------------- */

async function recordTrace(params: {
  session_id?: string;
  turn_id?: string;
  model: string;
  prompt: string;
  completion: string;
  latency_ms: number;
  cost_usd?: number | null;
}) {
  const { data, error } = await supabase
    .from('gen_traces')
    .insert({
      session_id: params.session_id ?? null,
      turn_id: params.turn_id ?? null,
      model: params.model,
      prompt: params.prompt,
      completion: params.completion,
      latency_ms: Math.round(params.latency_ms),
      cost_usd: params.cost_usd ?? null,
    })
    .select('id')
    .single();

  if (error) console.error('[recordTrace] supabase error', error);
  return data?.id as string | undefined;
}

function extractJson(text: string): any | null {
  try {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (m) return JSON.parse(m[1].trim());
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(text.slice(s, e + 1));
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clampText(input: string, max = 2000) {
  // Embedding 入力を長過ぎないように安全カット（UTF-16 ベースでOK）
  if (!input) return '';
  return input.length > max ? input.slice(0, max) : input;
}

type RAGQuery =
  | string
  | {
      strengths_top5?: string[];
      demographics?: Record<string, any>;
      avoid_texts?: string[];
      n?: number;
      purpose?: string; // "1on1 question generation" など
      extra?: Record<string, any>; // 将来拡張用（context等）
    };

async function retrieveTopK(query: RAGQuery, k = 3): Promise<Array<{ content: string }>> {
  try {
    // ── 受け取った条件をまとめて 1 本の検索クエリ文字列にする ──
    let qStr: string;
    if (typeof query === 'string') {
      qStr = query;
    } else {
      const {
        strengths_top5 = [],
        demographics = {},
        avoid_texts = [],
        n,
        purpose = '1on1 question generation / coaching',
        extra = {},
      } = query ?? {};

      qStr = [
        `[PURPOSE] ${purpose}`,
        strengths_top5.length ? `[STRENGTHS] ${strengths_top5.join(', ')}` : '',
        Object.keys(demographics).length ? `[DEMOGRAPHICS] ${JSON.stringify(demographics)}` : '',
        avoid_texts.length ? `[AVOID_TEXTS] ${avoid_texts.join(' | ')}` : '',
        typeof n === 'number' ? `[NUM_QUESTIONS] ${n}` : '',
        Object.keys(extra).length ? `[EXTRA] ${JSON.stringify(extra)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    const input = clampText(qStr, 2000);
    const emb = await openai.embeddings.create({ model: OPENAI_EMBED_MODEL, input });
    const vec = emb.data[0].embedding as number[];

    const { data, error } = await supabase
      .rpc('match_knowledge_chunks', { query_embedding: vec as any, match_count: k });

    if (error) {
      console.warn('[retrieveTopK] rpc error (fallback to empty):', error.message);
      return [];
    }
    return (data ?? []).map((r: any) => ({ content: r.content }));
  } catch (e) {
    console.warn('[retrieveTopK] error (fallback to empty):', e);
    return [];
  }
}

// ===== RAG: docs & chunks upsert helper =====
async function upsertKnowledgeDoc(params: {
  source?: string;
  title?: string;
  url?: string | null;
  metadata?: Record<string, any>;
  chunks: Array<{ content: string; metadata?: Record<string, any> }>;
}) {
  const {
    source = 'manual',
    title = '',
    url = null,
    metadata = {},
    chunks = [],
  } = params;

  // 1) doc を作成
  const docIns = await supabase
    .from('knowledge_docs')
    .insert({ source, title, url, metadata })
    .select('id')
    .single();

  if (docIns.error || !docIns.data) {
    throw new Error(`[upsertKnowledgeDoc] insert doc failed: ${docIns.error?.message}`);
  }
  const doc_id = docIns.data.id as string;

  // 2) 各 chunk を embedding して保存
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const content = (c.content ?? '').trim();
    if (!content) continue;

    const emb = await openai.embeddings.create({
      model: OPENAI_EMBED_MODEL,
      input: content,
    });
    const vector = emb.data[0].embedding as unknown as number[];

    const ins = await supabase.from('knowledge_chunks').insert({
      doc_id,
      chunk_index: i,
      content,
      embedding: vector as any,
      metadata: c.metadata ?? {},
    }).select('id').single();

    if (ins.error) {
      console.warn('[upsertKnowledgeDoc] insert chunk error:', ins.error.message);
    }
  }

  return { doc_id };
}

/** 直近の「回答」turn（user/answer）を1件取得 */
async function fetchLastAnswerTurn(session_id: string) {
  const { data, error } = await supabase
    .from('turns')
    .select('id, content, created_at')
    .eq('session_id', session_id)
    .eq('role', 'user')
    .filter('content->>type', 'eq', 'answer')   // ← ここがポイント
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0];
}


/** JSONB content に undo=true を立てて更新（論理Undo） */
async function markTurnUndo(turn_id: string, content: any) {
  const newContent = { ...(content ?? {}), undo: true };
  const { error } = await supabase
    .from('turns')
    .update({ content: newContent })
    .eq('id', turn_id);
  if (error) console.warn('[markTurnUndo] update failed', error.message);
}

function loadLoopState(meta: any) {
  const asked = Number(meta?.loop?.progressAsked ?? 0);
  const recentTexts: string[] = Array.isArray(meta?.loop_state?.recentTexts) ? meta.loop_state.recentTexts : [];
  const loopCfg = {
    threshold: Number(meta?.loop?.threshold ?? 0.9),
    maxQuestions: Number(meta?.loop?.maxQuestions ?? 8),
    minQuestions: Number(meta?.loop?.minQuestions ?? 0),
  };
  return { asked, recentTexts, loopCfg };
}

async function saveLoopState(sessionId: string, updater: (meta: any) => any) {
  const cur = await supabase.from('sessions').select('metadata').eq('id', sessionId).single();
  const meta = (cur.data?.metadata ?? {});
  const next = updater(meta);
  await supabase.from('sessions').update({ metadata: next }).eq('id', sessionId);
  return next;
}

/* ========== Embedding helper ========== */
async function embedText(text: string): Promise<number[]> {
  const emb = await openai.embeddings.create({
    model: OPENAI_EMBED_MODEL,
    input: text,
  });
  return emb.data[0].embedding as number[];
}

/* ========== RAG: 検索ユーティリティ ========== */
async function ragCasebook(strengths_top5: string[] = [], basic: Record<string, any> = {}, k = 5) {
  // 各資質ごとに個別検索して、全ての資質を確実に参照
  const resultsMap = new Map<string, any>(); // id -> card で重複排除

  for (const strength of strengths_top5) {
    if (!strength || !strength.trim()) continue;

    const query = [
      `Strength:${strength}`,
      `Basic:${JSON.stringify(basic)}`,
    ].join('\n');

    const vec = await embedText(query);
    const { data, error } = await supabase.rpc('match_casebook_cards', {
      query_embedding: vec as any,
      match_count: Math.ceil(k / Math.max(strengths_top5.length, 1)) + 1 // 各資質から均等に取得
    });

    if (error) {
      console.warn(`[ragCasebook] error for strength "${strength}":`, error.message);
      continue;
    }

    // 結果をマップに追加（重複排除）
    (data ?? []).forEach((card: any) => {
      if (card?.id && !resultsMap.has(card.id)) {
        resultsMap.set(card.id, card);
      }
    });
  }

  // 資質が指定されていない場合は従来通りの検索
  if (strengths_top5.length === 0) {
    const query = `Basic:${JSON.stringify(basic)}`;
    const vec = await embedText(query);
    const { data, error } = await supabase.rpc('match_casebook_cards', {
      query_embedding: vec as any,
      match_count: k
    });
    if (error) { console.warn('[ragCasebook] ', error.message); return []; }
    return data ?? [];
  }

  // Map から配列に変換して、最大 k 件まで返す
  return Array.from(resultsMap.values()).slice(0, k);
}

async function ragQuestionTemplates(context: {
  hypotheses?: string[];
  last_answers?: Array<{ q: string; a: string }>;
}, k = 5) {
  const text = [
    'Hypotheses:',
    ...(context.hypotheses ?? []),
    '',
    'Answers:',
    ...((context.last_answers ?? []).map(v => `Q:${v.q} A:${v.a}`)),
  ].join('\n');
  const vec = await embedText(text);
  const { data, error } = await supabase.rpc('match_question_templates', {
    query_embedding: vec as any,
    match_count: k
  });
  if (error) { console.warn('[ragQuestionTemplates] ', error.message); return []; }
  return data ?? [];
}

/* ========== Posterior のダミー更新（P1は簡易でOK） ========== */
function updatePosterior(prev: Record<string, number> | null, answer: string) {
  // まだ本格的なクラス分類器がないため、暫定：YES/NO でバランス微調整
  const base = prev ?? {
    TYPE_STRATEGY: 0.2,
    TYPE_EMPATHY: 0.2,
    TYPE_EXECUTION: 0.2,
    TYPE_ANALYTICAL: 0.2,
    TYPE_STABILITY: 0.2,
  };
  const delta = answer === 'YES' ? 0.03
              : answer === 'PROB_YES' ? 0.015
              : answer === 'PROB_NO' ? -0.015
              : answer === 'NO' ? -0.03 : 0;
  // 実行タイプに寄せるなどの簡易ルール（本番は Classifier LLM に置換）
  base.TYPE_EXECUTION = Math.max(0, Math.min(1, base.TYPE_EXECUTION + delta));
  // 正規化
  const sum = Object.values(base).reduce((a,b)=>a+b,0) || 1;
  const norm: Record<string, number> = {};
  (Object.keys(base) as Array<keyof typeof base>).forEach(k => (norm[k] = base[k]/sum));
  return norm;
}

/* --------------------------- LLM Question Generator ------------------------- */

type Question = { id: string; theme: string; text: string };

async function genQuestionsLLM(
  opts: {
    strengths_top5?: string[];
    demographics?: Record<string, any>;
    n: number;
    avoid_texts?: string[];
    answers?: Array<{ question_id: string | null; answer: string | null; answer_text?: string | null }>;
  }
): Promise<Question[]> {
  const { strengths_top5 = [], demographics = {}, n, avoid_texts = [], answers = [] } = opts;

  // RAG: casebook_cards からベストプラクティスを取得
  const caseCards = await ragCasebook(strengths_top5, demographics, 3);
  const caseContext = caseCards.map((c: any, i: number) =>
    `CASE${i + 1}: ${c.title}\n- Hypotheses: ${JSON.stringify(c.hypotheses)}\n- Probes: ${JSON.stringify(c.probes)}`
  ).join('\n---\n');

  // RAG: knowledge_chunks から汎用知識を取得
  const kb = await retrieveTopK(
    {
      strengths_top5,
      demographics,
      avoid_texts,
      n,
      purpose: '1on1 coaching: generate concise yes/no seed questions',
    },
    3 // k
  );
  const kbContext = kb.map((c, i) => `KB${i + 1}: ${c.content}`).join('\n');

  const system = `あなたは1on1のための質問設計エージェントです。
以下の [CASEBOOK]（ケーススタディ）と [KNOWLEDGE]（知識断片）を参考に、要件に合う日本語の質問だけをJSONで返してください。
必ず JSON のみを出力し、前置きや説明は書かないでください。

[CASEBOOK]
${caseContext || '(ケースなし)'}

[KNOWLEDGE]
${kbContext || '(知識なし)'}
`;

  // 回答履歴を整形
  const answersContext = answers.length > 0
    ? answers.map((a, i) => `${i + 1}. Q: ${a.question_id ?? '(unknown)'} → A: ${a.answer_text || a.answer || '(未回答)'}`).join('\n')
    : '(まだ回答なし)';

const user = `入力:
- strengths_top5: ${JSON.stringify(strengths_top5)}
- demographics: ${JSON.stringify(demographics)}
- n: ${n}
- avoid_texts（この文面は出さない）: ${JSON.stringify(avoid_texts)}
- これまでの回答履歴:
${answersContext}

要件（特に n=1 のとき厳守）:
- ストレングスTop5と基本属性、そしてこれまでの回答履歴を総合し、次に聞くべき「最も効果が高い1問」を設計する
- 回答履歴がある場合は、それを踏まえてより深掘りする質問や、新しい観点からの質問を考える
- 「はい」「たぶんはい」「わからない」「たぶんいいえ」「いいえ」の5択で答えられる YES/NO 系で、内省を促し会話の質を高める問い
- 文長は 15〜40 文字程度、日本語。曖昧語を避け具体的
- 既出文面（avoid_texts）は使わない

出力スキーマ（厳守）:
{ "questions": [ { "theme": "<統合的テーマ名(空でも可)>", "text": "<日本語の質問文>" } ] }`;

  const t0 = Date.now();
  const resp = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.3,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const content = resp.choices?.[0]?.message?.content ?? '{}';
  const parsed: any = extractJson(content) ?? {};
  const arr: Array<{ id?: string; theme?: string; text?: string }> =
    Array.isArray(parsed?.questions) ? parsed.questions : [];

  const out: Question[] = arr
    .slice(0, n)
    .map((q: { id?: string; theme?: string; text?: string }, i: number): Question => ({
      id: q?.id ?? `Q${Date.now()}_${i + 1}`,
      theme: String(q?.theme ?? '').trim(),
      text: String(q?.text ?? '').trim(),
    }))
    .filter((q: Question) => q.text.length > 0);

  await recordTrace({
    model: OPENAI_MODEL,
    prompt: JSON.stringify({ system, user }),
    completion: JSON.stringify(out),
    latency_ms: Date.now() - t0,
  });

  return out;
}

/* --------------------------- Q&A Collecter ------------------------- */

async function fetchQAPairs(session_id: string) {
  const { data, error } = await supabase
    .from('turns')
    .select('id, role, content, created_at')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true });

  if (error || !data) return [];

  const questions = new Map<string, { id: string; text: string; created_at: string }>();
  const pairs: Array<{ question_id: string; question_text: string; answer: string }> = [];

  for (const t of data) {
    const c = t.content as any;
    if (t.role === 'assistant' && c?.type === 'question' && c?.question_id && c?.text) {
      questions.set(c.question_id, { id: c.question_id, text: String(c.text), created_at: t.created_at });
    }
  }
  for (const t of data) {
    const c = t.content as any;
    if (t.role === 'user' && c?.type === 'answer' && c?.question_id && c?.answer) {
      const q = questions.get(c.question_id);
      if (q) {
        pairs.push({
          question_id: c.question_id,
          question_text: q.text,
          answer: String(c.answer), // 'YES' | 'PROB_YES' | ...
        });
      }
    }
  }
  return pairs;
}

/* --------------------------- AnswerHistory Collecter ------------------------- */

async function fetchAnswerHistory(session_id: string) {
  const { data, error } = await supabase
    .from('turns')
    .select('content, created_at')
    .eq('session_id', session_id)
    .eq('role', 'user')
    .filter('content->>type', 'eq', 'answer')
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data.map(r => ({
    question_id: (r as any)?.content?.question_id ?? null,
    answer: (r as any)?.content?.answer ?? null,
    answer_text: (r as any)?.content?.answer_text ?? null,
  }));
}

/* ========== Interviewer（次の良問） ========== */
async function runInterviewer(opts: {
  hypotheses?: string[];
  qa_pairs?: Array<{q:string;a:string}>;
  strengths_top5?: string[];
  demographics?: Record<string, any>;
}) {
  const { hypotheses = [], qa_pairs = [], strengths_top5 = [], demographics = {} } = opts;

  // RAG: casebook_cards から質問例を取得
  const caseCards = await ragCasebook(strengths_top5, demographics, 3);
  const caseContext = caseCards.map((c: any, i: number) =>
    `CASE${i + 1}: ${c.title}\n- Probes: ${JSON.stringify(c.probes)}\n- Followups: ${JSON.stringify(c.followups)}`
  ).join('\n---\n');

  // RAG: question_templates からテンプレートを取得
  const qtemps = await ragQuestionTemplates({ hypotheses, last_answers: qa_pairs }, 4);
  const qtempContext = qtemps.map((t:any,i:number)=>`T${i+1}: ${t.template} | goal:${t.goal} | followups:${JSON.stringify(t.followups)}`).join('\n');

  const system = `あなたはインタビュアー。以下の [CASEBOOK]（ケーススタディ）と [TEMPLATES]（質問テンプレート）を参考に、"次に聞くべき最良の1問" を日本語で作成。JSONのみ。

[CASEBOOK]
${caseContext || '(ケースなし)'}

[TEMPLATES]
${qtempContext || '(テンプレートなし)'}
`;
  const user = `仮説: ${JSON.stringify(hypotheses)}
Q/A履歴(抜粋): ${JSON.stringify(qa_pairs)}
出力: {"question":{"text":"...", "goal":"...", "template_id":"Q-... (あれば)"}}`;

  const r = await openai.chat.completions.create({
    model: OPENAI_MODEL, temperature: 0.3,
    messages: [{ role:'system', content: system }, { role:'user', content: user }]
  });
  const parsed = extractJson(r.choices?.[0]?.message?.content ?? '{}') ?? {};
  const q = parsed?.question ?? {};
  return {
    question: {
      id: q?.template_id ?? `Q_${Date.now()}`,
      text: String(q?.text ?? '').trim() || '最近の仕事で一番うまくいったことは？',
      goal: String(q?.goal ?? ''),
    }
  };
}

/* ========== Manager（結論） ========== */
async function runManager(opts: {
  strengths_top5?: string[];
  demographics?: Record<string, any>;
  qa_pairs: Array<{q:string;a:string}>;
}) {
  const { strengths_top5 = [], demographics = {}, qa_pairs } = opts;

  // RAG: casebook_cards からマネジメントのヒントを取得
  const caseCards = await ragCasebook(strengths_top5, demographics, 4);
  const caseContext = caseCards.map((c: any, i: number) =>
    `CASE${i + 1}: ${c.title}\n- Management: ${JSON.stringify(c.management)}\n- Next Actions: ${JSON.stringify(c.next_actions)}`
  ).join('\n---\n');

  // RAG: knowledge_chunks から汎用知識を取得
  const ragQuery = JSON.stringify({ strengths_top5, demographics, qa_pairs: qa_pairs.slice(-10) });
  const kb = await retrieveTopK(ragQuery, 3);
  const kbContext = kb.map((c, i) => `KB${i + 1}: ${c.content}`).join('\n');

  const system = `あなたはマネジメント設計者。以下の [CASEBOOK]（ケーススタディ）と [KNOWLEDGE]（知識断片）を参考に、入力を踏まえて
- "あなたはこういう人です！"（断定文で3〜5文）
- マネジメント方針（DO / DON'T 各3つ以内）
- 来週の具体アクション（1〜3）
を日本語JSONで返す。JSON以外禁止。

[CASEBOOK]
${caseContext || '(ケースなし)'}

[KNOWLEDGE]
${kbContext || '(知識なし)'}
`;

  const user = `Top5: ${JSON.stringify(strengths_top5)}
Demographics: ${JSON.stringify(demographics)}
Q/A: ${JSON.stringify(qa_pairs)}
出力:
{
  "you_are": "...",
  "management": { "do": ["..."], "dont": ["..."] },
  "next_week_plan": ["..."]
}`;

  const r = await openai.chat.completions.create({
    model: OPENAI_MODEL, temperature: 0.2,
    messages: [{ role:'system', content: system }, { role:'user', content: user }]
  });
  const o = extractJson(r.choices?.[0]?.message?.content ?? '{}') ?? {};
  return {
    you_are: String(o.you_are ?? '').trim(),
    management: {
      do: Array.isArray(o?.management?.do) ? o.management.do.slice(0,3) : [],
      dont: Array.isArray(o?.management?.dont) ? o.management.dont.slice(0,3) : [],
    },
    next_week_plan: Array.isArray(o?.next_week_plan) ? o.next_week_plan.slice(0,3) : []
  };
}

/* --------------------------- Loop State (in-memory) ------------------------- */

type LoopState = {
  asked: number;
  loop: { threshold: number; maxQuestions: number; minQuestions: number };
  recentTexts: string[];
};

const LOOP: Record<string, LoopState> = {};

function loopOf(id: string): LoopState {
  return (LOOP[id] ??= {
    asked: 0,
    loop: { threshold: 0.9, maxQuestions: 8, minQuestions: 0 },
    recentTexts: [],
  });
}

function neutralPosterior() {
  return {
    TYPE_STRATEGY: 0.2,
    TYPE_EMPATHY: 0.2,
    TYPE_EXECUTION: 0.2,
    TYPE_ANALYTICAL: 0.2,
    TYPE_STABILITY: 0.2,
  };
}

/* --------------------------------- Server ---------------------------------- */

const app = express();
const RAW_ORIGINS = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
const PORT = Number(process.env.PORT ?? 8787);

const ALLOWED_ORIGINS = RAW_ORIGINS.split(',').map(s => s.trim());

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    // curl や 同一オリジン（origin=null）も許可
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  exposedHeaders: ['Content-Length','X-Request-Id'],
};
app.use(cors(corsOptions));
app.options('/health', cors(corsOptions));
app.use(express.json());

app.get('/health', (_req, res) => res.send('ok'));

/* --------------------------------- User APIs -------------------------------- */

// ユーザー登録
app.post('/api/users', async (req, res) => {
  const { email, display_name, username, department, role, goal } = req.body ?? {};

  try {
    // username があればそれを使い、なければ display_name を使用
    const name = username ?? display_name;
    ensureString(name, 'username or display_name');
  } catch (e: any) {
    return sendErr(res, 400, e?.message ?? 'invalid payload');
  }

  const normalizedUsername = String(username ?? display_name).trim();
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;

  try {
    // profile_dataに保存するメタデータ
    const profileData = {
      department: department ?? null,
      role: role ?? null,
      goal: goal ?? null,
    };

    const insertData: any = {
      display_name: normalizedUsername,
      profile_data: profileData,
    };

    // オプション項目を追加
    if (normalizedEmail) {
      insertData.email = normalizedEmail;
    }

    const { data, error } = await supabase
      .from('users')
      .insert(insertData)
      .select('id, email, display_name, profile_data, created_at, updated_at')
      .single();

    if (error) {
      if ((error as any)?.code === '23505') {
        return sendErr(res, 409, 'email already registered');
      }
      console.error('POST /api/users insert error', error);
      return sendErr(res, 500, 'failed to create user');
    }

    if (!data) {
      return sendErr(res, 500, 'failed to create user');
    }

    const savedProfileData = data.profile_data || {};

    return res.status(201).json({
      id: data.id,
      email: data.email,
      display_name: data.display_name,
      username: data.display_name,
      department: savedProfileData.department || null,
      role: savedProfileData.role || null,
      goal: savedProfileData.goal || null,
      strengthsTop5: savedProfileData.strengthsTop5 || [],
      basicInfo: savedProfileData.basicInfo || {},
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  } catch (e) {
    console.error('POST /api/users unexpected error', e);
    return sendErr(res, 500, 'internal error');
  }
});

// ユーザーログイン（ユーザーネームまたはメールで検索）
app.post('/api/users/login', async (req, res) => {
  const { username, email } = req.body ?? {};

  if (!username && !email) {
    return sendErr(res, 400, 'username or email is required');
  }

  try {
    let query = supabase
      .from('users')
      .select('id, email, display_name, profile_data, created_at, updated_at');

    if (email) {
      const normalizedEmail = String(email).trim().toLowerCase();
      console.log('[LOGIN] Searching for user with email:', normalizedEmail);
      query = query.eq('email', normalizedEmail);
    } else {
      const normalizedUsername = String(username).trim();
      console.log('[LOGIN] Searching for user with username:', normalizedUsername);
      query = query.eq('display_name', normalizedUsername);
    }

    const { data, error } = await query.single();

    if (error) {
      console.error('[LOGIN] Query error:', error);
      return sendErr(res, 404, 'user not found');
    }

    if (!data) {
      console.log('[LOGIN] No user data returned');
      return sendErr(res, 404, 'user not found');
    }

    console.log('[LOGIN] User found:', { id: data.id, email: data.email, display_name: data.display_name });

    const profileData = data.profile_data || {};

    return res.status(200).json({
      id: data.id,
      email: data.email,
      display_name: data.display_name,
      username: data.display_name,
      department: profileData.department || null,
      role: profileData.role || null,
      goal: profileData.goal || null,
      strengthsTop5: profileData.strengthsTop5 || [],
      basicInfo: profileData.basicInfo || {},
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  } catch (e) {
    console.error('POST /api/users/login unexpected error', e);
    return sendErr(res, 500, 'internal error');
  }
});

// ユーザープロフィール更新
app.patch('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { department, role, goal, strengthsTop5, basicInfo } = req.body ?? {};

  try {
    // 既存のprofile_dataを取得
    const existing = await supabase
      .from('users')
      .select('profile_data')
      .eq('id', id)
      .single();

    if (existing.error || !existing.data) {
      return sendErr(res, 404, 'user not found');
    }

    // 既存データとマージ
    const currentProfileData = existing.data.profile_data || {};
    const updatedProfileData = {
      ...currentProfileData,
      ...(department !== undefined && { department }),
      ...(role !== undefined && { role }),
      ...(goal !== undefined && { goal }),
      ...(strengthsTop5 !== undefined && { strengthsTop5 }),
      ...(basicInfo !== undefined && { basicInfo }),
    };

    // 更新
    const { data, error } = await supabase
      .from('users')
      .update({ profile_data: updatedProfileData })
      .eq('id', id)
      .select('id, email, display_name, profile_data, created_at, updated_at')
      .single();

    if (error) {
      console.error('PATCH /api/users/:id update error', error);
      return sendErr(res, 500, 'failed to update user');
    }

    if (!data) {
      return sendErr(res, 500, 'failed to update user');
    }

    const profileData = data.profile_data || {};

    return res.status(200).json({
      id: data.id,
      email: data.email,
      display_name: data.display_name,
      username: data.display_name,
      department: profileData.department || null,
      role: profileData.role || null,
      goal: profileData.goal || null,
      strengthsTop5: profileData.strengthsTop5 || [],
      basicInfo: profileData.basicInfo || {},
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  } catch (e) {
    console.error('PATCH /api/users/:id unexpected error', e);
    return sendErr(res, 500, 'internal error');
  }
});

/* ------------------------------- Session APIs ------------------------------- */

app.post('/api/sessions', async (req, res) => {
  try {
    const { transcript, context, strengths_top5, demographics, userId } = req.body ?? {};
    if (!transcript) return res.status(400).json({ error: 'transcript is required' });

    const ctx = context ?? 'general';
    let user_id: string | null = null;
    if (typeof userId === 'string' && userId.trim().length > 0) {
      user_id = userId.trim();
    } else if (userId != null) {
      return res.status(400).json({ error: 'userId must be a string' });
    }

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        title: String(transcript).slice(0, 40),
        summary: null,
        max_questions: 8,  // デフォルト8問
        asked_count: 0,    // 初期値0
        user_id,
        metadata: {
          context: ctx,
          strengths_top5,
          demographics,
          next_steps: [],
          seed_questions: [],
        },
      })
      .select('id, summary, metadata, created_at')
      .single();

    if (error) {
      if ((error as any)?.code === '23503') {
        return res.status(400).json({ error: 'user not found for provided userId' });
      }
      console.error('supabase insert error', error);
      return res.status(500).json({ error: 'failed to create session' });
    }

    const meta = (data?.metadata ?? {}) as Record<string, any>;
    const next_steps: string[] = Array.isArray(meta.next_steps) ? meta.next_steps : [];

    return res.status(201).json({
      id: data!.id,
      createdAt: data!.created_at ?? new Date().toISOString(),
      output: {
        summary: data!.summary ?? '',
        hypotheses: [],
        next_steps,
        citations: [],
        persona: null,
      },
      loop: { threshold: 0.9, maxQuestions: 8, minQuestions: 0 },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// 一覧
app.get('/api/sessions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50')), 200);
    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, summary, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: 'failed to list sessions' });
    res.json({ sessions: data ?? [] });
  } catch (e) {
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('sessions')
      .select('id, summary, metadata, created_at')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(200).json({
        id,
        createdAt: new Date().toISOString(),
        output: {
          summary: '',
          hypotheses: [],
          next_steps: [],
          citations: [],
          persona: null,
        },
        loop: { threshold: 0.9, maxQuestions: 8, minQuestions: 0 },
        _note: 'dev-fallback: session not found',
      });
    }

    const meta = (data.metadata ?? {}) as Record<string, any>;
    const next_steps: string[] = Array.isArray(meta.next_steps) ? meta.next_steps : [];

    return res.status(200).json({
      id: data.id,
      createdAt: data.created_at ?? new Date().toISOString(),
      output: {
        summary: data.summary ?? '',
        hypotheses: [],
        next_steps,
        citations: [],
        persona: null,
      },
      loop: { threshold: 0.9, maxQuestions: 8, minQuestions: 0 },
    });
  } catch (e) {
    console.error('GET /api/sessions/:id internal error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// 削除
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // 関連turnsを先に削除（FK制約対応）
    await supabase.from('turns').delete().eq('session_id', id);
    const del = await supabase.from('sessions').delete().eq('id', id).select('id').single();
    if (del.error) return res.status(500).json({ error: 'failed to delete' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'internal error' });
  }
});

/* ---------------------- Turns (回答ログ) 取得 API [P0] ---------------------- */

app.get('/api/sessions/:id/turns', async (req, res) => {
  try {
    const { id } = req.params;

    // パラメータ（任意）
    const limit = Math.min(Math.max(Number(req.query.limit ?? 200), 1), 1000); // 1..1000
    const order = (String(req.query.order ?? 'asc').toLowerCase() === 'desc') ? 'desc' : 'asc';

    // 取得
    const q = supabase
      .from('turns')
      .select('id, session_id, role, content, created_at')
      .eq('session_id', id)
      .order('created_at', { ascending: order === 'asc' })
      .limit(limit);

    const { data, error } = await q;
    if (error) {
      console.error('[GET /turns] supabase error', error);
      return res.status(500).json({ error: 'failed to fetch turns' });
    }

    return res.status(200).json({ turns: data ?? [] });
  } catch (e) {
    console.error('GET /api/sessions/:id/turns error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

/* --------------------------- Seed Questions (LLM) --------------------------- */

app.post('/api/sessions/:id/seed-questions', async (req, res) => {
  try {
    const { id } = req.params;
    const { strengths_top5, demographics, n } = req.body ?? {};
    const size = Number(n) || 1;

    const st = loopOf(id);

    // セッション row を用意（無ければ作成）
    let row = (
      await supabase.from('sessions').select('id, metadata').eq('id', id).single()
    ).data;
    if (!row) {
      const ins = await supabase
        .from('sessions')
        .insert({ id, title: '(auto-created)', metadata: {} })
        .select('id, metadata')
        .single();
      if (ins.error || !ins.data) {
        return res.status(500).json({ error: 'failed to create session' });
      }
      row = ins.data;
    }

    // 回答履歴を取得
    const answers = await fetchAnswerHistory(id);

    const t0 = Date.now();
    const questions = await genQuestionsLLM({
      strengths_top5: strengths_top5 ?? row.metadata?.strengths_top5 ?? [],
      demographics: demographics ?? row.metadata?.demographics ?? {},
      n: size,
      avoid_texts: st.recentTexts,
      answers,
    });

    await recordTrace({
      session_id: id,
      model: OPENAI_MODEL,
      prompt: `seed-questions input: ${JSON.stringify({
        strengths_top5: strengths_top5 ?? row.metadata?.strengths_top5 ?? [],
        demographics: demographics ?? row.metadata?.demographics ?? {},
        n: size,
        avoid_texts: st.recentTexts,
      })}`,
      completion: JSON.stringify(questions),
      latency_ms: Date.now() - t0,
    });

    // 重複抑止用の最近出した文面を更新
    const newTexts = questions.map((q) => q.text).filter(Boolean);
    st.recentTexts = Array.from(new Set([...newTexts, ...st.recentTexts])).slice(0, 10);

    // メタに保存
    const newMeta = {
      ...(row.metadata ?? {}),
      strengths_top5: strengths_top5 ?? row.metadata?.strengths_top5,
      demographics: demographics ?? row.metadata?.demographics,
      seed_questions: questions,
    };
    await supabase.from('sessions').update({ metadata: newMeta }).eq('id', id);

    return res.status(200).json({ questions });
  } catch (e) {
    console.error('POST /seed-questions error', e);
    return res.status(200).json({
      questions: [{ id: `QF_${Date.now()}`, theme: '', text: '直近日常で嬉しかったことはありますか？' }],
    });
  }
});

/* ------------------------------ Loop (Next/QA) ------------------------------ */

app.get('/api/sessions/:id/questions/next', async (req, res) => {
  try {
    const { id } = req.params;
    const st = loopOf(id);

    // データベースから最新の進捗を取得して同期
    const sessionRow = await supabase
      .from('sessions')
      .select('asked_count, max_questions, metadata, summary')
      .eq('id', id)
      .single();

    if (sessionRow.data) {
      const dbAsked = Number(sessionRow.data.asked_count ?? 0);
      const dbMax = Number(sessionRow.data.max_questions ?? 8);
      // メモリとDBの進捗を同期（DBが優先）
      if (dbAsked > st.asked) {
        st.asked = dbAsked;
      }
      if (dbMax !== st.loop.maxQuestions) {
        st.loop.maxQuestions = dbMax;
      }
    }

    // ----- 完了条件 -----
    if (st.asked >= st.loop.maxQuestions && st.asked >= st.loop.minQuestions) {
      const meta = sessionRow.data?.metadata ?? {};

      // Q&A ペアを取得
      const rawPairs = await fetchQAPairs(id);
      const qa_pairs = rawPairs.map(p => ({
        q: p.question_text,
        a: String(p.answer),
      }));

      // ★ runManager で結論生成
      const concl = await runManager({
        strengths_top5: meta?.strengths_top5 ?? [],
        demographics: meta?.demographics ?? {},
        qa_pairs,
      });

      const newMeta = {
        ...meta,
        next_step: {
          type: 'CONCLUDE',
          summary: concl.you_are,
          management: concl.management,
          next_week_plan: concl.next_week_plan,
        }
      };

      // セッションへ永続化
      await supabase
        .from('sessions')
        .update({
          summary: concl.you_are,
          metadata: newMeta,
          status: 'concluded',
        })
        .eq('id', id);

      // conclusions テーブルにも保存
      await supabase.from('conclusions').upsert({
        session_id: id,
        you_are: concl.you_are,
        management_do: concl.management.do,
        management_dont: concl.management.dont,
        next_week_plan: concl.next_week_plan,
      });

      return res.status(200).json({
        done: true,
        asked: st.asked,
        max: st.loop.maxQuestions,
        posterior: neutralPosterior(),
        metadata: { next_step: newMeta.next_step },
        trace_id: null,
      });
    }

    // ----- 進行中：メタ取得 -----
    const meta = sessionRow.data?.metadata ?? {};

    let q: { id: string; text: string; theme?: string } | null = null;

    // ----- 第1問目は seed_questions を優先 -----
    if (st.asked === 0) {
      const seeds: any[] = Array.isArray(meta.seed_questions) ? meta.seed_questions : [];
      const first = seeds[0];
      if (first && typeof first.text === 'string' && first.text.trim()) {
        q = { id: first.id ?? `QSEED_${Date.now()}`, text: first.text.trim(), theme: first.theme ?? '' };
        // 使った分を取り除いて永続化
        const newMeta = { ...meta, seed_questions: seeds.slice(1) };
        await supabase.from('sessions').update({ metadata: newMeta }).eq('id', id);
      }
    }

    // ----- 種が無い or 第2問以降は LLM で生成 -----
    if (!q) {
      // 既に回答がある場合は、metadata.next_step から質問を取得
      // （POST /answers で既に次の質問が生成されているため）
      if (meta?.next_step?.type === 'ASK' && meta.next_step.text) {
        q = {
          id: meta.next_step.question_id ?? `Q_${Date.now()}`,
          text: meta.next_step.text,
          theme: '',
        };
      } else {
        // まだ回答がない場合のみ、新規に質問を生成
        const answers = await fetchAnswerHistory(id);

        const t0 = Date.now();
        const qs = await genQuestionsLLM({
          strengths_top5: meta?.strengths_top5 ?? [],
          demographics: meta?.demographics ?? {},
          n: 1,
          avoid_texts: st.recentTexts,
          answers,
        });
        q = qs[0] ?? { id: `QF_${Date.now()}`, text: '今週、達成感があったことはありますか？', theme: '' };

        await recordTrace({
          session_id: id,
          model: OPENAI_MODEL,
          prompt: '(questions/next)',
          completion: JSON.stringify(q),
          latency_ms: Date.now() - t0,
        });
      }
    }

    // recentTexts に積む
    if (q?.text) {
      st.recentTexts = Array.from(new Set([q.text, ...st.recentTexts])).slice(0, 10);
    }

    // ★★★ 初手だけ assistant/question を turns に保存（ここが超重要）★★★
    if (st.asked === 0 && q?.id && q?.text) {
      await supabase.from('turns').insert({
        session_id: id,
        role: 'assistant',
        content: { type: 'question', question_id: q.id, text: q.text },
      });
    }

    return res.status(200).json({
      done: false,
      question: { id: q.id, text: q.text },
      progress: { asked: st.asked, max: st.loop.maxQuestions },
      hint: { topLabel: '', confidence: 0 },
      posterior: neutralPosterior(),
      trace_id: null,
    });
  } catch (e) {
    console.error('GET /questions/next error', e);
    return res.status(200).json({
      done: false,
      question: { id: `QF_${Date.now()}`, text: '直近で嬉しかったことはありますか？' },
      progress: { asked: 0, max: 1 },
      hint: { topLabel: '', confidence: 0 },
      posterior: neutralPosterior(),
    });
  }
});

app.post('/api/sessions/:id/answers', async (req, res) => {
  try {
    const { id } = req.params;
    const { questionId, answer, answerText } = req.body ?? {};
    if (!questionId) return sendErr(res, 400, 'questionId is required');

    const normalizedAnswer =
      typeof answer === 'string' && answer.trim().length > 0
        ? String(answer)
        : 'UNKNOWN';
    const normalizedText =
      typeof answerText === 'string' && answerText.trim().length > 0
        ? answerText.trim()
        : null;

    // 1) 回答を保存
    await supabase.from('turns').insert({
      session_id: id,
      role: 'user',
      content: {
        type: 'answer',
        question_id: questionId,
        answer: normalizedAnswer,
        answer_text: normalizedText,
      },
    });

    // 2) 確率（暫定）更新を turn にも保存
    const row = await supabase.from('sessions').select('asked_count, max_questions, metadata').eq('id', id).single();
    if (row.error || !row.data) return sendErr(res, 404, 'session not found');

    let asked_count = Number(row.data.asked_count ?? 0) + 1;
    const max_questions = Number(row.data.max_questions ?? 8);
    const meta = (row.data.metadata ?? {}) as any;
    const prevPost = meta?.posterior ?? null;
    const newPosterior = updatePosterior(prevPost, String(normalizedAnswer));

    // メモリ内の進捗も同期
    const st = loopOf(id);
    st.asked = asked_count;

    console.log(`[POST /answers] session=${id}, asked=${asked_count}, max=${max_questions}`);

    // 3) 収束判定
    if (asked_count >= max_questions) {
      console.log(`[POST /answers] Reached max questions, generating conclusion...`);
      const rawPairs = await fetchQAPairs(id);

      // runManager 用（{q,a}[] 形式）
      const qa_pairs = rawPairs.map(p => ({
        q: p.question_text,
        a: String(p.answer),
      }));

      const concl = await runManager({
        strengths_top5: meta?.strengths_top5 ?? [],
        demographics: meta?.demographics ?? {},
        qa_pairs,
      });

      const newMeta = {
        ...meta,
        posterior: newPosterior,
        next_step: {
          type: 'CONCLUDE',
          summary: concl.you_are,
          management: concl.management,
          next_week_plan: concl.next_week_plan,
        }
      };

      await supabase.from('sessions')
        .update({ asked_count, metadata: newMeta, status: 'concluded' })
        .eq('id', id);

      await supabase.from('conclusions').upsert({
        session_id: id,
        you_are: concl.you_are,
        management_do: concl.management.do,
        management_dont: concl.management.dont,
        next_week_plan: concl.next_week_plan,
      });

      return res.status(200).json({
        done: true,
        asked: asked_count,
        posterior: newPosterior,
        metadata: { next_step: newMeta.next_step }
      });
    }

    // 4) 継続：Interviewer で次の質問
    console.log(`[POST /answers] Continuing, generating next question...`);
    const rawPairsForInterviewer = await fetchQAPairs(id);
    const qa_pairs = rawPairsForInterviewer.slice(-10).map(p => ({
      q: p.question_text,
      a: String(p.answer),
    }));
    const inter = await runInterviewer({
      hypotheses: meta?.hypotheses ?? [],
      qa_pairs,
      strengths_top5: meta?.strengths_top5 ?? [],
      demographics: meta?.demographics ?? {},
    });

    console.log(`[POST /answers] Generated question: id=${inter.question.id}, text="${inter.question.text}"`);

    const next_step = {
      type: 'ASK',
      question_id: inter.question.id,
      text: inter.question.text,
      goal: inter.question.goal
    };

    const newMeta = { ...meta, posterior: newPosterior, next_step };
    await supabase.from('sessions')
      .update({ asked_count, metadata: newMeta })
      .eq('id', id);

    // assistant側の「次の質問」も turns に保存（任意）
    await supabase.from('turns').insert({
      session_id: id,
      role: 'assistant',
      content: { type: 'question', question_id: inter.question.id, text: inter.question.text },
      question_id: inter.question.id,
      posterior: newPosterior
    });

    // フロントエンドとの互換性のため、旧形式と新形式の両方を返す
    const response = {
      done: false,
      asked: asked_count,
      posterior: newPosterior,
      metadata: { next_step },
      // 旧形式（互換性）
      question: { id: inter.question.id, text: inter.question.text },
      progress: { asked: asked_count, max: max_questions },
      hint: { topLabel: '', confidence: 0 },
    };
    console.log(`[POST /answers] Response:`, JSON.stringify(response, null, 2));
    return res.status(200).json(response);
  } catch (e) {
    console.error('POST /answers error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

app.post('/api/sessions/:id/answers/undo', async (req, res) => {
  try {
    const { id } = req.params;
    const st = loopOf(id);

    // 進捗巻き戻し（永続化）
    st.asked = Math.max(0, st.asked - 1);
    await supabase.from('sessions').update({
      metadata: {
        ...( (await supabase.from('sessions').select('metadata').eq('id', id).single()).data?.metadata ?? {} ),
        loop: { ...st.loop, progressAsked: st.asked },
      }
    }).eq('id', id);

    // 直近回答の物理削除
    const last = await fetchLastAnswerTurn(id);
    let deleteInfo: {deleted?: string; error?: string} = {};
    if (last?.id) {
      const { error: delErr } = await supabase.from('turns').delete().eq('id', last.id);
      if (delErr) {
        console.warn('[undo] delete last answer failed:', delErr.message);
        deleteInfo.error = delErr.message;
      } else {
        deleteInfo.deleted = last.id;
      }
    }

    // 重複抑止バッファ巻き戻し
    st.recentTexts.shift();

    // 次の質問（現在位置）
    const row = await supabase.from('sessions').select('metadata').eq('id', id).single();
    const meta = row.data?.metadata ?? {};
    const qs = await genQuestionsLLM({
      strengths_top5: meta?.strengths_top5 ?? [],
      demographics: meta?.demographics ?? {},
      n: 1,
      avoid_texts: st.recentTexts,
    });
    const q = qs[0] ?? { id: `QF_${Date.now()}`, text: '最近の仕事で楽しかったことは？', theme: '' };
    if (q?.text) {
      st.recentTexts = Array.from(new Set([q.text, ...st.recentTexts])).slice(0, 10);
    }

    return res.status(200).json({
      done: false,
      question: { id: q.id, text: q.text },
      progress: { asked: st.asked, max: st.loop.maxQuestions },
      hint: { topLabel: '', confidence: 0 },
      posterior: neutralPosterior(),
      debug: deleteInfo,  // ★ 削除の可否を可視化
      trace_id: null,
    });
  } catch (e) {
    console.error('POST /answers/undo error', e);
    return res.status(500).json({ message: 'internal error' });
  }
});

/* -------------------------------- Loop config ------------------------------- */

app.patch('/api/sessions/:id/loop', async (req, res) => {
  try {
    const { id } = req.params;
    const { threshold, maxQuestions, minQuestions } = req.body ?? {};
    const st = loopOf(id);
    st.loop = {
      threshold: typeof threshold === 'number' ? Math.min(Math.max(threshold, 0.5), 0.99) : st.loop.threshold,
      maxQuestions: typeof maxQuestions === 'number' ? Math.min(Math.max(maxQuestions, 3), 12) : st.loop.maxQuestions,
      minQuestions: typeof minQuestions === 'number' ? Math.min(Math.max(minQuestions, 0), 10) : st.loop.minQuestions,
    };

    const prev = (await supabase.from('sessions').select('metadata').eq('id', id).single()).data?.metadata ?? {};
    await supabase
      .from('sessions')
      .update({ metadata: { ...prev, loop: st.loop } })
      .eq('id', id);

    return res.status(200).json({ ok: true, loop: st.loop });
  } catch (e) {
    console.error('PATCH /loop error', e);
    return res.status(500).json({ message: 'internal error' });
  }
});

/* --------------------------------- HITL API -------------------------------- */

app.post('/api/hitl/reviews', async (req, res) => {
  try {
    const {
      trace_id,
      target = 'question', // 'question' | 'management'
      comments,
      reviewer = 'anon',
      rubric_version = 'rubric_v1.0',
    } = req.body ?? {};

    if (!trace_id) return res.status(400).json({ error: 'trace_id is required' });

    const { data, error } = await supabase
      .from('hitl_reviews')
      .insert({
        target_type: 'trace',
        target_id: trace_id,
        reviewer,
        rating: null,
        comment: comments ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[HITL] insert error', error);
      return res.status(500).json({ error: 'failed to insert review' });
    }
    return res.status(201).json({ id: data?.id });
  } catch (e) {
    console.error('POST /api/hitl/reviews error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

/* --------------------------------- Actions --------------------------------- */

app.post('/api/sessions/:id/actions', async (req, res) => {
  const t0 = Date.now();
  try {
    const { id } = req.params;
    const { instruction } = req.body ?? {};
    ensureString(id, 'id');
    ensureString(instruction, 'instruction');

    // セッション存在チェック
    const sess = await supabase
      .from('sessions')
      .select('id, metadata, summary')
      .eq('id', id)
      .single();
    if (sess.error || !sess.data) return sendErr(res, 404, 'session not found');

    // 1) 指示を turns に保存（user）
    const userTurn = await supabase
      .from('turns')
      .insert({
        session_id: id,
        role: 'user',
        content: { type: 'instruction', text: String(instruction) },
      })
      .select('id, created_at')
      .single();
    if (userTurn.error) return sendErr(res, 500, 'failed to insert user turn');

    function clamp(s: string, max = 2000) { return s.length > max ? s.slice(0, max) : s; }

    // 2) LLM 呼び出し（STAR要約＋次の一歩）
    const system = `あなたは1on1の要約・次の一歩設計アシスタントです。
- 出力は必ず JSON のみ。
- スキーマ:
{
  "summary": "<2〜4文の日本語要約>",
  "next_steps": ["<短いTODO>", "..."]
}`;
    const user = `前提メモ: ${clamp(sess.data.summary ?? '(なし)')}
メタ情報: ${clamp(JSON.stringify(sess.data.metadata ?? {}), 2000)}
指示: ${clamp(instruction, 500)}
制約:
- next_steps は 3 件までで短く具体的に
- JSON 以外の文字は出力しない`;

    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    // 生成結果のパースと正規化
    const content = resp.choices?.[0]?.message?.content ?? '{}';
    const parsed = extractJson(content) ?? {};
    const summary =
      typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const next_steps: string[] = (Array.isArray(parsed.next_steps)
      ? parsed.next_steps
      : []
    )
      .map((s: any) => (typeof s === 'string' ? s.trim() : ''))
      .filter((s: string) => !!s)
      .slice(0, 3); // 最大3件に制限

    // 3) 保存：assistant turn
    const asstTurn = await supabase
      .from('turns')
      .insert({
        session_id: id,
        role: 'assistant',
        content: { summary, next_steps, citations: [] },
      })
      .select('id')
      .single();
    if (asstTurn.error) return sendErr(res, 500, 'failed to insert assistant turn');

    // 4) セッションに summary を永続化 + 次の一歩を metadata に反映（1回だけ更新）
    const prevMeta = (sess.data.metadata ?? {}) as Record<string, any>;
    const mergedMeta = { ...prevMeta, next_steps };
    const { error: updErr } = await supabase
      .from('sessions')
      .update({ summary, metadata: mergedMeta })
      .eq('id', id);
    if (updErr) {
      console.error('[actions] update session summary/meta failed', updErr);
      // 失敗しても致命ではないので続行
    }

    // 5) トレース
    const traceId = await recordTrace({
      session_id: id,
      turn_id: asstTurn.data?.id,
      model: OPENAI_MODEL,
      prompt: JSON.stringify({ system, user }),
      completion: JSON.stringify({ summary, next_steps }),
      latency_ms: Date.now() - t0,
    });

    // 6) フロント互換レスポンス
    return res.status(200).json({
      id,
      createdAt: new Date().toISOString(),
      output: { summary, hypotheses: [], next_steps, citations: [], persona: null },
      loop: { threshold: 0.9, maxQuestions: 8, minQuestions: 0 },
      trace_id: traceId || null,
    });
  } catch (e: any) {
    console.error('POST /actions error', e);
    return sendErr(res, 500, 'internal error', '指示文の形式やOpenAIキーを確認してください');
  }
});

// --------------------------- RAG: Knowledge Import ---------------------------
app.post('/api/knowledge/import', async (req, res) => {
  try {
    const { title, url, source, metadata, chunks } = req.body ?? {};

    if (!Array.isArray(chunks) || chunks.length === 0) {
      return res.status(400).json({ error: 'chunks is required (non-empty array)' });
    }

    const result = await upsertKnowledgeDoc({
      source: source ?? 'manual',
      title: String(title ?? ''),
      url: typeof url === 'string' ? url : null,
      metadata: (metadata && typeof metadata === 'object') ? metadata : {},
      chunks: chunks.map((c: any) => ({
        content: String(c?.content ?? ''),
        metadata: (c?.metadata && typeof c.metadata === 'object') ? c.metadata : {},
      })),
    });

    return res.status(201).json({ ok: true, doc_id: result.doc_id, chunks: chunks.length });
  } catch (e: any) {
    console.error('POST /api/knowledge/import error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// 追加: RAG 検索プレビュー用
app.get('/api/knowledge/search', async (req, res) => {
  try {
    const q = String(req.query.q ?? '');
    const top = Number(req.query.k ?? 3);
    if (!q.trim()) return res.status(400).json({ error: 'q is required' });
    const hits = await retrieveTopK(q, Math.min(Math.max(top, 1), 10));
    res.json({ hits });
  } catch (e:any) {
    console.error('[GET /knowledge/search]', e);
    res.status(500).json({ error: 'internal error' });
  }
});

/* --------------------------------- Listen ---------------------------------- */

app.listen(PORT, () => {
  console.log(`[server] up on http://localhost:${PORT}`);
}).on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] ポート ${PORT} は使用中です。別のPORTを使うか、占有プロセスを終了してください。`);
  } else {
    console.error('[server] listen error:', err);
  }
});
