import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

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
    const size = Number(n) || 3;

    // 既存metadataを取得
    const sel = await supabase
      .from('sessions')
      .select('id, metadata')
      .eq('id', id)
      .single();

    let row = sel.data; // ← ローカル変数に逃がす

    if (sel.error || !row) {
      // 無ければ作成
      const ins = await supabase
        .from('sessions')
        .insert({
          id,
          title: '(auto-created)',
          summary: null,
          metadata: {},
        })
        .select('id, metadata')
        .single();

      if (ins.error || !ins.data) {
        console.error('auto-insert error', ins.error);
        return res.status(500).json({ error: 'failed to create session' });
      }
      row = ins.data; // ← row に代入（sel.data へは代入しない）
    }

    const meta = (row.metadata ?? {}) as Record<string, any>;

    const seed_questions: string[] = [
      '直近で「うまくいった」出来事は？',
      'それを支えた強みは何？',
      '次の1週間で小さく試せることは？',
      '想定リスクと対策は？',
      '成功のサインは何？',
    ].slice(0, size);

    const next_steps: Array<{ title: string; due: string | null }> = [
      { title: '小さな実験を1つ決める', due: null },
      { title: '実験の記録テンプレを用意', due: null },
    ];

    const newMeta = {
      ...meta,
      strengths_top5: strengths_top5 ?? meta.strengths_top5,
      demographics: demographics ?? meta.demographics,
      seed_questions,
      next_steps,
    };

    const upd = await supabase
      .from('sessions')
      .update({ metadata: newMeta })
      .eq('id', id)
      .select('id')
      .single();

    if (upd.error) {
      console.error('supabase update error', {
        message: (upd.error as any).message,
        details: (upd.error as any).details,
        hint: (upd.error as any).hint,
        code: (upd.error as any).code,
      });
      return res.status(500).json({ error: 'failed to update session' });
    }

    const questions = (seed_questions || []).map((text: string, i: number) => ({
      id: `SQ${i + 1}`,
      theme: (Array.isArray(newMeta.strengths_top5) && newMeta.strengths_top5[i]) || '汎用',
      text,
    }));

    return res.status(200).json({ questions });
  } catch (e) {
    console.error('POST /api/sessions/:id/seed-questions internal error', e);
    return res.status(500).json({ error: 'internal error' });
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
