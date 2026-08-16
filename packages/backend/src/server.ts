/**
 * Dev API. Two endpoints, both thin wrappers over the retrieval seam.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { authEnabled, authStatus, login, requireAuth } from './auth.js';
import { retrieve, warmRetrieval } from './retrieval/retrieve.js';
import { db } from './db/pool.js';
import { ask, isConfigured } from './answer/ask.js';
import { chat } from './answer/chat.js';

const app = Fastify({ logger: { transport: { target: 'pino-pretty' } } });

/**
 * Refuse to start unguarded in production.
 *
 * A missing APP_PASSWORD is convenient locally and catastrophic on a public
 * URL: every answer spends real credit, so an open endpoint is a form anyone
 * can spend from. Failing to boot is the only response that cannot be ignored —
 * a warning in a log nobody reads is how this goes wrong quietly.
 */
if (process.env['NODE_ENV'] === 'production' && !authEnabled()) {
  console.error(
    'REFUSING TO START: NODE_ENV=production but APP_PASSWORD is not set.\n' +
      'Every answer costs real API credit; an unauthenticated public URL is a\n' +
      'bill anyone can run up. Set APP_PASSWORD (and SESSION_SECRET) and retry.',
  );
  process.exit(1);
}

app.addHook('preHandler', requireAuth);
app.post('/api/login', login);
app.get('/api/auth', async () => authStatus());

interface QueryBody {
  query?: unknown;
}

function readQuery(body: QueryBody): string | undefined {
  const q = body?.query;
  return typeof q === 'string' && q.trim() ? q.trim() : undefined;
}

app.get('/health', async () => ({ ok: true }));
app.get('/api/health', async () => ({ ok: true }));

/** Called by the UI on load, to absorb Neon's cold start before the first question. */
app.get('/api/warm', async () => {
  warmRetrieval();
  return { ok: true };
});

/**
 * Streaming chat over Server-Sent Events.
 *
 * Generation is ~62s for a full Armenian answer and cannot be made materially
 * faster — 1,700 output tokens at ~1.7 tokens/character is simply that much
 * text. What CAN change is when the user first sees something: retrieval takes
 * ~4s warm, so with streaming the answer starts appearing then instead of a
 * minute later.
 *
 * The deltas forwarded here are gated (see `streamGate.ts`): text inside a
 * quotation is withheld until that quote is verified against the supplied
 * article texts, so streaming never puts an unverified quote of the law on
 * screen.
 */
app.post<{ Body: ChatBody }>('/api/chat/stream', async (req, reply) => {
  const message = readQuery(req.body);
  if (!message) return reply.code(400).send({ error: 'query is required' });
  if (!isConfigured()) {
    return reply.code(501).send({ error: 'ANTHROPIC_API_KEY is not set' });
  }

  const sid = req.body.sessionId;
  const sessionId = typeof sid === 'string' && sid ? sid : undefined;

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Vite's dev proxy buffers by default; without this the whole point of
    // streaming is lost between the API and the browser.
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: unknown): void => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await chat(
      sessionId,
      message,
      (text) => send('delta', { text }),
      // Sent as soon as retrieval lands, so the reader sees which articles were
      // found while the answer is still being written.
      (chunks) => send('chunks', { chunks }),
      (stage) => send('stage', { stage }),
    );
    // The final event carries everything the streamed deltas could not: which
    // chunks were used, token accounting, and the rejected-quote count.
    send('done', {
      sessionId: result.sessionId,
      standaloneQuery: result.standaloneQuery,
      freshChunks: result.freshChunks,
      carriedChunks: result.carriedChunks,
      factSummary: result.factSummary,
      invalidQuotes: result.invalidQuotes,
      coverage: result.coverage,
      model: result.model,
      usage: result.usage,
      timings: result.timings,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    req.log.error({ err }, 'chat stream failed');
    send('error', { error: 'chat failed', detail: `${e.status ?? ''} ${e.message ?? String(err)}`.trim() });
  } finally {
    reply.raw.end();
  }
});

/**
 * Corpus provenance for the global banner.
 *
 * A legal tool that does not say how current it is invites the reader to assume
 * it is current. `last_checked_at` is when the crawler last confirmed the
 * source, which is the honest thing to show — not the date the answer was
 * generated.
 */
app.get('/api/corpus', async () => {
  const [row] = await db()<
    { documents: string; chunks: string; last_checked: string | null }[]
  >`
    SELECT
      (SELECT count(*) FROM documents WHERE rag_eligible AND status = 'in_force') AS documents,
      (SELECT count(*) FROM articles a JOIN documents d ON d.id = a.document_id
         WHERE d.rag_eligible AND d.status = 'in_force') AS chunks,
      (SELECT max(last_checked_at)::text FROM documents WHERE rag_eligible) AS last_checked
  `;
  return {
    documents: Number(row?.documents ?? 0),
    chunks: Number(row?.chunks ?? 0),
    lastChecked: row?.last_checked ?? null,
  };
});

/**
 * Provisions cited by an article — one hop through `article_refs`.
 *
 * Armenian tax law defers constantly ("in the manner established by Article
 * 254"), so the article a reader lands on is often not the one carrying the
 * rule they need. Surfacing the outgoing edges lets them follow the chain
 * without knowing it exists.
 */
