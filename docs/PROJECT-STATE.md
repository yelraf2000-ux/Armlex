# ArmLex — project state

**Read this first in a new session.** `CLAUDE.md` (repo root) is the spec —
what we intend. This file and its siblings are the state — what is true.

| File | What's in it | Update it when |
|---|---|---|
| **PROJECT-STATE.md** (this file) | Orientation: status, what to do next | Anything material changes |
| [`CHANGELOG.md`](CHANGELOG.md) | Chronological log, one entry per piece of work | You finish anything worth remembering |
| [`OPEN-ITEMS.md`](OPEN-ITEMS.md) | The backlog, prioritized | Something closes or a new gap is found |
| [`DECISIONS.md`](DECISIONS.md) | Choices made and *why* | A non-obvious decision is made |
| [`GOTCHAS.md`](GOTCHAS.md) | Traps that cost real time once already | You hit a new one |
| [`BENCHMARK.md`](BENCHMARK.md) | Retrieval methodology, results, variance | The benchmark changes |
| [`CRAWLING.md`](CRAWLING.md) | Update detection | Pipeline B changes |

---

## Status at a glance (end of 2026-08-24)

**Live:** https://armlex.onrender.com — `/api/version` reports the deployed
commit. Corpus lives in shared Neon (live immediately); code needs push +
Render rebuild.

**Real traffic — the number that matters.** 250 authentic accountant questions,
Flash-Lite triage:

| | 2026-08-19 | 2026-08-23 | **now** |
|---|---|---|---|
| full | 31% | 29% | **47%** |
| partial | 40% | 47% | 38% |
| none | 29% | 24% | **14%** |
| names an article it lacked | — | — | **1 of 250** |

Improved 80 / worsened 25 / unchanged 145. Noise floor ~6% on verdict flips.

**Retrieval — 46 golden questions:** 87.0% hit@5 · 89.1% hit@8 · 87.0% recall@8
· MRR 0.740. Reliability over 3 draws: **87% always, 0% flipping, 13% never**.

**Corpus:** 33 documents · 1,737 chunks · 6,992 vectors · 1,100 ref edges.

**Shipped config:** vector top-50 → one-hop expansion → rerank-2.5 → tie-aware
cut (`RERANK_TIE_DELTA=0.02`) → `FRESH_LIMIT=8`, each chunk reduced by
`generationDocument` → `GUARANTEED_VECTOR_SLOTS=3` → `CITED_SLOTS=3`.
`FTS_POOL=0` (measured, did not help). Contextualiser at `temperature: 0`.
Generation: `claude-sonnet-5`, ~$0.06–0.12/question.

---

## DO THIS NEXT

**1. HAND-TEST 22 QUESTIONS — the owner, not the agent.** Nobody has verified
that a "full" verdict means a correct answer; the 47% is Flash-Lite grading
itself. **The 22 are now pinned in [`../data/eval/handtest-22.md`](../data/eval/handtest-22.md)**
with question text, triage verdict and the delivered article refs; regenerate
with `npx tsx packages/backend/src/eval/handtest-sheet.ts data/eval/triage-results-preTier1.jsonl data/eval/triage-results.jsonl data/eval/handtest-22.md`.
Score in three buckets only: *would send to a client* / *right but useless* /
*wrong or refused*.

> As of 2026-08-25 the owner reports 3 questions tested — micro-business and
> inbound-tourism good, the turnover-tax line still unable to name the line
> (known, `OPEN-ITEMS` 34). Only the first of those is inside the pinned 22, so
> **19–21 remain**.

- **10 marked `full`** — if 8 hold up, 47% is real; if 5, the true figure is
  ~25% and every number in these docs needs a caveat.
- **6 of the 25 that WORSENED** — `ՏՏ ոլորտի ԱՁ` (full→partial) matters most;
  it is the IT-benefits case the enumeration work started from.
- **6 marked `none`** — corpus gap, or an article we hold and did not deliver?
  Expect at least half to be delivery. Check the RANK before believing a gap.

**2. Classify the 25 regressions.** Easier now than after another change.

