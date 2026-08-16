/**
 * Cost estimate for embedding the corpus. Runs offline; nothing is called.
 * Usage: npx tsx packages/backend/src/embed/estimate.ts
 */
import { loadCorpusFromSnapshots } from './corpus.js';
import { splitCorpus, countTokens, splitChunk } from './split.js';

// USD per 1M input tokens, list prices.
const PRICING: Record<string, number> = {
  'text-embedding-3-large': 0.13,
  'embed-multilingual-v3.0': 0.10,
  'voyage-3-large': 0.18,
};

const chunks = await loadCorpusFromSnapshots();
const slices = splitCorpus(chunks);

const chunkTokens = chunks.map((c) => countTokens(c.text));
const totalChunkTokens = chunkTokens.reduce((a, b) => a + b, 0);
const totalSliceTokens = slices.reduce((a, s) => a + s.tokens, 0);
const totalChars = chunks.reduce((a, c) => a + c.charCount, 0);

const oversized = chunks.filter((c) => countTokens(c.text) > 7000);

console.log(`chunks              : ${chunks.length}`);
console.log(`characters          : ${totalChars.toLocaleString()}`);
console.log(`tokens (cl100k)     : ${totalChunkTokens.toLocaleString()}`);
console.log(`chars per token     : ${(totalChars / totalChunkTokens).toFixed(2)}`);
console.log(`slices after split  : ${slices.length}  (+${slices.length - chunks.length})`);
console.log(`tokens after split  : ${totalSliceTokens.toLocaleString()}  (+${(totalSliceTokens - totalChunkTokens).toLocaleString()} from repeated headers)`);
console.log(`max slice tokens    : ${Math.max(...slices.map((s) => s.tokens)).toLocaleString()}`);

console.log(`\noversized chunks (>7000 tok): ${oversized.length}`);
for (const c of oversized.slice(0, 10)) {
  const n = splitChunk(c).length;
  console.log(`  ${c.id.slice(0, 58).padEnd(58)} ${countTokens(c.text).toLocaleString().padStart(7)} tok -> ${n} slices`);
}

console.log(`\n| Model | $/1M | Corpus cost | +2 re-runs |`);
console.log(`|---|---|---|---|`);
for (const [model, price] of Object.entries(PRICING)) {
  const cost = (totalSliceTokens / 1_000_000) * price;
  console.log(
    `| ${model} | $${price.toFixed(2)} | $${cost.toFixed(3)} | $${(cost * 3).toFixed(3)} |`,
  );
}
