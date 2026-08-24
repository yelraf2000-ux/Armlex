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

## Delivery variance — how much of the headline is noise (2026-08-24)

Every figure in this file is a SINGLE DRAW: one contextualiser rewrite, one
retrieval, one score. That hides whether "87.0%" means 87% of questions
reliably work or a larger set that each work most of the time — which imply
opposite next steps. Measured with 3 independent draws per question, 46
questions, delivery judged as "generation receives EVERY required article" at
FRESH_LIMIT 8:

| outcome | questions | share |
|---|---|---|
| delivered on **every** draw | 38 | **82.6%** |
| delivered on **some** draws — flipping | 3 | 6.5% |
| **never** delivered | 5 | 10.9% |
| (rewrite text varied across draws) | 32 | 70% |

**The rewriter is noisy and it almost never matters.** 70% of questions get a
materially different rewrite on each draw; only 3 change outcome. Retrieval
absorbs paraphrase.

**Read the headline as 82.6% reliable + a 6.5% variance band.** Practical
consequence for this benchmark: on 46 questions, one question is 2.2 points, so
**a change smaller than ~3 questions cannot be distinguished from noise.** That
retroactively justifies rejecting the tie-aware cut at its first measurement
(one question of 33) and adopting it at its second (a whole question class plus
+2.2 recall) — and it means single-question wins reported anywhere in this file
should be treated as unproven.

The flippers, with their delivery rate:

    2/3  Какие обязательства по НДС возникают при экспорте услуг
    1/3  Я на налоге с оборота, импортирую товар из-за границы
    2/3  Շրջանառության հարկով ... հաշվարկի ո՞ր տողը (turnover-tax line table)

The turnover-tax line question — the one wave 2 was ingested for — works about
two draws in three. Yesterday's "absent from the top 11" was the unlucky third,
not a permanent failure.

**The actionable backlog is the 5 never-delivered**, not the 3 flippers: those
fail deterministically and no amount of stability work reaches them.

### The set can no longer resolve the changes being made (2026-08-24)

The guaranteed-vector-slots change measured **+4.4 recall on a single draw** and
**−2.2 on a three-draw reliability run**. Both are 1–2 questions on n=46, and
the noise floor here is ~3 questions. The two measurements disagree and neither
can settle it. It is therefore **unproven and defaulted OFF**
(`GUARANTEED_VECTOR_SLOTS=0`), on the same rule that kept hybrid RRF and FTS
fusion off — not because the mechanism is wrong, but because it cannot be shown.

The mechanism IS verified per question: of six questions never receiving all
required articles, four had the gold article in the vector top-8 and the
reranker demoted it (`Հոդված 150` @2, `117` @3, `5` @7, `130` @8). That is a
real defect. What cannot be established at n=46 is whether fixing it helps
overall.

**Where the variance comes from — measured, and not where it was first
attributed.** On identical input:

| stage | behaviour |
|---|---|
| vector search | deterministic |
| rerank-2.5 | deterministic — 1 distinct top-8 in 3 calls |
| **contextualiser** | **non-deterministic, and bimodal** |

The contextualiser does not vary in *how* it rewrites so much as *whether* it
rewrites. One run left all 46 questions untouched; another rewrote 24 of 46; a
direct probe gave 2 distinct outputs in 3 calls. Retrieval faithfully propagates
whichever regime it lands in.

**Consequence for anyone tuning retrieval next:** stop tuning against this set.
A 1–2 question effect cannot be separated from a rewriter that flips regime
between runs. Two ways forward, both bigger than a parameter change:

1. **Pin the query.** Score retrieval on raw questions only, removing the
   contextualiser from the measurement, and evaluate the contextualiser
   separately. Fast, and it makes retrieval changes decidable again.
2. **Change arbiter.** Use the 250-question real-traffic triage, where a
   2-question effect is 0.8% rather than 4.3%, and which measures answers rather
   than ranks.

Until one of those is done, further retrieval tuning is unfalsifiable.

### Fixed: `temperature: 0` on the contextualiser removes the flipping (2026-08-24)

Same 3-draw measurement, same configuration, only the contextualiser changed:

| outcome | before | after |
|---|---|---|
| delivered on **every** draw | 38 (82.6%) | **40 (87.0%)** |
| **flipping** | 3 (6.5%) | **0 (0.0%)** |
| never delivered | 5 (10.9%) | 6 (13.0%) |
| (rewrite text varied across draws) | 32 | 10 |

**Flipping is eliminated.** The three unstable questions resolved
deterministically — two into "always", one into "never". The "never" count
rising by one is not a regression: that question already failed two draws in
three, and now fails visibly instead of intermittently, which makes it
diagnosable.

Note `temperature: 0` is not an absolute determinism guarantee — 10 questions
still receive a different rewrite between draws (down from 32). It no longer
matters: delivery is consistent regardless, so the residual wobble is below the
threshold that changes an outcome.

**What this unlocks.** Repeated runs of the same configuration now agree, so the
~3-question noise floor collapses toward zero and a 1–2 question effect becomes
measurable. The experiments abandoned as unfalsifiable — guaranteed vector slots
most of all (`OPEN-ITEMS` 33) — can now be decided. Re-measure them before
trusting any earlier verdict: both the +4.4 single-draw and the −2.2 three-draw
figures for that change were taken against a moving target.

### Guaranteed vector slots: shipped at 3, and what it does NOT do (2026-08-24)

Re-decided on the deterministic pipeline, paired (same rewrite, same pool, only
the config varies — the earlier unpaired comparison could not do this):

| slots | recall of required | ALL required | mean chunks |
|---|---|---|---|
| **0** | 89.1% | 87.0% | 10.13 |
| 2 | 91.3% | 89.1% | 10.54 |
| **3 ← shipped** | **93.5%** | **91.3%** | 10.93 |
| 4 | 93.5% | 91.3% | 11.41 |

3 is the efficient point; 4 buys nothing. **+4.4 points of recall for +8%
tokens.**

**The 3-draw reliability check disagrees, and the disagreement is the useful
part:**

| | slots 0 | slots 3 |
|---|---|---|
| all required, every draw | 40 (87.0%) | 40 (87.0%) |
| flipping | 0 | 1 |
| never delivered | 6 | 5 |

**It does not increase the number of questions reliably and FULLY answered.**
One question moved from "never" to "1 draw in 3", which is not a fix.

Both are true because they measure different things. `ALL required` is
all-or-nothing per question; `recall of required` counts articles. Guaranteed
slots delivers MORE of the needed articles per question without crossing the
all-or-nothing line on more questions. For a grounded tool that is worth having
— an answer resting on 3 of 4 governing articles beats one resting on 2 of 4,
and the all-or-nothing metric is blind to that difference.

**Why it works at all:** the reranker demotes articles the vector leg ranked
highly. Of six questions never receiving everything, four had the gold article
in the vector top-8 — `Հոդված 150` @2, `117` @3, `5` @7, `130` @8 — and the
cross-encoder pushed them out. This bypasses that for the top 3 only, so the
reranker still orders everything else.

**Do not read the +4.4 as questions fixed.** It is grounding quality, not
coverage. The 5 never-delivered questions remain the real backlog.