**3. Cheap-model decision.** The triage IS the Flash-Lite arm — it reached 47%
full at ~$0.01/question versus Sonnet's ~$0.06. Its open question is quote
fidelity (11% of answers contain a quote the validator strips). Test with
`compare-generators.ts`; `llm.ts` already has the Gemini path, so it is a config
flag. Pass bar: not materially worse than Sonnet on invalid quotes, declines to
invent a line number, and reaches the 129 → 113/109/124 conclusion.
~~**Before switching, build a mechanical validator for cited NUMBERS**~~ —
**DONE 2026-08-25.** `answer/validateNumbers.ts`, report-only, 20 tests, logged
in `chat.ts`. Power is 100% on the shapes that carry the documented harm (form
line refs, article/act numbers, thresholds) and 21% on one-digit numbers, which
is where RATES live — measured, not assumed, by falsifying every number in 39
real answers. Whether it may ACT is still open (`OPEN-ITEMS` 37, 38).

**4. Tier 2 — the remaining retrieval backlog.** 6 golden questions never
deliver everything; `աղյուսակ 3` sits at rerank rank 11 (`OPEN-ITEMS` 26, 34).
Deterministic now, so each is individually diagnosable.

**5. Re-embed** — `split.ts` duplicated-lead-in fix only reaches the index on a
re-embed (~7,000 slices, ~10 min quota).

**Retrieval is NO LONGER what blocks shipping.** What does: no accountant has
reviewed a sample; one shared password with no rate limiting at ~$0.12/question;
long conversations crash on the context limit (`OPEN-ITEMS` 12); NEW-document
discovery was never built, so a new SRC order lands and nothing notices —
silently serving superseded law is the worst failure a legal tool has.

---

## What shipped on 2026-08-24 (one line each)

Corpus 20→33 in three measured waves (waves 1 and 3 cost nothing; wave 2 cost
one question) · part-level extraction for generation + `FRESH_LIMIT` 4→8
(complete-context delivery 57.6%→81.8% at +9.6% cost) · tie-aware cut adopted
after being rejected once · guaranteed vector slots (reranker demotes articles
the vector leg ranked 2nd–8th) · same-article cross-references · cited-slot
guarantee (129→113/109/124; Class-2 smell 1 of 250) · contextualiser
`temperature: 0` (flipping 6.5%→0%) · rule 3a no invented numbers · `[…]`
redaction · rule 7a ask only for user facts · golden set 27→46 · benchmark
`--ctx` arm · `score.ts` empty-index guard · ingest `--apply`-gated after it
wiped production.

**Measured and REJECTED:** FTS fusion (gain vanished on a larger set) · wider
reranker budget (recall@8 87.0→85.9) · `temperature` on generation (Sonnet 5
returns 400) · tie-aware cut at its first measurement.

**Diagnoses RETRACTED:** "the reranker buries tables" (all 9 table questions
rank 1–4) · "the contextualiser is deterministic" · "the contextualiser degrades
retrieval" · "the Labour Code displaced Հոդված 254".

## The rule that keeps proving itself

**When the system says a provision is missing, check the delivered text before
you check the corpus.** Six separate failures in two days looked like corpus
gaps. Every one was an article that was present:

| case | where it actually was |
|---|---|
| `Հոդված 288` | rerank rank 4, never read |
| `Հոդված 254` | rank 6 |
| `Հոդված 112` | rank 7 — user only got an answer by rephrasing |
| `Հոդված 150` / `117` / `5` / `130` | vector top-8, demoted by the reranker |
| turnover-tax line table | rank 11, still unfixed |
| `Հոդված 267` part 5 | in the chunk, cut out of the delivered window |

An external evaluation diagnosed the last one as *"severe chunking gap, the
vector DB is incomplete"* and recommended rebuilding from scratch. The article
was in the corpus at full length. See `GOTCHAS.md` — external evaluations are
reliable on output quality and unreliable on internal cause, because they cannot
see the corpus, the ranks, or the delivered context.

## Measurement discipline (learned the hard way)

- **One question is 2.2 points on n=46.** Anything smaller than ~3 questions was
  noise until the pipeline became deterministic; treat single-question wins as
  unproven.
- **Single-draw recall and 3-draw reliability disagree.** Guaranteed slots moved
  recall +4.4 and reliability 0. Both are true — recall counts articles,
  reliability counts questions that get *everything*. Say which you mean.
- **Rank metrics cannot see delivery changes.** `hit@5` is identical whether
  `FRESH_LIMIT` is 4 or 8. `score.ts` has a separate delivered-set section for
  this; use it when changing what generation reads.
- **Four of seven experiments on 2026-08-24 were rejected on measurement**, and
  three diagnoses were retracted. That ratio is what measuring properly looks
  like. The retractions are written into the docs beside the findings.
