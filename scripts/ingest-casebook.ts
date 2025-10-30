// scripts/ingest-casebook.ts
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

export async function ingestCasebook(yamlPath: string) {
  const raw = fs.readFileSync(yamlPath, 'utf8');
  const doc: any = yaml.load(raw);
  const text = [
    doc.title,
    ...(doc.hypotheses ?? []),
    ...(doc.probes ?? []),
    ...(doc.management_tips ?? [])
  ].join('\n');
  const vec = await embed(text);

  const payload = {
    id: doc.id,
    title: doc.title ?? null,
    conditions: doc.conditions ?? {},
    hypotheses: doc.hypotheses ?? [],
    probes: doc.probes ?? [],
    management_tips: doc.management_tips ?? [],
    evidence_snippets: doc.evidence_snippets ?? [],
    tags: doc.tags ?? [],
    raw_yaml: raw,
    embedding: vec as any,
    updated_by: process.env.USER ?? 'script',
    version: Number(doc.version ?? 1),
  };

  const { error } = await supabase.from('casebook_cards').upsert(payload);
  if (error) throw error;
  console.log(`[ingest] upsert: ${doc.id}`);
}
