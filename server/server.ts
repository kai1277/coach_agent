// server/server.ts
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

/* ----------------------------- OpenAI / Supabase ---------------------------- */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!, // .env に設定
});

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!, // サービスロール鍵があればそちらを推奨
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

async function retrieveTopK(query: string, k = 3): Promise<Array<{ content: string }>> {
  try {
    const emb = await openai.embeddings.create({ model: OPENAI_EMBED_MODEL, input: query });
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

/* --------------------------- LLM Question Generator ------------------------- */

async function callLLMJSON(params: {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  model?: string;
  temperature?: number;
  session_id?: string;
  label?: string;   // どの用途か（seed, next, actions 等）
  timeoutMs?: number;
}) {
  const {
    messages,
    model = OPENAI_MODEL,
    temperature = 0.2,
    session_id,
    label = 'actions',
    timeoutMs = 20_000,
  } = params;

  const t0 = Date.now();
  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort('timeout'), timeoutMs);

  try {
    const resp = await openai.chat.completions.create(
      { model, temperature, messages },
      { signal: ac.signal as any }
    );
    const content = resp.choices?.[0]?.message?.content ?? '{}';
    const json = extractJson(content) ?? {};
    await recordTrace({
      session_id,
      model,
      prompt: JSON.stringify(messages),
      completion: content,
      latency_ms: Date.now() - t0,
    });
    return json;
  } finally {
    clearTimeout(tm);
  }
}

type Question = { id: string; theme: string; text: string };

async function genQuestionsLLM(opts: {
  strengths_top5?: string[];
  demographics?: Record<string, any>;
  n: number;
  avoid_texts?: string[];
}): Promise<Question[]> {
  const { strengths_top5 = [], demographics = {}, n, avoid_texts = [] } = opts;

  // RAG用知識を取り込み
  const query = JSON.stringify({ strengths_top5, demographics });
  const kb = await retrieveTopK(query, 3);
  const context = kb.map((c, i) => `KB${i + 1}: ${c.content}`).join('\n');

  const system = `あなたは1on1のための質問設計エージェントです。
以下の [CONTEXT]（知識断片）を“参考”に、要件を満たす日本語の質問だけをJSONで返してください。
必ず JSON のみを出力し、前置きや説明は書かないでください。

[CONTEXT]
${context || '(コンテキストなし)'}
`;

  const user = `入力:
- strengths_top5: ${JSON.stringify(strengths_top5)}
- demographics: ${JSON.stringify(demographics)}
- n: ${n}
- avoid_texts（この文面は出さない）: ${JSON.stringify(avoid_texts)}

出力スキーマ（厳守）:
{ "questions": [ { "theme": "<資質名>", "text": "<日本語の質問文(5〜40文字/YES-NO回答想定)>" }, ... ] }`;

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
  const arr: any[] = Array.isArray(parsed?.questions) ? parsed.questions : [];

  const out: Question[] = arr
    .slice(0, n)
    .map((q: any, i: number) => ({
      id: q?.id ?? `Q${Date.now()}_${i + 1}`,
      theme: String(q?.theme ?? '').trim(),
      text: String(q?.text ?? '').trim(),
    }))
    .filter((q: Question) => q.text);

  await recordTrace({
    model: OPENAI_MODEL,
    prompt: JSON.stringify({ system, user }),
    completion: JSON.stringify(out),
    latency_ms: Date.now() - t0,
  });

  return out;
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

app.get('/api/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('sessions')
      .select('id, summary, metadata, created_at')
      .eq('id', id)
      .single();

    if (error || !data) {
      // 見つからない場合も型を合わせて返す（UIを壊さない）
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

/* --------------------------- Seed Questions (LLM) --------------------------- */

app.post('/api/sessions/:id/seed-questions', async (req, res) => {
  try {
    const { id } = req.params;
    const { strengths_top5, demographics, n } = req.body ?? {};
    const size = Number(n) || 5;

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

    // メタに保存（監査/再生成のため）
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
    // 最小フォールバック
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

    if (st.asked >= st.loop.maxQuestions && st.asked >= st.loop.minQuestions) {
      return res.status(200).json({
        done: true,
        top: { id: 'TYPE_EXECUTION', label: '実行', confidence: 0 },
        next_steps: [],
        asked: st.asked,
        max: st.loop.maxQuestions,
        posterior: neutralPosterior(),
        evidence: [],
      });
    }

    const row = await supabase.from('sessions').select('metadata').eq('id', id).single();
    const meta = row.data?.metadata ?? {};

    const t0 = Date.now();
    const qs = await genQuestionsLLM({
      strengths_top5: meta?.strengths_top5 ?? [],
      demographics: meta?.demographics ?? {},
      n: 1,
      avoid_texts: st.recentTexts,
    });
    const q = qs[0] ?? { id: `QF_${Date.now()}`, text: '今週、達成感があったことはありますか？', theme: '' };

    // 最近の文面に追加（重複抑止）
    if (q?.text) {
      st.recentTexts = Array.from(new Set([q.text, ...st.recentTexts])).slice(0, 10);
    }

    await recordTrace({
      session_id: id,
      model: OPENAI_MODEL,
      prompt: '(questions/next)',
      completion: JSON.stringify(q),
      latency_ms: Date.now() - t0,
    });

    await supabase.from('turns').insert({
      session_id: id,
      role: 'user',
      content: { type: 'answer', question_id: req.body?.questionId, answer: req.body?.answer },
    });

    return res.status(200).json({
      done: false,
      question: { id: q.id, text: q.text },
      progress: { asked: st.asked, max: st.loop.maxQuestions },
      hint: { topLabel: '', confidence: 0 },
      posterior: neutralPosterior(),
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
    st.asked += 1;

    if (st.asked >= st.loop.maxQuestions && st.asked >= st.loop.minQuestions) {
      return res.status(200).json({
        done: true,
        top: { id: 'TYPE_EXECUTION', label: '実行', confidence: 0 },
        next_steps: [],
        asked: st.asked,
        max: st.loop.maxQuestions,
        posterior: neutralPosterior(),
        evidence: [],
      });
    }

    const row = await supabase.from('sessions').select('metadata').eq('id', id).single();
    const meta = row.data?.metadata ?? {};

    const qs = await genQuestionsLLM({
      strengths_top5: meta?.strengths_top5 ?? [],
      demographics: meta?.demographics ?? {},
      n: 1,
      avoid_texts: st.recentTexts,
    });
    const q = qs[0] ?? { id: `QF_${Date.now()}`, text: '直近の小さな成功はありますか？', theme: '' };

    await supabase.from('turns').insert({
      session_id: id,
      role: 'user',
      content: { type: 'answer', question_id: req.body?.questionId, answer: req.body?.answer },
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
    st.asked = Math.max(0, st.asked - 1);

    // 直近に追加した1件を先頭から取り除く（重複抑止バッファも巻き戻す）
    st.recentTexts.shift();

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
      // score_* / labels / suggestion などは将来 column を拡張して取り込む
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

app.post('/api/sessions/:id/actions', async (req, res) => {
  try {
    const { id } = req.params;
    const { instruction } = req.body ?? {};
    if (!instruction || typeof instruction !== 'string') {
      return res.status(400).json({ message: 'instruction is required' });
    }

    // 既存セッション読み込み
    const sel = await supabase
      .from('sessions')
      .select('id, summary, metadata, created_at')
      .eq('id', id)
      .single();

    if (sel.error || !sel.data) {
      return res.status(404).json({ message: 'session not found' });
    }
    const row = sel.data as any;
    const meta = (row.metadata ?? {}) as Record<string, any>;

    const strengths_top5 = meta.strengths_top5 ?? [];
    const demographics   = meta.demographics ?? {};
    const seed_questions = meta.seed_questions ?? [];
    const prev_summary   = row.summary ?? '';
    const prev_steps     = Array.isArray(meta.next_steps) ? meta.next_steps : [];

    // RAG で少し補助（任意：instruction + 既存サマリで検索）
    const kb = await retrieveTopK(
      JSON.stringify({ instruction, prev_summary, strengths_top5, demographics }),
      3
    );
    const context = kb.map((c, i) => `KB${i + 1}: ${c.content}`).join('\n');

    // LLM へ（JSONのみを返す制約）
    const system = `あなたは1on1コーチングの要約・提案を整えるアシスタントです。
以下の知識や過去の要約・次の一歩、ユーザー指示を踏まえ、
必ず JSON のみで返答してください。

[CONTEXT]
${context || '(なし)'}
`;
    const user = `入力:
- strengths_top5: ${JSON.stringify(strengths_top5)}
- demographics: ${JSON.stringify(demographics)}
- 既存summary: ${JSON.stringify(prev_summary)}
- 既存next_steps: ${JSON.stringify(prev_steps)}
- 種質問サンプル: ${JSON.stringify(seed_questions)}
- 指示: ${JSON.stringify(instruction)}

出力スキーマ:
{
  "summary": "<日本語の要約。先頭に【更新】などは不要。150字以内>",
  "next_steps": ["<短い実行ステップ>", "..."]  // 1〜5件
}`;
    const json = await callLLMJSON({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      session_id: id,
      label: 'actions',
      temperature: 0.3,
      timeoutMs: 25_000,
    });

    const newSummary = String(json?.summary ?? prev_summary ?? '').slice(0, 500);
    const newStepsRaw = Array.isArray(json?.next_steps) ? json.next_steps : [];
    const newSteps = newStepsRaw
      .map((s: any) => String(s || '').trim())
      .filter((s: string) => s)
      .slice(0, 5);

    // 保存（summary/next_steps）
    const newMeta = {
      ...meta,
      next_steps: newSteps.length ? newSteps : prev_steps,
    };
    const upd = await supabase
      .from('sessions')
      .update({ summary: newSummary, metadata: newMeta })
      .eq('id', id)
      .select('id, summary, metadata, created_at')
      .single();

    if (upd.error || !upd.data) {
      return res.status(500).json({ message: 'failed to update session' });
    }

    // フロント互換の形で返す（GET と同等のフォーマット）
    const meta2 = (upd.data.metadata ?? {}) as Record<string, any>;
    const next_steps = Array.isArray(meta2.next_steps) ? meta2.next_steps : [];
    return res.status(200).json({
      id: upd.data.id,
      createdAt: upd.data.created_at ?? new Date().toISOString(),
      output: {
        summary: upd.data.summary ?? '',
        hypotheses: [],
        next_steps,
        citations: [],
        persona: null,
      },
      loop: { threshold: 0.9, maxQuestions: 8, minQuestions: 0 },
    });
  } catch (e) {
    console.error('POST /api/sessions/:id/actions error', e);
    return res.status(500).json({ message: 'internal error' });
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
