import 'dotenv/config';
import OpenAI from 'openai';
import { Client } from 'pg';

// ------------- 設定 -------------
const MODEL = 'text-embedding-3-small'; // 1536 次元
// 例: traitごとの原稿（最小でOK。あとで仕様書の本文に差し替え）
const TRAIT_BODIES: Record<string, string> = {
  achiever: `達成欲：高い生産性と日次の進捗で駆動。短サイクルの目標設定、進捗可視化、終業時の達成ログが効果的。`,
  learner:  `学習欲：学習プロセス自体に喜び。短い学習スプリント、反復評価、習熟曲線の可視化でモチベ維持。`,
  strategic:`戦略性：パターン認識と分岐探索。意思決定の前に複数シナリオ比較を提示すると真価を発揮。`
};
// ---------------------------------

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pg = new Client({ connectionString: process.env.DATABASE_URL });

function chunkText(text: string, chunkSize = 800, overlap = 120): string[] {
  if (!text) return [];
  if (chunkSize <= 0) throw new Error('chunkSize must be > 0');

  if (text.length <= chunkSize) return [text];

  const safeOverlap = Math.max(0, Math.min(overlap, chunkSize - 1));
  const step = Math.max(1, chunkSize - safeOverlap);

  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += step) {
    const end = Math.min(text.length, i + chunkSize);
    chunks.push(text.slice(i, end));
    if (end === text.length) break; 
  }
  return chunks.filter(c => c.trim().length > 0);
}

async function embed(texts: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: MODEL,
    input: texts
  });
  return res.data[0].embedding;
}

function toVectorLiteral(vec: number[]): string {
  // pgvector は '[v1, v2, ...]' の文字列表現を ::vector キャストで受けられる
  return '[' + vec.join(',') + ']';
}

async function main() {
  await pg.connect();

  // 1) docs を取得（さきほど手動で入れた3件）
  const { rows: docs } = await pg.query(
    `select id, metadata, title from public.knowledge_docs
     where metadata ? 'trait'`
  );

  for (const doc of docs) {
    const trait = doc.metadata?.trait as string | undefined;
    if (!trait || !TRAIT_BODIES[trait]) {
      console.log(`skip doc ${doc.id} (no trait body)`);
      continue;
    }

    // 2) チャンク化
    const chunks = chunkText(TRAIT_BODIES[trait]);

    // 3) 各チャンクを埋め込み → knowledge_chunks へ保存
    for (let idx = 0; idx < chunks.length; idx++) {
      const content = chunks[idx];
      const emb = await embed(content);                // number[]
      const literal = toVectorLiteral(emb);            // '[...]'
      await pg.query(
        `insert into public.knowledge_chunks
          (doc_id, chunk_index, content, embedding, metadata)
         values ($1, $2, $3, $4::vector, $5)`,
        [doc.id, idx, content, literal, { trait }]
      );
      console.log(`inserted chunk ${idx} for ${trait}`);
    }
  }

  await pg.end();
  console.log('done.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
