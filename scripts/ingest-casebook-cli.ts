import 'dotenv/config';
import { ingestCasebook } from './ingest-casebook.js'; // 拡張子 .js に注意（tsxがESM解決）

const p = process.argv[2];
if (!p) {
  console.error('Usage: npx tsx scripts/ingest-casebook-cli.ts ./casebook/H-woo-analytical.yaml');
  process.exit(1);
}
ingestCasebook(p).catch((e) => {
  console.error(e);
  process.exit(1);
});