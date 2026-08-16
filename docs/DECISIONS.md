# Decisions — choices made, and why

Settled questions. If you're tempted to revisit one of these, read the
rationale first — most were decided by measurement, not preference.

## The confidence gate uses the model's self-report, not reranker scores

The spec calls for "a confidence gate using reranker scores + model
self-report". Measured on the golden set, the reranker half does not work:

    covered questions (20)  mean top-1 0.662, range 0.496-0.836
    missed questions  (3)   mean top-1 0.589, range 0.570-0.613

The ranges overlap almost completely — ten covered questions score below the
best-scoring miss — and a threshold search returns a degenerate answer ("always
confident"), which merely restates the 87% base rate.

This is not a calibration problem that more data would fix. A cross-encoder
scores **topical relevance**: how well this document matches this query. The
gate needs **sufficiency**: whether this text contains the rule being asked
about. A VAT registration form is maximally relevant to a VAT question and
contains none of the answer — the same property that made forms outrank
articles before reranking existed.

The model, unlike the reranker, has read the fragments. So it declares coverage
on the first line of its response — before the answer, so the verdict cannot be
a rationalisation of prose it has already produced — and that line is stripped
before the user sees it.

Reranker scores remain on every chunk. If a larger golden set ever shows a
usable separation, revisit; do not assume one exists.

## No coverage badge on confident answers

`full` renders nothing. A marker on every answer becomes furniture — readers
stop seeing it within a few sessions, and it would then fail exactly when it
matters. Showing the notice only for `partial` and `none` keeps it rare enough
to read as a warning, and makes its absence meaningful.

## Embedding model: Gemini (`gemini-embedding-2`)

**Chosen over Voyage (`voyage-3-large`) and OpenAI (never tested — no
compelling reason to, given the margin below).**

Measured, fair mode (identical 638-chunk universe both models embedded):

| Retriever | hit@5 | recall@8 | MRR |
|---|---|---|---|
| Gemini | 91.3% | 88.4% | 0.647 |
| Voyage | 39.1% | 50.0% | 0.315 |

Gemini wins by 2.3× on hit@5, on the same haystack — not an artifact of
corpus coverage. Full methodology and caveats: `BENCHMARK.md`.

**Consequence:** Gemini's 3,072 dimensions match `embeddings.vector` exactly
— no schema migration. Had Voyage won, its 1,024 dimensions would have forced
an `ALTER COLUMN` and an HNSW index rebuild.

## Canonical Tax Code id: 109017 (not 228650)

Both ids serve byte-identical `/latest` content. Distinguished by bare
(non-`/latest`) version: 109017's bare version differs from `/latest` (it's
the original record `/latest` is built from); 228650's bare version *is*
`/latest` (a consolidation snapshot the next amendment will supersede with a
new id). 228650 is registered in `document_aliases`, not ingested separately.
Full evidence in `GOTCHAS.md` → ARLIS.

## Corpus scope excludes the IT-startup incentive law

The v1 spec scopes the corpus to Tax Code core plus specifically-selected
related decisions/orders (21 documents, milestone 2). The IT-sector tax
certificate/incentive law was never part of that list — confirmed by search:
zero documents in the ingested corpus mention it at all.

This means 2 of the 30 golden-set questions (IT-certificate conditions,
IT-company tax benefits) are **unanswerable from the current corpus**, not a
retrieval failure. Whether to widen the corpus to cover them is a scope call
for the project owner, not something to silently patch around.

## System prompts written in English, not Russian or Armenian

A Russian-language prompt was found to bias generation toward Russian even
for Armenian-language questions — see `GOTCHAS.md` → Prompting. English is
neutral between the two user-facing languages and is used as the prompt's own
language in both `ask.ts` and `chat.ts`. The language-mirroring rule is an
explicit, separate instruction inside the prompt, not inferred from the
prompt's own language.

## FTS: strict AND first, OR-ranked fallback second

`retrieve.ts`'s `ftsRetriever` tries a strict `&`-joined tsquery first (high
precision on well-formed legal queries), and only falls back to `|`-joined
OR-ranking when the strict pass returns zero rows. A pure-OR default was
rejected because it would degrade the precision of already-good exact-phrase
queries; a pure-AND default was rejected because a single conversational word
(`ինչ`, `կասես`) in a natural question drove real questions to zero results.

## Golden-set candidate proposal: title-index LLM, not glossary+FTS

The original proposer (`propose.ts`) mapped Russian questions to Armenian
legal terms through a hand-written 32-concept glossary, prefix-matched via
FTS. Verification exposed it as broken — 86% of its candidates were rejected,
and for "what's the turnover-tax threshold" it never even proposed the
article whose title is nearly a direct translation of the question
(Հոդված 254 «Շրջանառության հարկ վճարողները»).

Replaced with `proposeV2.ts`: the corpus's full title index (885 titles) is
small enough to fit in one LLM context, so the model matches questions to
titles directly — no glossary, no lexical heuristic. Result: all 30 questions
got candidates on the first pass, and verified coverage rose from 11/30 to
23/30. The independent verification pass (read full article text, judge
yes/partial/no) was kept unchanged as the safety net — it's what caught the
v1 bug, so it isn't trusted blindly even for v2's better proposals.

