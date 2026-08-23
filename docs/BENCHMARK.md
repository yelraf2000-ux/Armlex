# Retrieval benchmark — methodology, results, provider limits

Full technical record of the embedding model comparison. See `DECISIONS.md`
for the resulting decision and its rationale; this file is the evidence.

## Corpus facts

> **Superseded 2026-08-23 for size, not for method.** The corpus is now
> **21 documents, 1,190 chunks, 5,639 vectors, 891 ref edges** — the Labour Code
> (arlis 51, 288 articles) was added, crossing the tax-only boundary. Golden-set
> figures below were measured before that and **still hold**: the same run
> repeated after the ingest gave identical numbers (88.9 / 92.6 / 87.0 / 0.681),
> so no result in this file needs re-measuring for the corpus change. The
> per-document counts in this section are the pre-Labour-Code tax corpus.

- 20 documents, **885 chunks**, 1 alias (228650 → 109017, see `DECISIONS.md`)
- 2,504,417 characters, **4,223,582 tokens** (cl100k) → **0.59 chars/token**
  — i.e. **~1.7 tokens per Armenian character**, not the 3–5× the original
  spec assumed for Russian text (there is no Russian text — see `CLAUDE.md`
  language strategy revision)
- 1,269 embedding slices at an 8,000-token split cap; all 885/885 chunks
  covered by the splitter
- 164/164 rate tables preserved intact through chunking (never split)
- `article_refs` table: **0 rows** — cross-reference extraction (spec
  pipeline step) was never built; provisions that cite other articles don't
  automatically pull them in

Consequence worth remembering when sizing prompts: a single Tax Code article
can run 8,500–67,000 tokens (article 3 alone is 67,168). Four fresh + five
carried chunks in chat mode is already ~40k input tokens, ~$0.12/turn on
Sonnet.

## Golden set

30 questions, Russian, drafted by the project owner from realistic Armenian
tax scenarios (not corpus-derived, to avoid flattering lexical retrieval).

Pipeline: **propose** (candidate refs per question) → **verify** (independent
judge reads full article text, rules yes/partial/no) → **score** (rank each
retriever against verified gold answers).

Proposal went through two versions — see `DECISIONS.md` for why v1 was
replaced. Current state:

- **23/30 questions have ≥1 verified gold answer**
- 2/30 are a confirmed corpus-scope gap (IT-startup incentive law never
  ingested)
- 5/30 still need a second proposer pass — not yet a confirmed gap, just
  unresolved
- 150 total candidate judgments logged in `data/eval/judgments.jsonl`
  (journaled, resumable — safe to re-run `verify.ts` after adding more
  proposals, it skips already-judged rows)

Reproduce candidate generation: `npx tsx packages/backend/src/eval/proposeV2.ts`
Reproduce verification: `npx tsx packages/backend/src/eval/verify.ts golden_proposed_v2.csv`

## Benchmark results (fair mode)

All retrievers ranked over the identical 638-chunk universe — the
intersection of chunks every embedding model actually covers (see
`DECISIONS.md` for why this restriction exists) — against the 23 verified
questions.

| Retriever | hit@5 | hit@8 | recall@5 | recall@8 | MRR |
|---|---|---|---|---|---|
| fts (Postgres, live in the app today) | **0.0%** | 0.0% | 0.0% | 0.0% | 0.000 |
| **gemini-embedding-2** | **91.3%** | **95.7%** | **79.7%** | **88.4%** | **0.647** |
| voyage-3-large | 39.1% | 60.9% | 34.8% | 50.0% | 0.315 |

Reproduce: `npx tsx packages/backend/src/eval/score.ts --fair`
(drop `--fair` to score each model against its own full coverage — not
recommended for comparison while corpus coverage differs between models)

**FTS's exact 0.0%** is not a rounding artifact — Postgres full-text search
found the correct article for zero of the 23 Russian-language questions. The
index (`tsv_hy`) contains only Armenian text; a Russian query shares no
lexemes with it by construction.

## Shipped pipeline (full 885-chunk index, 2026-08-15)

The table above is **fair mode over 638 chunks** — the right comparison for
choosing between embedding models, and the wrong one for describing the
running system. At full corpus coverage the same Gemini retriever scores
73.9%, not 91.3%: the extra 247 chunks are additional distractors. These are
the honest numbers for what actually runs.

| Retriever | hit@5 | hit@8 | recall@5 | recall@8 | MRR |
|---|---|---|---|---|---|
| fts (baseline) | 0.0% | 0.0% | 0.0% | 0.0% | 0.000 |
| vector (pgvector, gemini-embedding-2) | 73.9% | 82.6% | 62.3% | 71.7% | 0.578 |
| hybrid RRF (pgvector + FTS) | 78.3% | 82.6% | 64.5% | 71.7% | 0.445 |
| **vector + rerank-2.5** ← shipped | **87.0%** | **87.0%** | **71.7%** | **79.0%** | **0.677** |

Reproduce: `npx tsx packages/backend/src/eval/score.ts --live`
(the `--live` rows exercise the real pgvector index, SQL and reranker; only
the query-embedding HTTP call is served from cache, so the benchmark stays
runnable when the embedding provider is rate limited)

### Shipped pipeline, 2026-08-19: enumeration-aware index + slice-aware reranker

27 golden questions, 902 chunks indexed as **5,139 vectors** (one per
enumerated item for the 214 list-shaped articles). Live pgvector path, pool 50,
one-hop citation expansion on.

