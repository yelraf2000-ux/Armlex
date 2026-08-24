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

## Status at a glance (2026-08-24)

**Corpus:** 33 documents · 1,737 chunks · 6,992 vectors (100% coverage) ·
1,100 `article_refs` edges. No longer tax-only — Labour Code, accounting/audit,
pensions, sickness+maternity benefits, cashless, currency, stamp-duty law, and
the SRC form-filling orders (N 299-Ն turnover tax, N 300-Ն income tax, N 1257-Ն
document issuance, N 2335-Ն travel, N 1260-Ն cash, N 326-Ն non-resident).

**Golden set:** 46 questions — 24 Russian tax, 5 Armenian labour, 3 Armenian
form-filling, 9 Armenian table-lookup, plus others. Hand-pinned answers where
the proposer structurally cannot see the chunk (`OPEN-ITEMS` 27).

**Retrieval, 46 questions:** 87.0% hit@5 · 89.1% hit@8 · 87.0% recall@8 ·
MRR 0.740.

**Reliability (3 draws per question — the number that matters):**

| | |
|---|---|
| all required articles delivered EVERY draw | **87.0%** |
| flipping between draws | **0%** |
| never delivered | 13.0% (6 questions) |

**Shipped retrieval config:** vector top-50 → one-hop citation expansion →
rerank-2.5 → tie-aware cut (`RERANK_TIE_DELTA=0.02`) → `FRESH_LIMIT=8` fresh
chunks, each reduced by `generationDocument` (matched part + lead + neighbours +
same-article cross-references), plus `GUARANTEED_VECTOR_SLOTS=3`.
`FTS_POOL=0` (measured, did not help).

**Live:** https://armlex.onrender.com — check `/api/version` for the deployed
commit. Corpus lives in shared Neon, so corpus changes are live immediately;
code changes need a push + Render rebuild.

---

## DO THIS NEXT, in order

**1. `temperature: 0` on GENERATION (`answer/llm.ts`).** The contextualiser was
fixed this way on 2026-08-24 (flipping 6.5% → 0%). The generator was NOT, and it
is now the visible failure: the same question on the same commit produced an
honest *"I can't determine which line"* on one run and a **confidently wrong**
line number on the next (it guessed section 8 — that is catering outside
Yerevan, not asset disposal). For a grounded legal tool, a fabricated line
number is the worst possible output and sampling buys nothing here.

**2. Retest the micro-business question** once `/api/version` shows `eb1739d` or
later. `eb1739d` fixes same-article cross-reference following and was verified
LOCALLY to turn that answer from `partial` + "part 5 is absent" into `full` +
a definitive yes. It has not yet been confirmed on the deployed path.

    Կահույքի արտադրությամբ զբաղվող ԱՁ-ն կարո՞ղ է աշխատել միկրոձեռնարկատիրության համակարգով:

**3. The quote-removal bug** (`OPEN-ITEMS`, parked by the user). The validator
correctly strips an unverifiable quote and leaves a hole mid-sentence:
`«…հանդիսանում է ոչ թե առևտրական, այլ [մեջբերումը չհաստատվեց և հանվեց]…»`.
Small, and it is visibly damaging answers being shown to people right now.

**4. Re-embed** to clear duplicated enumeration lead-ins out of the vectors.
`split.ts` was fixed on 2026-08-24 but the fix only reaches the index on a
re-embed (~7,000 slices, ~10 min of Gemini quota).

**5. The 250-question triage** — the only measurement that says what any of this
was worth to real users. Baselines exist: `triage-results-preLabour.jsonl`
(2026-08-19) and `triage-results.jsonl`. ~$3.

---

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