app.get<{ Querystring: { articleId?: string } }>('/api/related', async (req, reply) => {
  const id = req.query.articleId;
  if (!id || !/^\d+$/.test(id)) {
    return reply.code(400).send({ error: 'numeric articleId is required' });
  }

  const rows = await db()<
    { id: string; arlis_id: number; article_number: string; title_hy: string }[]
  >`
    SELECT a.id, d.arlis_id, a.article_number, d.title_hy
    FROM article_refs r
    JOIN articles a ON a.id = r.to_article_id
    JOIN documents d ON d.id = a.document_id
    WHERE r.from_article_id = ${Number(id)}
      AND a.status = 'in_force' AND d.status = 'in_force'
    ORDER BY a.article_number
    LIMIT 12
  `;
  return {
    related: rows.map((r) => ({
      articleId: String(r.id),
      arlisId: r.arlis_id,
      ref: r.article_number,
      documentTitle: r.title_hy,
    })),
  };
});

/** Past conversations, newest first, labelled by their opening question. */
app.get('/api/sessions', async () => {
  const rows = await db()<
    { id: string; created_at: string; turns: string; first_message: string | null }[]
  >`
    SELECT s.id, s.created_at::text,
           count(m.id) FILTER (WHERE m.role = 'user')::text AS turns,
           (SELECT content FROM messages
             WHERE session_id = s.id AND role = 'user'
             ORDER BY id ASC LIMIT 1) AS first_message
    FROM sessions s
    LEFT JOIN messages m ON m.session_id = s.id
    GROUP BY s.id
    -- A session with no messages is an artefact of a failed turn, not a
    -- conversation; showing it would just be clutter in the list.
    HAVING count(m.id) > 0
    ORDER BY s.created_at DESC
    LIMIT 40
  `;
  return {
    sessions: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      turns: Number(r.turns),
      firstMessage: r.first_message ?? '',
    })),
  };
});

/** Full transcript of one past conversation. */
app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return reply.code(400).send({ error: 'invalid session id' });
  }
  const rows = await db()<{ role: string; content: string }[]>`
    SELECT role, content FROM messages
    WHERE session_id = ${id} AND role IN ('user','assistant')
    ORDER BY id ASC
  `;
  return { sessionId: id, messages: rows };
});

app.post<{ Body: QueryBody }>('/api/search', async (req, reply) => {
  const query = readQuery(req.body);
  if (!query) return reply.code(400).send({ error: 'query is required' });

  const chunks = await retrieve(query, 8);
  return { query, count: chunks.length, chunks };
});

app.post<{ Body: QueryBody }>('/api/ask', async (req, reply) => {
  const query = readQuery(req.body);
  if (!query) return reply.code(400).send({ error: 'query is required' });

  if (!isConfigured()) {
    return reply.code(501).send({
      error: 'ANTHROPIC_API_KEY is not set',
      detail:
        'Ask mode calls the Anthropic API. Add ANTHROPIC_API_KEY to .env and restart the server. Search mode works without it.',
    });
  }

  // Top 3 only: the generation prompt is grounded, and Armenian tokenises at
  // ~1.7 tokens/char, so a handful of articles is already a large context.
  const chunks = await retrieve(query, 3);

  try {
    return await ask(query, chunks);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    req.log.error({ err }, 'ask failed');
    return reply.code(502).send({
      error: 'generation failed',
      detail: `${e.status ?? ''} ${e.message ?? String(err)}`.trim(),
    });
  }
});

interface ChatBody extends QueryBody {
  sessionId?: unknown;
}

app.post<{ Body: ChatBody }>('/api/chat', async (req, reply) => {
  const message = readQuery(req.body);
  if (!message) return reply.code(400).send({ error: 'query is required' });

  if (!isConfigured()) {
    return reply.code(501).send({
      error: 'ANTHROPIC_API_KEY is not set',
      detail: 'Chat mode calls the Anthropic API. Add ANTHROPIC_API_KEY to .env and restart.',
    });
  }

  const sid = req.body.sessionId;
  const sessionId = typeof sid === 'string' && sid ? sid : undefined;

  try {
    return await chat(sessionId, message);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    req.log.error({ err }, 'chat failed');
    return reply.code(502).send({
      error: 'chat failed',
      detail: `${e.status ?? ''} ${e.message ?? String(err)}`.trim(),
    });
  }
});

/**
 * Serve the built frontend from this same service.
 *
 * In development Vite serves the UI on :5173 and proxies /api here. In
 * production there is one process and one origin: no CORS, no second service to
 * keep awake, and the API keys stay on the server side of a single boundary.
 * Only mounted when a build exists, so `npm run dev` is unaffected.
 */
const FRONTEND_DIST = join(process.cwd(), 'packages', 'frontend', 'dist');
if (existsSync(FRONTEND_DIST)) {
  await app.register(fastifyStatic, { root: FRONTEND_DIST });
  // Single-page app: anything that is not an API route or a real file is the
  // app's own routing, so hand back index.html rather than a 404.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
  app.log.info(`serving frontend from ${FRONTEND_DIST}`);
}

const port = Number(process.env['PORT'] ?? 3001);
// 0.0.0.0 in a container: 127.0.0.1 is unreachable from outside it, and the
// platform health check would fail with the process apparently running fine.
const host = process.env['NODE_ENV'] === 'production' ? '0.0.0.0' : '127.0.0.1';
app
  .listen({ port, host })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
