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

/* --------------------------- LLM Question Generator ------------------------- */

type Question = { id: string; theme: string; text: string };

async function genQuestionsLLM(
  opts: {
    strengths_top5?: string[];
    demographics?: Record<string, any>;
    n: number;
    avoid_texts?: string[];
  }
): Promise<Question[]> {
  const { strengths_top5 = [], demographics = {}, n, avoid_texts = [] } = opts;

  // RAG用知識を取り込み
  const query = JSON.stringify({ strengths_top5, demographics });
  const kb = await retrieveTopK(
    {
      strengths_top5,
      demographics,
      avoid_texts,
      n,
      purpose: '1on1 coaching: generate concise yes/no seed questions',
      // 追加で混ぜたいメタがあれば extra に
      extra: {
        // 例: ドメイン、プロダクト名、セッションの context など
        // context: 'interview practice',
      },
    },
    3 // k
  );
  const context = kb.map((c, i) => `KB${i + 1}: ${c.content}`).join('\n');

  const system = `あなたは1on1のための質問設計エージェントです。
以下の [CONTEXT]（知識断片）を“参考”に、要件に合う日本語の質問だけをJSONで返してください。
必ず JSON のみを出力し、前置きや説明は書かないでください。

[CONTEXT]
${context || '(コンテキストなし)'}
`;

const user = `入力:
- strengths_top5: ${JSON.stringify(strengths_top5)}
- demographics: ${JSON.stringify(demographics)}
- n: ${n}
- avoid_texts（この文面は出さない）: ${JSON.stringify(avoid_texts)}

要件（特に n=1 のとき厳守）:
- ストレングスTop5と基本属性を総合し、最初の1問として「最も効果が高い1問」を設計する
- YES/NO で答えられるが、内省を促し会話の質を高める問い
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

/* --------------------------- LLM NextStep Generater ------------------------- */

async function genNextStepsLLM(opts: {
  strengths_top5?: string[];
  demographics?: Record<string, any>;
  qa_pairs: Array<{ question_text: string; answer: string }>;
  n?: number; // デフォルト3
}) {
  const { strengths_top5 = [], demographics = {}, qa_pairs = [], n = 3 } = opts;

  // RAG も活用（ストレングス・デモグラ・回答概要を条件に混ぜる）
  const ragQuery = JSON.stringify({
    strengths_top5,
    demographics,
    answers: qa_pairs.slice(-10).map(p => ({ q: p.question_text, a: p.answer })), // 直近10件だけ
  });
  const kb = await retrieveTopK(ragQuery, 4);
  const context = kb.map((c, i) => `KB${i + 1}: ${c.content}`).join('\n');

  const system = `あなたは1on1のコーチングアシスタントです。
ストレングスや属性、Q&A履歴を踏まえ、短く具体的な「次の一歩」（ToDo）を日本語で提案します。
- 出力は JSON のみ
- 1件あたり40文字以内 / 箇条書き
- 行動の主体はユーザー本人
- 安全で実行可能、今週から着手できる内容`;

  const user = `前提:
- strengths_top5: ${JSON.stringify(strengths_top5)}
- demographics: ${JSON.stringify(demographics)}
- qa_pairs(最新→古い): ${JSON.stringify(qa_pairs.slice().reverse())}

参考知識:
${context || '(なし)'}

出力スキーマ(厳守):
{ "next_steps": ["<短いToDo>", "<短いToDo>", "<短いToDo>"] }`;

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
  const parsed = extractJson(content) ?? {};
  const next_steps: string[] = (Array.isArray(parsed.next_steps) ? parsed.next_steps : [])
    .map((s: any) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .slice(0, n);

  await recordTrace({
    model: OPENAI_MODEL,
    prompt: JSON.stringify({ system, user }),
    completion: JSON.stringify({ next_steps }),
    latency_ms: Date.now() - t0,
  });

  return next_steps;
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

/* ------------------------------- Session APIs ------------------------------- */

app.post('/api/sessions', async (req, res) => {
  try {
    const { transcript, context, strengths_top5, demographics } = req.body ?? {};
    if (!transcript) return res.status(400).json({ error: 'transcript is required' });

    const ctx = context ?? 'general';

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        title: String(transcript).slice(0, 40),
        summary: null,
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

    const t0 = Date.now();
    const questions = await genQuestionsLLM({
      strengths_top5: strengths_top5 ?? row.metadata?.strengths_top5 ?? [],
      demographics: demographics ?? row.metadata?.demographics ?? {},
      n: size,
      avoid_texts: st.recentTexts,
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

    // 完了条件（そのまま）
    if (st.asked >= st.loop.maxQuestions && st.asked >= st.loop.minQuestions) {
      return res.status(200).json({
        done: true,
        top: { id: 'TYPE_EXECUTION', label: '実行', confidence: 0 },
        next_steps: [],
        asked: st.asked,
        max: st.loop.maxQuestions,
        posterior: neutralPosterior(),
        evidence: [],
        trace_id: null,
      });
    }

    // セッションのメタを取得し、asked 巻き上げを反映
    const row = await supabase.from('sessions').select('metadata').eq('id', id).single();
    const meta = row.data?.metadata ?? {};
    const prevAsked = meta?.loop?.progressAsked;
    if (typeof prevAsked === 'number' && prevAsked > (st.asked ?? 0)) {
      st.asked = prevAsked;
    }

    let q: { id: string; text: string; theme?: string } | null = null;

    // ★ 第1問だけ、seed_questions を優先的に消費して使う
    if (st.asked === 0) {
      const seeds: any[] = Array.isArray(meta.seed_questions) ? meta.seed_questions : [];
      const first = seeds[0];
      if (first && typeof first.text === 'string' && first.text.trim()) {
        q = { id: first.id ?? `QSEED_${Date.now()}`, text: first.text.trim(), theme: first.theme ?? '' };
        // 使った分を取り除いて永続化（任意・履歴を残したいならフラグにする）
        const newMeta = { ...meta, seed_questions: seeds.slice(1) };
        await supabase.from('sessions').update({ metadata: newMeta }).eq('id', id);
      }
    }

    // 種が無い or 第2問以降は LLM で1問生成
    if (!q) {
      const t0 = Date.now();
      const qs = await genQuestionsLLM({
        strengths_top5: meta?.strengths_top5 ?? [],
        demographics: meta?.demographics ?? {},
        n: 1,
        avoid_texts: st.recentTexts,
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

    // recentTexts に積む
    if (q?.text) {
      st.recentTexts = Array.from(new Set([q.text, ...st.recentTexts])).slice(0, 10);
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
    const st = loopOf(id);

    // 1) まず回答を保存
    await supabase.from('turns').insert({
      session_id: id,
      role: 'user',
      content: { type: 'answer', question_id: req.body?.questionId, answer: req.body?.answer },
    });

    // 2) 進捗を更新
    st.asked += 1;
    await supabase.from('sessions').update({
      metadata: {
        ...( (await supabase.from('sessions').select('metadata').eq('id', id).single()).data?.metadata ?? {} ),
        loop: { ...st.loop, progressAsked: st.asked },
      }
    }).eq('id', id);

    // 3) 完了判定は「回答保存後」に行う
    if (st.asked >= st.loop.maxQuestions && st.asked >= st.loop.minQuestions) {
      // 3-1) 次の一歩を生成
      const row = await supabase.from('sessions').select('metadata').eq('id', id).single();
      const meta = row.data?.metadata ?? {};
      const qa_pairs = await fetchQAPairs(id);
      const next_steps = await genNextStepsLLM({
        strengths_top5: meta?.strengths_top5 ?? [],
        demographics: meta?.demographics ?? {},
        qa_pairs,
        n: 3,
      });

      // 3-2) セッションに永続化
      const mergedMeta = { ...meta, next_steps };
      await supabase.from('sessions').update({ metadata: mergedMeta }).eq('id', id);

      return res.status(200).json({
        done: true,
        top: { id: 'TYPE_EXECUTION', label: '実行', confidence: 0 },
        next_steps,
        asked: st.asked,
        max: st.loop.maxQuestions,
        posterior: neutralPosterior(),
        evidence: [],       // ここは必要なら将来、寄与ロジックで埋める
        trace_id: null,
      });
    }

    // 4) 継続の場合は次の質問を作る
    const row = await supabase.from('sessions').select('metadata').eq('id', id).single();
    const meta = row.data?.metadata ?? {};

    const t0 = Date.now();
    const qs = await genQuestionsLLM({
      strengths_top5: meta?.strengths_top5 ?? [],
      demographics: meta?.demographics ?? {},
      n: 1,
      avoid_texts: st.recentTexts,
    });
    const q = qs[0] ?? { id: `QF_${Date.now()}`, text: '直近の小さな成功はありますか？', theme: '' };

    // turns に質問を保存（継続時も入れる）
    await supabase.from('turns').insert({
      session_id: id,
      role: 'assistant',
      content: { type: 'question', question_id: q.id, text: q.text },
    });

    const traceId = await recordTrace({
      session_id: id,
      model: OPENAI_MODEL,
      prompt: '(answers -> generate next)',
      completion: JSON.stringify(q),
      latency_ms: Date.now() - t0,
    });

    if (q?.text) {
      st.recentTexts = Array.from(new Set([q.text, ...st.recentTexts])).slice(0, 10);
    }

    return res.status(200).json({
      done: false,
      question: { id: q.id, text: q.text },
      progress: { asked: st.asked, max: st.loop.maxQuestions },
      hint: { topLabel: '', confidence: 0 },
      posterior: neutralPosterior(),
      trace_id: traceId || null,
    });
  } catch (e) {
    console.error('POST /answers error', e);
    return res.status(500).json({ message: 'internal error' });
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
