import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!, // .env に設定
});
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  {
    global: {
      fetch: globalThis.fetch,  
    },
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

async function genQuestionsLLM(opts: {
  strengths_top5?: string[];
  demographics?: Record<string, any>;
  n: number;
}) {
  const { strengths_top5 = [], demographics = {}, n } = opts;

  const system = `あなたは1on1のための質問設計エージェントです。
入力の strengths_top5, demographics, n に基づき、
{ "questions": [ { "theme": "<資質名>", "text": "<日本語の質問文>" }, ... ] }
というJSONを厳密に返してください。余計な前置きや説明文は書かないでください。
制約:
- 配列長は n 件
- text は具体的で、5〜40文字程度
- theme は strengths_top5 から選ぶ（不足する場合は関連の強い資質名を推定）
- 質問は YES/NO を想定した短い文（例:「歴史の本が好きですか？」）`;

  const user = `ストレングス: ${JSON.stringify(strengths_top5, null, 0)}
属性: ${JSON.stringify(demographics, null, 0)}
個数: ${n}
出力は必ずJSONのみ`;

  const resp = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.4,
    response_format: { type: 'json_object' as const },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const content = resp.choices?.[0]?.message?.content ?? '{}';
  let parsed: any;
  try { parsed = JSON.parse(content); } catch { parsed = {}; }
  const arr = Array.isArray(parsed?.questions) ? parsed.questions : [];

  // 正規化（id 補完）
  return arr
    .slice(0, n)
    .map((q: any, i: number) => ({
      id: q?.id ?? `Q${Date.now()}_${i + 1}`,
      theme: String(q?.theme ?? '').trim(),
      text: String(q?.text ?? '').trim(),
    }))
    .filter((q: any) => q.text);
}

type LoopState = { asked: number; loop: { threshold: number; maxQuestions: number; minQuestions: number } };
const LOOP: Record<string, LoopState> = {};
function loopOf(id: string): LoopState {
  return (LOOP[id] ??= { asked: 0, loop: { threshold: 0.9, maxQuestions: 8, minQuestions: 0 } });
}
// ニュートラル posterior（UI破綻回避用）
function neutralPosterior() {
  return {
    TYPE_STRATEGY: 0.2,
    TYPE_EMPATHY: 0.2,
    TYPE_EXECUTION: 0.2,
    TYPE_ANALYTICAL: 0.2,
    TYPE_STABILITY: 0.2,
  };
}


const app = express();
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
const PORT = Number(process.env.PORT ?? 8787);

const corsOptions: cors.CorsOptions = {
  origin: ORIGIN,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  exposedHeaders: ['Content-Length','X-Request-Id'],
};
app.use(cors(corsOptions));
app.options('/health', cors(corsOptions));

app.use(express.json());

app.get('/health', (_req, res) => res.send('ok'));

/** セッション作成: Supabaseに保存し、id を返す */
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
          seed_questions: []
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

    const output = {
      summary: data.summary ?? '',
      hypotheses: [],         // ひとまず空でOK（後でLLM統合時に上書き）
      next_steps,
      citations: [],
      persona: null,
    };
    const loop = { threshold: 0.9, maxQuestions: 8, minQuestions: 0 };

    return res.status(201).json({
      id: data.id,
      createdAt: data.created_at ?? new Date().toISOString(),
      output,
      loop,
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

    if (error) {
      // 見つからない場合もフロントが落ちない形で返すなら、型を合わせる
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

    const meta = (data?.metadata ?? {}) as Record<string, any>;
    const next_steps: string[] = Array.isArray(meta.next_steps) ? meta.next_steps : [];

    return res.status(200).json({
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
    console.error('GET /api/sessions/:id internal error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

app.post('/api/sessions/:id/seed-questions', async (req, res) => {
  try {
    const { id } = req.params;
    const { strengths_top5, demographics, n } = req.body ?? {};
    const size = Number(n) || 5;

    // セッション row を用意（無ければ作成）
    let row = (
      await supabase.from('sessions').select('id, metadata').eq('id', id).single()
    ).data;
    if (!row) {
      const ins = await supabase.from('sessions')
        .insert({ id, title: '(auto-created)', metadata: {} })
        .select('id, metadata')
        .single();
      if (ins.error || !ins.data) {
        return res.status(500).json({ error: 'failed to create session' });
      }
      row = ins.data;
    }

    // LLM で質問生成（ハードコード配列を廃止）
    const questions = await genQuestionsLLM({
      strengths_top5: strengths_top5 ?? row.metadata?.strengths_top5 ?? [],
      demographics: demographics ?? row.metadata?.demographics ?? {},
      n: size,
    });

    // 保存（必要に応じて）
    const newMeta = {
      ...(row.metadata ?? {}),
      strengths_top5: strengths_top5 ?? row.metadata?.strengths_top5,
      demographics: demographics ?? row.metadata?.demographics,
      seed_questions: questions, // 形式そのまま保存
    };
    await supabase.from('sessions').update({ metadata: newMeta }).eq('id', id);

    return res.status(200).json({ questions });
  } catch (e) {
    console.error('POST /seed-questions error', e);
    // 最小フォールバック（LLM失敗時）
    return res.status(200).json({
      questions: [
        { id: `QF_${Date.now()}`, theme: '', text: '直近日常で嬉しかったことはありますか？' },
      ],
    });
  }
});

app.get('/api/sessions/:id/questions/next', async (req, res) => {
  try {
    const { id } = req.params;
    const st = loopOf(id);

    // max に到達していれば done
    if (st.asked >= st.loop.maxQuestions && st.asked >= st.loop.minQuestions) {
      return res.status(200).json({
        done: true,
        top: { id: 'TYPE_EXECUTION', label: '実行', confidence: 0 }, // ダミー（UI互換用）
        next_steps: [],
        asked: st.asked,
        max: st.loop.maxQuestions,
        posterior: neutralPosterior(),
        evidence: [],
      });
    }

    // セッション情報（Top5/デモグラ）を読み込み
    const row = await supabase.from('sessions').select('metadata').eq('id', id).single();
    const meta = row.data?.metadata ?? {};

    // LLM で1問生成（n=1）
    const qs = await genQuestionsLLM({
      strengths_top5: meta?.strengths_top5 ?? [],
      demographics: meta?.demographics ?? {},
      n: 1,
    });
    const q = qs[0] ?? { id: `QF_${Date.now()}`, text: '今週、達成感があったことはありますか？', theme: '' };

    return res.status(200).json({
      done: false,
      question: { id: q.id, text: q.text },
      progress: { asked: st.asked, max: st.loop.maxQuestions },
      hint: { topLabel: '', confidence: 0 }, // ベイズ無しなので空
      posterior: neutralPosterior(),
    });
  } catch (e) {
    console.error('GET /questions/next error', e);
    // フォールバック：最低限の形
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
        top: { id: 'TYPE_EXECUTION', label: '実行', confidence: 0 }, // UI互換用
        next_steps: [],
        asked: st.asked,
        max: st.loop.maxQuestions,
        posterior: neutralPosterior(),
        evidence: [],
      });
    }

    // 続ける場合は次問を生成
    const row = await supabase.from('sessions').select('metadata').eq('id', id).single();
    const meta = row.data?.metadata ?? {};
    const qs = await genQuestionsLLM({
      strengths_top5: meta?.strengths_top5 ?? [],
      demographics: meta?.demographics ?? {},
      n: 1,
    });
    const q = qs[0] ?? { id: `QF_${Date.now()}`, text: '直近の小さな成功はありますか？', theme: '' };

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

    // 直後に次問（= 現在位置の問）を提示
    const row = await supabase.from('sessions').select('metadata').eq('id', id).single();
    const meta = row.data?.metadata ?? {};
    const qs = await genQuestionsLLM({
      strengths_top5: meta?.strengths_top5 ?? [],
      demographics: meta?.demographics ?? {},
      n: 1,
    });
    const q = qs[0] ?? { id: `QF_${Date.now()}`, text: '最近の仕事で楽しかったことは？', theme: '' };

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
    // （任意）sessions.metadata.loop にも保存しておくと復元が楽
    await supabase.from('sessions').update({
      metadata: {
        ...( (await supabase.from('sessions').select('metadata').eq('id', id).single()).data?.metadata ?? {} ),
        loop: st.loop,
      }
    }).eq('id', id);

    return res.status(200).json({ ok: true, loop: st.loop });
  } catch (e) {
    console.error('PATCH /loop error', e);
    return res.status(500).json({ message: 'internal error' });
  }
});

app.listen(PORT, () => {
  console.log(`[server] up on http://localhost:${PORT}`);
}).on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] ポート ${PORT} は使用中です。別のPORTを使うか、占有プロセスを終了してください。`);
  } else {
    console.error('[server] listen error:', err);
  }
});
