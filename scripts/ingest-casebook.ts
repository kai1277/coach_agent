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

export async function ingestCasebook(yamlPath: string) {
  const raw = fs.readFileSync(yamlPath, 'utf8');
  const doc: any = yaml.load(raw) ?? {};

  const title = String(doc.title ?? '').trim();
  const hypotheses = toStrArray(doc.hypotheses);
  const probes = toStrArray(doc.probes);
  const management_tips = toStrArray(doc.management_tips);
  const evidence_snippets = toStrArray(doc.evidence_snippets);
  const tags = toStrArray(doc.tags);

  const text = [title, ...hypotheses, ...probes, ...management_tips].join('\n');

  const vec = await embed(text);

  const payload = {
    id: doc.id, // 無ければファイル名から生成する処理を入れてもOK
    title: title || null,
    conditions: (typeof doc.conditions === 'object' && !Array.isArray(doc.conditions)) ? doc.conditions : {},
    hypotheses,
    probes,
    management_tips,
    evidence_snippets,
    tags,
    raw_yaml: raw,
    embedding: vec as any,
    updated_by: process.env.USER ?? 'script',
    version: Number(doc.version ?? 1),
  };

  const { error } = await supabase.from('casebook_cards').upsert(payload);
  if (error) throw error;
  console.log(`[ingest] upsert: ${yamlPath} (${payload.id ?? 'no-id'})`);
}
