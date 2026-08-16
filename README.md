# ArmLex

Legal RAG assistant for Armenian tax law, grounded in official texts from
[ARLIS](https://www.arlis.am). Information/search tool — **not legal advice**.

- `CLAUDE.md` — the specification (what we intend)
- **`docs/PROJECT-STATE.md` — start here.** Status, the current critical gap,
  and pointers to `CHANGELOG.md` / `OPEN-ITEMS.md` / `DECISIONS.md` /
  `GOTCHAS.md` / `BENCHMARK.md`.

## Layout

```
packages/
  shared/     types, config, act-number classifier
  scraper/    ARLIS fetching, parsing, chunking  (all HTML knowledge lives here)
  backend/    Fastify API, migrations, embedding + eval harnesses
  frontend/   React dev tool (Search / Ask / Chat)
data/
  snapshots/  raw ARLIS HTML — reparse without refetching
  audit/      audit report
  eval/       golden set, verification, benchmark results
  vectors/    cached embeddings, one .jsonl per model
docs/
  PROJECT-STATE.md
```

## Setup

Postgres is hosted (Neon) — there is no local database to start.

```bash
npm install
```

Create `.env` in the repo root:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
ANTHROPIC_API_KEY=sk-ant-...     # generation (Ask / Chat)
GEMINI_API_KEY=...               # embeddings (chosen model)
VOYAGE_API_KEY=...               # embeddings (benchmark runner-up)
```

Then:

```bash
npm run migrate
npm run db:verify     # expects 43/43
```

## Run the app

```bash
npm run dev
```

Starts the API on `:3001` and the UI on `:5173` together. Open
<http://localhost:5173>. `Ctrl+C` stops both.

Three modes: **Search** (raw retrieval, no model), **Ask** (one-shot grounded
answer), **Chat** (multi-turn with contextualisation and carried-over chunks).

> ⚠️ Retrieval is still **FTS-only** — it scores **0%** on Russian questions.
> See `docs/PROJECT-STATE.md` §1. Ask in Armenian for meaningful results.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API + UI together |
| `npm run migrate` | Apply migrations (forward-only) |
| `npm run db:verify` | Schema integrity, 43 checks |
| `npm run ingest -- --dry-run` | Chunk report, no DB writes |
| `npm run ingest` | Snapshots → Postgres |
| `npm run audit` | ARLIS audit (~92 polite requests) |
| `npm test` | 39 tests |

Offline / eval:

```bash
npx tsx packages/scraper/src/audit/run.ts --offline      # reparse snapshots, no network
npx tsx packages/backend/src/embed/estimate.ts           # token + cost estimate
npx tsx packages/backend/src/embed/generate.ts <model>   # embed corpus (resumable)
npx tsx packages/backend/src/eval/score.ts --fair        # benchmark all retrievers
```

## Key design points

- **All ARLIS HTML knowledge is in `scraper/src/parse/actPage.ts`.** A site
  redesign should touch one module. Raw snapshots are kept so reparsing never
  refetches.
- **Retrieval goes through one seam.** `retrieve()` in
  `backend/src/retrieval/retrieve.ts` is bound at the bottom of the file;
  swapping FTS for hybrid+reranker changes that one line.
- **Chunking branches on document structure** — articles / points / tabular.
  Tables are never split.
- **Grounding is strict.** The model answers only from provided fragments and
  says so when they don't cover the question, rather than filling gaps.
