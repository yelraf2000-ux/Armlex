/**
 * Draft posts now and send them to the team chat for approval.
 *
 *   npx tsx packages/backend/src/social/draft-now.ts            # one post, topic picked
 *   npx tsx packages/backend/src/social/draft-now.ts 2          # two posts
 *   npx tsx packages/backend/src/social/draft-now.ts "topic"    # one post on this topic
 *
 * Needs the server's environment (database, Gemini, Telegram, retrieval keys).
 */
import { createDraft } from './draft.js';

const arg = process.argv[2];
const count = arg && /^\d+$/.test(arg) ? Number(arg) : 1;
const topic = arg && !/^\d+$/.test(arg) ? arg : undefined;

for (let i = 0; i < count; i++) {
  const r = await createDraft(topic);
  console.log('skipped' in r ? `skipped: ${r.skipped}` : `sent draft ${r.id}${r.warnings ? ` (${r.warnings})` : ''}`);
}
process.exit(0);
