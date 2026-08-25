/**
 * Run ONE question through the live path and print what it produced.
 *
 * Exists because "it cannot find anything" is indistinguishable, from the UI,
 * between four causes: an empty index, `needsRetrieval: false`, retrieval
 * returning nothing, and retrieval returning the wrong things. Those need
 * completely different fixes and the app shows the same screen for all of them.
 *
 * Usage: npx tsx packages/backend/src/eval/probe-question.ts "<question>"
 */
import 'dotenv/config';
import { contextualize } from '../answer/contextualize.js';
import { retrieve, closeRetrieval } from '../retrieval/retrieve.js';

const question = process.argv[2];
if (!question) { console.error('usage: probe-question.ts "<question>"'); process.exit(1); }

const ctx = await contextualize([], question);
console.log('needsRetrieval :', ctx.needsRetrieval);
console.log('isTopicShift   :', (ctx as { isTopicShift?: boolean }).isTopicShift);
console.log('standaloneQuery:', ctx.standaloneQuery);
console.log('searchTerms    :', ctx.searchTerms);
console.log('legalIssues    :', JSON.stringify((ctx as { legalIssues?: string[] }).legalIssues));
console.log('factSummary    :', ctx.factSummary);

const query = [ctx.standaloneQuery, ctx.searchTerms].filter(Boolean).join(' ');
const chunks = await retrieve(query, 8);
console.log(`\nretrieved ${chunks.length} chunk(s) for: ${query.slice(0, 160)}\n`);
chunks.forEach((c, i) => {
  console.log(`${String(i + 1).padStart(2)}. ${c.score.toFixed(4)}  ${c.arlisId}#${c.ref}  (${c.text.length} chars)`);
});
await closeRetrieval();
