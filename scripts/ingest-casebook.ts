import 'dotenv/config';
import yaml from 'js-yaml';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

async function embed(text: string) {
  const r = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
  return r.data[0].embedding as number[];
}

function toStrArray(v: any): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(toStrArray);
  if (typeof v === 'string') return [v];
  if (typeof v === 'number' || typeof v === 'boolean') return [String(v)];
  if (typeof v === 'object') {
    // よくあるサブキー名の候補を優先して見る
    for (const key of ['items', 'list', 'lines', 'values']) {
      if (Array.isArray((v as any)[key])) return (v as any)[key].flatMap(toStrArray);
    }
    // それ以外のオブジェクトは値を列挙して文字列化
    return Object.values(v).flatMap(toStrArray);
  }
  return [String(v)];
}

function toArray(x: any): string[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.filter((s) => typeof s === 'string' && s.trim());
  if (typeof x === 'string') return [x].filter(Boolean);
  if (typeof x === 'object') {
    const vals: string[] = [];
    for (const v of Object.values(x)) {
      if (Array.isArray(v)) vals.push(...v.filter((s) => typeof s === 'string' && s.trim()));
      else if (typeof v === 'string' && v.trim()) vals.push(v.trim());
    }
    return vals;
  }
  return [];
}

export async function ingestCasebook(yamlPath: string) {
  const raw = fs.readFileSync(yamlPath, 'utf8');
  const normalized = raw
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2018|\u2019/g, "'");

  const doc: any = yaml.load(normalized) ?? {};

  const id: string =
    String(doc.id || '').trim()
    || yamlPath.split('/').pop()?.replace(/\.(ya?ml)$/i, '')
    || `CARD_${Date.now()}`;

  const title: string   = String(doc.strength || doc.title || id).trim();
  const domain: string  = String(doc.domain || '').trim();

  // ---- 平坦化（既存の検索/表示の互換維持）----
  const hyp_look = toArray(doc.summary?.look_like).map((s) => `[look_like] ${s}`);
  const hyp_fit  = toArray(doc.summary?.value_when_fit).map((s) => `[value_when_fit] ${s}`);
  const hyp_mis  = toArray(doc.summary?.risks_when_misfit).map((s) => `[risks_when_misfit] ${s}`);
  const hypotheses: string[] = [...hyp_look, ...hyp_fit, ...hyp_mis];

  const probes_flat: string[] = [
    ...toArray(doc.probes?.baseline),
    ...toArray(doc.probes?.disambiguation),
    ...toArray(doc.probes?.followups),
  ];

  const mg_do   = toArray(doc.management?.do).map((s) => `DO: ${s}`);
  const mg_dont = toArray(doc.management?.dont).map((s) => `DON'T: ${s}`);
  const mg_g    = toArray(doc.management?.guardrails).map((s) => `Guardrail: ${s}`);
  const mg_m    = toArray(doc.management?.metrics).map((s) => `Metric: ${s}`);
  const mg_best = toArray(doc.management?.role_fit_best).map((s) => `RoleFitBest: ${s}`);
  const mg_avoid= toArray(doc.management?.role_fit_avoid).map((s) => `RoleFitAvoid: ${s}`);
  const management_tips: string[] = [...mg_do, ...mg_dont, ...mg_g, ...mg_m, ...mg_best, ...mg_avoid];

  const evidence_snippets: string[] = toArray(doc.examples);

  const pair_synergy_keys = Object.keys(doc.pairing?.synergize_with ?? {});
  const pair_watch_keys   = Object.keys(doc.pairing?.watch_out_with ?? {});
  const tags: string[] = [
    id, title, domain,
    ...pair_synergy_keys,
    ...pair_watch_keys,
  ].filter((s) => typeof s === 'string' && s.trim());

  // ---- 埋め込み用テキスト ----
  const textForEmbedding = [
    `id: ${id}`,
    `title: ${title}`,
    domain ? `domain: ${domain}` : '',
    hypotheses.length ? `hypotheses:\n- ${hypotheses.join('\n- ')}` : '',
    probes_flat.length ? `probes:\n- ${probes_flat.join('\n- ')}` : '',
    management_tips.length ? `management:\n- ${management_tips.join('\n- ')}` : '',
  ].filter(Boolean).join('\n');

  const vec = await embed(textForEmbedding);

  // ---- ★追加: JSONBにフル保存 ----
  const payload = {
    id,
    title,
    strength:            doc.strength ?? null,
    domain:              domain || null,

    // 平坦化（既存カラム）
    hypotheses,                         // text[]
    probes:           probes_flat,      // text[]（既存）
    management_tips,                    // text[]
    evidence_snippets,                  // text[]
    tags,                               // text[]

    // 新規：フルJSON
    summary_json:       doc.summary ?? null,
    signals_json:       doc.signals ?? null,
    probes_json:        doc.probes ?? null,
    management_json:    doc.management ?? null,
    pairing_json:       doc.pairing ?? null,
    examples_json:      (doc.examples ?? null),  // 配列ならそのまま、文字列1本でもOK
    notes_json:         (doc.notes ?? null),
    raw_json:           doc,
    raw_yaml:           normalized,

    embedding:          vec as any,     // vector(1536)
    updated_by:         String(doc.updated_by ?? process.env.USER ?? 'script'),
    version:            Number(doc.version ?? 1),
  };

  const { error } = await supabase.from('casebook_cards').upsert(payload, { onConflict: 'id' });
  if (error) throw error;

  console.log(`[ingest] upsert: ${yamlPath} (${id})`);
}
