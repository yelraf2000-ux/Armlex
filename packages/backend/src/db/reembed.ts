/**
 * Drop and rebuild all embeddings for one model.
 *
 * Deleting is implemented now; regeneration is a stub until milestone 5 wires
 * up a real Embedder. The script is deliberately safe by default: it reports
 * what it would delete and requires --yes to actually do it, because dropping
 * embeddings for a 450-article corpus means paying to regenerate them.
 *
 * Usage:
 *   npm run reembed -- --model text-embedding-3-large --dry-run
 *   npm run reembed -- --model bge-m3 --yes
 *   npm run reembed -- --model bge-m3 --yes --only-missing
 */
import postgres from 'postgres';
import { config } from '@armlex/shared';
import { getModel, KNOWN_MODELS, createEmbedder } from '../embed/embedder.js';

interface Args {
  model: string;
  yes: boolean;
  dryRun: boolean;
  onlyMissing: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const model = get('--model');
  if (!model) {
    console.error('usage: reembed --model <name> [--yes] [--dry-run] [--only-missing]');
    console.error(`known models: ${Object.keys(KNOWN_MODELS).join(', ')}`);
    process.exit(1);
  }

  return {
    model,
    yes: argv.includes('--yes'),
    dryRun: argv.includes('--dry-run'),
    onlyMissing: argv.includes('--only-missing'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const model = getModel(args.model);
  if (!model) {
    console.error(
      `unknown model "${args.model}". Known: ${Object.keys(KNOWN_MODELS).join(', ')}`,
    );
    process.exit(1);
  }

  const sql = postgres(config.databaseUrl, { onnotice: () => {} });

  try {
    // Guard: the embeddings column has a fixed width, so a model of a
    // different dimension cannot be stored without a migration.
    const [dim] = await sql<{ dims: number | null }[]>`
      SELECT atttypmod AS dims
      FROM pg_attribute
      WHERE attrelid = 'embeddings'::regclass AND attname = 'vector'
    `;
    if (dim?.dims && dim.dims > 0 && dim.dims !== model.dimensions) {
      console.error(
        `dimension mismatch: embeddings.vector is ${dim.dims}-d but ${model.name} produces ${model.dimensions}-d.\n` +
          'Add a migration widening/narrowing the column before re-embedding.',
      );
      process.exit(1);
    }

    const [existing] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM embeddings WHERE model = ${model.name}
    `;

    const [target] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM articles a
      JOIN documents d ON d.id = a.document_id
      WHERE d.rag_eligible
        AND d.status = 'in_force'
        AND a.status = 'in_force'
        AND coalesce(a.text_hy, '') <> ''
    `;

    console.log(`model            : ${model.name} (${model.dimensions}-d)`);
    console.log(`existing vectors : ${existing?.count ?? 0}`);
    console.log(`eligible articles: ${target?.count ?? 0}`);

    if (args.dryRun) {
      console.log('\n--dry-run: nothing changed.');
      return;
    }

    if (!args.onlyMissing) {
      if (!args.yes) {
        console.error(
          `\nRefusing to delete ${existing?.count ?? 0} vectors without --yes.`,
        );
        process.exit(1);
      }
      const deleted = await sql`
        DELETE FROM embeddings WHERE model = ${model.name}
      `;
      console.log(`\ndeleted ${deleted.count} vector(s)`);
    }

    const [remaining] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM articles a
      JOIN documents d ON d.id = a.document_id
      LEFT JOIN embeddings e
        ON e.article_id = a.id AND e.model = ${model.name}
      WHERE d.rag_eligible
        AND d.status = 'in_force'
        AND a.status = 'in_force'
        AND coalesce(a.text_hy, '') <> ''
        AND e.id IS NULL
    `;

    console.log(`to embed         : ${remaining?.count ?? 0}`);

    if ((remaining?.count ?? 0) === 0) {
      console.log('nothing to do.');
      return;
    }

    // Milestone 5 replaces this with batched embedding + insert.
    createEmbedder(model.name);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
