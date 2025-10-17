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

    // sessions テーブルは少なくとも: id(UUID), title(text), summary(text|null), metadata(jsonb) を想定
    const { data, error } = await supabase
      .from('sessions')
      .insert({
        title: String(transcript).slice(0, 40),
        summary: null,
        metadata: {
          context: ctx,
          strengths_top5,
          demographics,
          // 初期値を入れておくとUIが安全
          next_steps: [],
          seed_questions: []
        },
      })
      .select('id, summary, metadata')
      .single();

    if (error) {
        console.error('supabase insert error', {
            message: error.message,
            details: (error as any).details,
            hint: (error as any).hint,
            code: (error as any).code,
        });
        return res.status(500).json({ error: 'failed to create session' });
        }
        

    const next_steps = data.metadata?.next_steps ?? [];
    return res.status(201).json({ id: data.id, summary: data.summary, next_steps });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'internal error' });
  }
});

/** セッション取得: Supabaseから読み、UIが期待する next_steps を必ず返す */
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('sessions')
      .select('id, summary, metadata')
      .eq('id', id)
      .single();

    if (error) {
      // PostgRESTの not-found は code=PGRST116 が多い
      console.error('supabase select error', {
        message: (error as any).message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: (error as any).code,
      });

      // ✨ 開発中は 404 でも UI が落ちないように「空オブジェクト」を 200 で返す
      return res.status(200).json({
        id,
        summary: null,
        next_steps: [],
        plan: { next_steps: [] },
        seed_questions: [],
        metadata: {},
        _note: 'dev-fallback: session not found',
      });
    }

    const meta = (data?.metadata ?? {}) as Record<string, any>;
    const next_steps = Array.isArray(meta.next_steps) ? meta.next_steps : [];
    const seed_questions = Array.isArray(meta.seed_questions) ? meta.seed_questions : [];

    return res.status(200).json({
      id: data!.id,
      summary: data!.summary ?? null,
      next_steps,                 // ★ フロントが読むトップレベル
      plan: { next_steps },       // ★ 念のため両方
      seed_questions,
      metadata: meta,
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

    return res.status(200).json({
      session_id: id,
      seed_questions,
      next_steps,
    });
  } catch (e) {
    console.error('POST /api/sessions/:id/seed-questions internal error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});