| Retriever | hit@5 | hit@8 | recall@5 | recall@8 | MRR |
|---|---|---|---|---|---|
| vector (pgvector) | 81.5% | 81.5% | 74.7% | 79.6% | 0.601 |
| hybrid RRF (pgvector + FTS) | 81.5% | 85.2% | 69.8% | 81.5% | 0.468 |
| **vector + expansion + rerank-2.5** ← shipped | **88.9%** | **92.6%** | **75.9%** | **87.0%** | **0.681** |

The same pipeline before this change (token index, prefix-only reranker input)
measured 85.2 / 88.9 / 72.2 / 80.2 / 0.653 on the same 27 questions.

**Split policy, vector-only A/B** (in-memory brute force, same model, same
queries — the fair comparison for a split change):

| policy | hit@5 | hit@8 | recall@5 | recall@8 | MRR |
|---|---|---|---|---|---|
| token (7,000-token slices) | 66.7% | 77.8% | 56.8% | 68.5% | 0.560 |
| **enum (one vector per item)** | **81.5%** | **81.5%** | **74.7%** | **79.6%** | **0.601** |

**Reranker input, end to end on the enum index** — the part that was not
obvious in advance:

| reranker sees | hit@5 | hit@8 | recall@8 | MRR |
|---|---|---|---|---|
| article prefix (1,800 chars) | 85.2% | 85.2% | 76.5% | 0.632 |
| matched slice only | 85.2% | 92.6% | 82.7% | 0.564 |
| **prefix + matched slice** | **88.9%** | **92.6%** | **87.0%** | **0.681** |

Sharper vectors alone bought nothing end to end, because the reranker could not
see the matched item in a 26,000-character article's first 1,800 characters.
Slice-only over-corrected: terse table rows lost to rich prose openings (per
question: 6 better, 10 worse). Prefix + slice removes the asymmetry.

Reproduce: `RERANK_POOL=50 npx tsx packages/backend/src/eval/score.ts --live`
(`RERANK_DOC=prefix|slice|both` and `SPLIT_POLICY=token` for the variants).

### Reranker parameters, chosen by sweep

Pool size — how many vector candidates the cross-encoder sees:

| Pool | hit@5 | recall@8 | MRR |
|---|---|---|---|
| 15 | 82.6% | 77.5% | 0.675 |
| 30 | 82.6% | 76.8% | 0.666 |
| **50** | **87.0%** | **79.0%** | **0.677** |
| 80 | 87.0% | 76.8% | 0.658 |

The upside of reranking lives entirely in the tail — a wider pool is the only
way a correct article sitting at vector-rank 30 gets rescued. It stops paying
at 80, where the added noise costs more than the extra recall is worth.

Document prefix length (`DOC_CHARS`, at pool 50) made no material difference:
900 / 1800 / 3500 chars all gave 87.0% hit@5, with recall@8 76.8 / 79.0 / 76.8
and MRR 0.705 / 0.677 / 0.717 — spread smaller than one question on n=23.
Kept at 1,800: the metadata header carrying most of the discriminating signal
sits at the front, and a longer prefix costs tokens for no measured gain.

**Model choice** was probed on a real article-vs-form pair before any
benchmarking. `rerank-2-lite` scored the FORM above the ARTICLE and was
rejected on that basis alone; `rerank-2.5` ranked correctly with the widest
margin.

**Latency:** the rerank call alone, 50 documents × 1,800 chars, median of 5
runs = **547 ms**. The Gemini query-embedding call (~2.5–4 s) dominates the
pipeline, so reranking is not the bottleneck.

## Provider rate limits (as observed 2026-08-14)

| Provider | Limit hit | Detail |
|---|---|---|
| **Gemini free tier** | 429, `RESOURCE_EXHAUSTED` | `EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier`, quota value 1000. **Per-day, not per-minute** — see `GOTCHAS.md` for why this was initially misdiagnosed |
| Gemini paid | n/a | Prepay credits, $10 minimum purchase, non-refundable, 1-year expiry. Not needed for this corpus (311 remaining slices ≈ 2% of one day's free quota) |
| **Voyage unpaid** | 429 | 10K TPM / 3 RPM — full corpus ≈ 10 hours at this rate |
| Voyage paid | n/a | Card added 2026-08-14 (billed against existing 200M free-token allowance). Full 1,269-slice corpus embedded in **~90 seconds** at 16.5 slices/s afterward |
| Cohere `embed-multilingual-v3` | n/a — ruled out before testing | 512-token input limit ≈ 300 Armenian characters, smaller than this project's metadata header alone |

**Pacing that actually works for Gemini free tier:** serial requests, batch
size 15, ≥4.5s between batches. Four parallel workers at batch size 10
produced sustained 429s. Every retry attempt counts against the daily quota —
calibrating this pacing across four attempts burned most of a day's 1,000
free requests on a job that needs only ~21.

Both providers return **unit-normalised** embedding vectors (verified by
computing vector norms on sample outputs) — cosine similarity is a plain dot
product against these, no normalization step needed downstream.

## Embedding cache format

`data/vectors/<model-name>.jsonl` — one JSON object per line:
```json
{"id": "<sliceId>", "parentId": "<chunkId>", "arlisId": <int>, "vector": [...]}
```
`data/vectors/<model-name>.queries.jsonl` — same shape, one line per golden
question, `id` = `parentId` = the question text verbatim.

Resumable: `generate.ts` reads already-written ids from the output file and
skips them, so an interrupted run costs only time, never re-spend.