## Golden-set verification: self-verified, not human-verified

The project owner chose LLM self-verification over manual review of all 90
candidates, given the volume. A Sonnet judge reads each candidate article's
full text and rules yes/partial/no against the question — independent of
proposal, but sharing the same underlying model family. This is treated as
sound for **choosing between embedding models** (all retrievers are judged
against the same targets, so shared judge bias doesn't favor one retriever
over another) but explicitly weaker as an **absolute quality claim**. Anyone
citing the 91.3% number outside a model-comparison context should carry this
caveat.

## Sub-article (մաս / part) chunking — TRIED AND REVERTED

**Hypothesis:** 18% of chunks exceed 7,000 tokens and one article is 67k
tokens — too large for a generation context. Splitting oversized articles at
part (`մաս`) boundaries should improve both retrieval precision and cost.

**The size profile improved exactly as predicted.** Splitting articles over
6,000 chars: p90 chunk size 5,795 → 4,100 chars, chunks over 8k 60 → 34,
at +53% chunk count and +6% total text (repeated metadata headers).

**Retrieval got roughly twice as bad.** Model held constant
(`voyage-3-large`), only chunking varied, same 23-question golden set, scored
at article granularity so both are directly comparable:

| Chunking | hit@5 | hit@8 | recall@8 | MRR |
|---|---|---|---|---|
| article-level | **34.8%** | **47.8%** | **38.4%** | **0.262** |
| part-level | 17.4% | 26.1% | 18.8% | 0.111 |

**Likely mechanism:** an article's embedding carries its *topic*; an
individual part often carries procedural detail that references the topic
without restating it ("the persons specified in part 1 shall…"). Splitting
spreads the topical signal across fragments, and no single fragment matches
a topic-shaped question as well as the whole article did.

**Status:** reverted. `PART_SPLIT_THRESHOLD` in `chunker.ts` is set to
`Infinity`; the implementation and a regression test are kept so re-enabling
is a one-constant change. Not confirmed against `gemini-embedding-2` — its
free-tier quota was exhausted that day — so re-testing with the production
model is legitimate, but the burden of proof now sits on re-enabling.

**The original problem is still open:** oversized articles remain unusable in
a generation context (`OPEN-ITEMS.md`). The better shape is probably
article-level embeddings for *retrieval* plus part-level extraction when
assembling *generation* context — one chunk size does not have to serve both.

## Benchmark scoring restricted to a common chunk universe (`--fair` mode)

Gemini's corpus embedding was incomplete (623–958 of 885 chunks, blocked by
provider rate limits — see `GOTCHAS.md`) when the benchmark first ran.
Scoring each model against its own full vector file would have penalized
Gemini for missing chunks in a way unrelated to embedding quality. `score.ts
--fair` restricts every retriever's candidate pool to the intersection of
chunks all models embedded, so the comparison measures embedding quality
alone. Confirmed the restriction doesn't artificially favor the winner: it
*improved* Voyage's numbers slightly (34.8% → 39.1% hit@5) rather than
suppressing them.

## Reranker shipped where hybrid RRF was not — the difference is evidence

Both were built to fix the same symptom: tax-return FORMS outranking the
articles that actually govern a topic. A form enumerates every tax term —
sole traders, employees, turnover, VAT — so it sits close in embedding space
to any term-rich question. A bi-encoder cannot distinguish "document that
mentions turnover tax" from "article that governs turnover tax", because it
never sees the query and the document together.

Hybrid RRF was the first attempt and failed: it fused a leg (FTS) that scores
0.0% on this golden set, so it contributed only noise while RRF still awarded
its top-ranked misses reciprocal-rank credit. hit@5 rose 73.9% → 78.3% (one
question) while MRR fell 0.578 → 0.445. Not shipped.

Reranking succeeded because it addresses the actual mechanism rather than
adding a second guess: a cross-encoder reads query and document jointly.
Every metric improved — hit@5 73.9% → 87.0%, recall@8 71.7% → 79.0%, MRR
0.578 → 0.677 — so it ships.

The rule both decisions follow: **a retrieval change is justified by the
golden set or it does not ship**, regardless of how well-motivated it is. Both
changes were equally well-motivated; only one worked.

`hybridRetriever` is kept in the code, unused. The obvious next experiment is
fusing FTS *under* the reranker — RRF alone could not discard lexical noise
and the reranker can. Re-measure before enabling.

## Reranking failures degrade to vector order, never to an error

`rerankChunks` catches every provider failure and returns the vector-ordered
candidates instead. Reranking improves ordering; it is not required for
correctness, and a Voyage outage must not take the whole system down.

This is deliberately the opposite of the choice made for the *vector* leg,
which announces its failure loudly (`warnVectorUnavailable`). The asymmetry is
the point: losing the vector leg drops retrieval to ~0% while the app still
produces confident-looking "no relevant fragments" answers — indistinguishable
from a genuine miss, so it must be noisy. Losing the reranker drops it to
73.9% hit@5, which is degraded but honest.
