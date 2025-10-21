import "dotenv/config";
import fs from "node:fs";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  }
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

// 適当なMarkdown/テキストを用意
const text = fs.readFileSync("./knowledge/coach_notes.md", "utf8");
const chunks = text
  .split(/\n{2,}/)
  .map((s) => s.trim())
  .filter(Boolean);

const doc = await supabase
  .from("knowledge_docs")
  .insert({ source: "local", title: "coach_notes", url: null, metadata: {} })
  .select("id")
  .single();
for (let i = 0; i < chunks.length; i++) {
  const content = chunks[i];
  const emb = await openai.embeddings.create({ model: MODEL, input: content });
  const vec = emb.data[0].embedding;
  await supabase.from("knowledge_chunks").insert({
    doc_id: doc.data.id,
    chunk_index: i,
    content,
    embedding: vec,
    metadata: {},
  });
}
console.log("ingest done");
