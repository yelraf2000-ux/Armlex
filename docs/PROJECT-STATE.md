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

**1. ~~`temperature: 0` on generation~~ — DONE DIFFERENTLY, 2026-08-24.**
Sonnet 5 **rejects sampling parameters** (`400: temperature is deprecated for
this model`), so the generator cannot be made deterministic the way the
contextualiser was. Do not retry this.

The analogy was wrong anyway. The generator was not drifting randomly — it
REASONED to a false number: seeing `5.10, 6.10, 7.10, 8.8, 9.10` in a
cross-reference, it inferred section 8 was asset disposal and stated line 17/8.8
as fact (section 8 is catering outside Yerevan). Fixed by prompt rule 3a — never
state a number that does not appear in a fragment attached to that meaning.
Measured over 3 runs: it now cites those numbers as evidence that sections
exist, and explicitly declines to name the line.

Tier 1 is COMPLETE: rule 3a (no invented numbers), `[…]` redaction instead of a
sentence spliced mid-clause, and rule 7a (ask only for facts the user has, never
for norms the system lacks). Generation is behaviourally stable, NOT
deterministic — a weaker guarantee. If a fabricated number ever reappears, build
a mechanical validator that checks cited line numbers against the delivered
text, mirroring `validateQuotes.ts`. Do not reach for a sampling parameter.

**2. Retest the micro-business question** once `/api/version` shows `eb1739d` or
later. `eb1739d` fixes same-article cross-reference following and was verified
LOCALLY to turn that answer from `partial` + "part 5 is absent" into `full` +
a definitive yes. It has not yet been confirmed on the deployed path.

    Կահույքի արտադրությամբ զբաղվող ԱՁ-ն կարո՞ղ է աշխատել միկրոձեռնարկատիրության համակարգով:

**3. ~~The quote-removal bug~~ — DONE 2026-08-24.** Redacts as `[…]` instead of
a sentence spliced mid-clause. The UI already carries the explanation once as a
footer; the safety guarantee is unchanged.

**3b. ~~Cross-article references (tier 3)~~ — DONE 2026-08-24.** Articles the
DELIVERED text cites now get a slot the reranker cannot take away
(`CITED_SLOTS=3`, same document only, ordered by who cited them).
`Հոդված 129` defines severance by reference to 113(1)(3,7), 109(1)(9) and 124;
those now arrive, and the wage-delay answer went from hedging to a definitive
"no severance regardless of seniority". Golden set unchanged — this alters the
DELIVERED set, not the ranking, so rank metrics cannot see it.

**TIERS 1 AND 3 ARE COMPLETE. Tier 2 (delivery) is the whole remaining
retrieval backlog:** 6 questions never receive every required article, and
`աղյուսակ 3` sits at rerank rank 11 (`OPEN-ITEMS` 26, 34).

**But retrieval is no longer the limiting factor for shipping.** What stands
between this and paying users is product work, not RAG work:

- **Expert verification.** Three answers have been graded, by the owner. A tax
  tool needs a practising accountant reviewing 30-50 answers before it is sold.
  No retrieval metric substitutes for this.
- **Auth and cost control.** One shared password, no accounts, no rate limits,
  ~$0.12 per question. Anyone with the password can run up the bill.
- **Long conversations crash** (`OPEN-ITEMS` 12) — no compaction, hits the
  context limit, surfaces as an unhandled 502.
- **Freshness is half-built.** Update detection compares stored text against
  ARLIS, but NEW-document discovery was never built. Silently serving superseded
  law is the worst failure mode a legal tool has.
- **Latency:** 8s to first text, 40-50s to complete.

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
