# Open items

The backlog. This file changes often — update it when something closes or a
new gap is found, rather than letting `PROJECT-STATE.md` grow.

## Critical path — CLOSED 2026-08-15

Items 1–5 (load vectors → verify HNSW → hybrid RRF → swap the binding →
re-measure) are all done. Retrieval is live at **87.0% hit@5** via
`vector top-50 → rerank-2.5`. Hybrid RRF was measured and deliberately NOT
shipped (`DECISIONS.md`). The next priority is answer quality — item 10.

## Known broken, with evidence

6. ~~**Transliterated Armenian returns zero results.**~~ **DONE 2026-08-15.**
   The contextualiser now normalises Latin-script Armenian into Armenian
   script before retrieval. Verified: `"es uzum em pokr xanut bacel"` →
   `"ես ուզում եմ փոքր խանութ բացել"`. End-to-end retrieval impact not yet
   measured (blocked on Gemini quota).
7. ~~**No reranker.**~~ **DONE 2026-08-15.** `voyage rerank-2.5` over the
   vector top-50. hit@5 73.9% → **87.0%**, MRR 0.578 → **0.677**, and the
   tax-return FORMS that outranked governing articles are gone from the top 5.
   Median 547 ms for 50 documents; falls back to vector order on any provider
   error. Remaining upside: re-test hybrid FTS+vector *under* the reranker —
   RRF alone failed because it had no way to discard lexical noise, and the
   reranker does.
8. ~~**`article_refs` unused by retrieval.**~~ **DONE 2026-08-18.** One-hop
   expansion ships: top-8 candidates contribute the provisions they cite, then
   the reranker judges the enlarged pool. hit@5 80.0% → 84.0% on 25 questions.

   **Still open — two retrieval gaps it did not close:**
   - A question naming both a transaction and a regime ("на налоге с оборота,
     импортирую товар") follows the transaction. `Հոդված 258` loses to the
     VAT-import articles. Needs regime awareness, which neither embeddings nor
     the citation graph supply.
   - **`score.ts` measures retrieval WITHOUT the contextualiser**, so the
     benchmark understates the shipped pipeline. Worth adding a live-path arm
     before trusting either number as "the" figure.
9. ~~**`fact_summary` doesn't exist.**~~ **DONE 2026-08-15.** The
   contextualiser maintains a running summary of USER-stated facts, persisted
   to `sessions.fact_summary`, and feeds it into both the search query and the
   generation prompt. Verified across three turns (shop → +sole entrepreneur
   +30M turnover → +2 employees): a vague follow-up *"а что если оборот
   вырастет вдвое?"* now searches with all established facts folded in, which
   is exactly the dead-end the "I want to open a shop" case hit.
10. ~~**Confidence gate is accidental, not designed.**~~ **DONE 2026-08-15.**
    Explicit full/partial/none, declared by the model before it writes and
    surfaced in the UI. NOT on reranker scores — measured, and they do not
    separate covered from missed questions (see `DECISIONS.md`). Validated 6/6
    on known-covered and known-missed questions; re-check as the golden set
    grows, since that sample is small.
11. ~~**No quote verbatim-substring validation**~~ **DONE 2026-08-15.**
    `answer/validateQuotes.ts` checks every quoted Armenian span against the
    supplied chunk texts; unverifiable quotes are removed while their citation
    is kept. Exact matching, not fuzzy — "close enough" is the failure mode
    being guarded against, since a quote differing by one digit or a negation
    is both nearly identical and completely wrong. 11 tests, including a
    changed deadline (`20-ը`→`25-ը`) and an inserted negation. Wired into both
    `ask` and `chat`; the removal count is returned in the API response.
12. **Chat has no context-window handling.** `chat.ts` resends full message
    history every turn with zero compaction, on top of 4 fresh + up to 5
    carried chunks per turn (~1.7 tok/char). A long conversation can hit
    `stop_reason: model_context_window_exceeded` — a clean API error, not
    silent corruption — but nothing catches it; it currently surfaces as an
    unhandled 502. Needs compaction, or a hard turn/token cap with a
    graceful user-facing message.

17. ~~**No streaming.**~~ **DONE 2026-08-15.** SSE with stage / chunks / delta /
    done events; quote validation moved into the stream without weakening it
    (`streamGate.ts`). Progress at 0.1s, articles at ~7s, first text at 8.0s
    (was 13.9s), complete 39–50s.

    **Still open: first text is 8.0s, not the 3–4s target.** The floor is ~6.5s
    of sequential API calls — contextualise 3.7s, then embed + rerank 2.8s.
    The only real lever left is taking the contextualiser off the critical
    path (speculative retrieval on the raw query, reranked with the enriched
    one). That risks exactly the colloquial-question quality the contextualiser
    was added to fix, so measure on the golden set before adopting.
18. ~~**Anthropic credit exhausted.**~~ Resolved same day — the balance was
    topped up and the API returns 200. The UI now names this failure explicitly
    instead of showing a raw 502, since an empty balance is not an application
    bug. Budget note: ~$0.09 per chat turn.

## Systemic fixes (three-class taxonomy — priorities REORDERED by real-traffic data, 2026-08-19)

Measured over 250 authentic questions: labour/payroll drives ~24% of all
traffic and 40% of hard failures; Class-2 fired once in 250. New order:

19a. ~~**Ingest the Labour Code**~~ **DONE 2026-08-23.** arlis 51, 288 articles,
    no parser work needed. Corpus 21 docs / 1,190 chunks / 5,639 vectors /
    891 ref edges. **Tax retrieval unchanged** — 88.9 / 92.6 / 87.0 / 0.681
    before and after, measured same-index same-day; the 638→885 distractor
    precedent did not repeat (labour law is topically distant, not a
    near-miss). Wage-delay question now returns `Հոդված 130` at rank 1 plus
    129 / 198 / 112 in the top 8. See `CHANGELOG.md`.

    **Still open from the same item:** statistical-reporting act, high-tech
    list decision, SRC order N 1513-Ն (item 19 below) are NOT ingested.
    Whether generation now *uses* the labour norms rather than hedging is
    unverified — retrieval is confirmed, answer quality is not.

24. **`score.ts` reports 0.0% when the vector index is empty.** It cannot
    distinguish "no rows in `embeddings`" from "retriever found nothing", and
    0.0% is also the genuine FTS number — so a wiped index renders as a
    plausible result table. Cost real time on 2026-08-23 chasing a phantom
    reranker regression that was actually the index being deleted mid-run.
    `retrieve.ts` already has this guard for the API path (`warnVectorUnavailable`
    — "degrading must never be silent"); the eval harness needs the equivalent
    for the database path. Fail loudly, don't print a table.

25. **npm swallows option flags on every workspace script.** Root scripts are
    `npm run X -w @armlex/Y`, so `npm run X -- --flag` appends to the inner npm
    with no second `--` and npm claims any flag it recognises. `ingest` is fixed
    (`--apply`-gated, `--doc` not `--only`); `crawl` was already safe;
    **`reembed.ts` is untraced.** Bare positionals survive. Audit the rest, and
    prefer direct `npx tsx <path>` invocation in docs.
19b. ~~**Class-1 retrieval fix**~~ **DONE 2026-08-19 — by a different route
    than planned.** The mechanism behind every Class-1 failure was enumeration
    blur (one vector per ~3,300 chars of unrelated list items), not missing
    regime awareness. Fixed at the index (one vector per enumerated item) and
    at the reranker (shown prefix + matched slice). Live golden set: hit@5
    85.2% → 88.9%, hit@8 88.9% → 92.6%, MRR 0.653 → 0.681. The regime-aware
    contextualiser stays a *candidate* for the residual misses (the
    transaction-vs-regime case is still MISS).

    **Re-measured on real traffic (2026-08-19):** full 19% → 31%, none 33% →
    29%; 57 improved / 24 worsened / 169 unchanged; noise floor 5 of 81 verdict
    flips on identical retrieval. Four tax-proper regressions have *different*
    retrieval and are candidates for the golden set once their expected
    articles are verified against ARLIS:
    - ՏՏ ոլորտի արտոնություններ — Հոդված 254 dropped out of the top 4
    - ՀԴՄ ձեռքբերման գումարի նվազեցում — lost 121/73, gained 55/416
    - ՓԲԸ ուղևորափոխադրումներ — lost 55/19.7/6, gained 380.1/33/381
    - Հաշվետվություններ ՌԴ-ից ներմուծման դեպքում — Հոդված 98 dropped
    Do not "fix" these one by one: pin, then look for the shared cause.
19c. **Flash-Lite quote-rule tightening** (11% invalid-quote rate in triage).


20. **[DEPRIORITISED by data: 1 firing in 250 real questions] Class 2, cheap
    tier: cited-slot guarantee.** Articles cited by the
    selected top hits get a guaranteed context slot, so the model never again
    asks the user for a norm sitting in our own database (bakery case:
    named Հոդված 77, edge 270→77 present, article present, reranker dropped
    it). Deterministic, no latency cost, measure on the golden set.
21. **Class 1: regime-aware contextualiser.** Classify the governing regime
    and boost its chapter at retrieval. Covers the import-deduction and
    5.11/5.7 misses — both pinned as golden questions before the fix is
    attempted, so it is scored, not assumed.
22. **Class 2, general tier: bounded case-mode loop.** Max ~3 extra fetches,
    hard timeout, degrade to tier-one behaviour. Build only after 20–21 shrink
    how often it is needed. Orin's stuck 5-minute generations are the
    cautionary example of the unbounded version.
23. **Verify Orin's 267(5) invalidation claim on ARLIS.** Our consolidated
    text still contains it; one of the two systems is wrong about standing
    law. If they are right, our corpus has a consolidation gap worth
    understanding; if wrong, it is the strongest differentiation evidence yet.

## Corpus / evaluation

19. **SRC order N 1513-Ն is not ingested.** Only N 1512-Ն is (arlis 199961).
    Both were passed 2024-11-20 and operate as one reform from 2025-01-01, so a
    question about the new personal-account rules gets half the picture — and
    the validator correctly purges any citation to the missing half.

13. **7 of 30 golden questions unresolved.** 2 are a confirmed scope gap
    (IT-startup incentive law never ingested — `DECISIONS.md`); 5 need a
    second `proposeV2.ts` pass with different phrasing or a wider candidate
    count before concluding they're genuine gaps.
14. **Update detection built (2026-08-15); NEW-document discovery is not.**
    `npm run crawl` diffs the live site against stored chunks at article level,
    logs to `crawl_log`, and warns after 10 quiet days. See `docs/CRAWLING.md`.
    Finding newly published acts still needs either the ARLIS search endpoint
    reverse-engineered (possibly JS-rendered) or sequential id probing across a
    shared national id space plus a classifier. Adding a document is therefore
    still a manual decision.
15. ~~**311 Gemini embedding slices remaining.**~~ **DONE 2026-08-15** — paid
    tier enabled, 1,269/1,269 slices embedded, 885/885 chunks in pgvector.

## Housekeeping

16. **Rotate exposed keys.** Neon password, Gemini key, Anthropic key, and
    Voyage key have all passed through chat at some point this project.
    Nothing is committed to git (`.env` is gitignored, `.env.example` verified
    clean) so there's no urgency, but rotate before the repo is shared with
    anyone else.

26. **CORRECTED 2026-08-24 — it is not "tables lose to prose".** The first
    diagnosis was wrong and is kept here because the correction is the useful
    part. Nine table-lookup questions were added (39-47), each targeting a
    DISTINCT table chunk — depreciation periods, income-tax rate by year, road
    tax by vehicle mass, waste rates by hazard class, social-payment brackets,
    per-diem minimums, court duty, stamp-duty brackets, ԱՏԳ ԱԱ codes. **All
    nine retrieve at ranks 1-4.** The reranker handles tables fine.

    What actually fails on Q36 is INTRA-DOCUMENT discrimination. Its vector
    pool of 50 was 100% N 299-Ն: eighty-odd chunks from one document, all about
    turnover-tax calculation, all plausible. The reranker cannot separate "the
    table listing which line each income type goes on" from "the instruction
    for filling line 5.1" when both are the same document on the same topic.
    The other nine questions never face that — their answer table is topically
    distinctive against a diverse corpus, so it wins easily.

    That reframes the fix. Not table-aware reranking; something that
    discriminates WITHIN a document once the document is obviously right —
    lexical matching on the literal terms of the query («այլ ակտիվների»,
    «տող»), or a per-document diversity cap in the pool so eighty chunks of one
    act cannot crowd out everything else. FTS fusion addresses the first and is
    being measured now; note FTS rose 5.4% -> 15.2% when these table questions
    entered the set, which is lexical search doing exactly what it is good at.

    ~~**The reranker buries TABLE rows under prose — top retrieval problem.**~~
    "Which line of the turnover-tax calculation?" → the answer is
    `137687#Հավելված 1, աղյուսակ 3` row 20. Vector search ranks it **2**;
    rerank-2.5 ranks it **11**, outside anything generation reads. Ten prose
    instruction points about trading activity outrank the table that holds the
    line numbers. Same asymmetry `BENCHMARK.md` recorded for slice-only
    reranking ("terse table rows lost to rich prose openings"), but far worse on
    form documents, which are almost entirely terse rows. Golden question 36
    pins it. Two candidate fixes, NEITHER measured:
    (a) a row-level document for the reranker, mirroring the enumeration fix;
    (b) fuse FTS *under* the reranker — «տող» against a table of line labels is
    where lexical search should win, and FTS is no longer 0% now that the golden
    set has Armenian questions (0.0% → 5.4%).

27. **`proposeV2` cannot propose form documents.** It matches a TITLE index;
    form chunks are titled `Հավելված 1, աղյուսակ 3`, which encodes nothing about
    content. It offered only Tax Code articles for a question answered entirely
    inside N 299-Ն. Form-shaped golden answers need hand-pinning until the
    proposer indexes content. Q36's gold answer is hand-pinned and marked as
    such in `golden_verified.csv`.

28. **`proposeV2` + `verify` silently DROP golden questions.** `verify` rewrites
    `golden_verified.csv` from scratch, so any question whose previously
    verified article does not survive a new proposal pass vanishes. On
    2026-08-24 this removed four questions — all of them pinned hard cases
    (import-deduction, trading-expense deduction, language-course licence, IT
    benefits) — and the headline score rose 4 points as a result. Recovered by
    merging against a backup. Either make the rewrite additive, or make the
    merge a scripted step; never run the proposer without a backup.

29. **Per-question detail is overwritten every run.** `benchmark_results.md`
    keeps only the latest, and only for the best retriever, so attributing a
    regression to a specific wave is guesswork after the fact. Wave 2 lost one
    question and it could not be identified. Write per-run detail to a
    timestamped file, or at minimum keep the previous run.

30. **Corpus items still missing** (from the accountant document list):
    EAEU Customs Code · EAEU import declarations and indirect taxes ·
    maternity/disability benefit APPLICATION procedure · current fuel and
    lubricant norms (N 1666-Ն supersedes the 2005 N 1001-Ն).
    **IFRS is blocked, not pending** — not on ARLIS, IFRS Foundation copyright,
    adopted by Armenian law only by reference. A licensing decision, not an
    engineering one.

31. ~~**The contextualiser flips regime between runs.**~~ **FIXED 2026-08-24**
    with `temperature: 0`. Flipping 6.5% -> 0%, reliable set 82.6% -> 87.0%.
    Residual: 10-11 questions still see a different rewrite between draws, but
    it no longer changes delivery. Original diagnosis kept below.

31b. **The contextualiser flips regime between runs — the real instability.**
    Measured on identical input: vector search deterministic, rerank-2.5
    deterministic (1 distinct top-8 in 3 calls), contextualiser NOT. And it does
    not vary in *how* it rewrites so much as *whether* it rewrites at all: one
    run returned all 46 golden questions untouched, another rewrote 24 of 46, a
    direct probe gave 2 distinct outputs in 3 calls. Retrieval faithfully
    propagates whichever regime it lands in, which is why the same question can
    deliver its answer on one draw and not the next.

    This is upstream of every retrieval number in the project. Fix candidates:
    pin `temperature: 0` on the contextualiser call; or skip the rewrite
    entirely when the question is already standalone (no history, no pronouns),
    which is the common case in a first turn and would remove the variance
    rather than reduce it.

32. **PARTLY LIFTED 2026-08-24.** With the contextualiser deterministic, repeated
    runs agree and paired A/B is possible, which was enough to re-decide
    guaranteed vector slots. Still true that a 1-2 question effect is 2-4 points
    on n=46, so the 250-question triage remains the better arbiter for anything
    marginal. Original entry below.

32b. **The 46-question golden set can no longer resolve the changes being made.**
    One question is 2.2 points; the noise floor is ~3 questions; the last two
    experiments moved 1–2. Guaranteed vector slots measured +4.4 single-draw and
    −2.2 on three draws — unproven, defaulted OFF. Further retrieval tuning is
    unfalsifiable until either the query is pinned (score raw questions only,
    evaluate the contextualiser separately) or the arbiter moves to the
    250-question triage, where 2 questions is 0.8%. See `BENCHMARK.md`.

33. **The reranker demotes gold articles the vector leg ranked highly** —
    MITIGATED 2026-08-24 by `GUARANTEED_VECTOR_SLOTS=3` (recall of required
    articles 89.1% -> 93.5%, +8% tokens). NOT closed: the number of questions
    reliably receiving EVERY required article did not move (40/46 either way).
    The mitigation improves grounding depth, not coverage. Original entry: Of six questions never receiving
    all required articles, four had the gold article in the vector top-8:
    `Հոդված 150` @2, `117` @3, `5` @7, `130` @8. The aggregate agrees —
    vector-only beats reranked on hit@5 (89.1 vs 87.0) and recall@5 (83.0 vs
    80.4), losing only MRR. The guaranteed-slots fix for this is written and
    env-gated (`GUARANTEED_VECTOR_SLOTS`); it needs a set that can measure it.

34. **The turnover-tax line question — now fully specified, still failing.**
    «Which line for a fixed-asset sale?» needs exactly TWO chunks, and the
    answer is **row 20, filled directly** — there is no 9.x sub-line, because
    asset disposal gets no expense-deduction section (article 260 excludes item
    9 of the 258 table).

    | piece | what it gives | status |
    |---|---|---|
    | `137687#Հավելված 1, աղյուսակ 3` | row 20 = «Այլ ակտիվների … օտարումից», 10% | **rank 11, not delivered** |
    | `137687#Հավելված 1, կետ 63` | «12-րդ, 13-րդ, 15-րդ, **18-20-րդ** կետերում` [Գ] = [Ա] x [Բ]» | **delivered, NOT USED** |

    Both are now pinned as required answers for golden question 36, so a fix is
    measurable rather than anecdotal.

    **Two distinct defects, and only one is retrieval.** `աղյուսակ 3` never
    reaches generation (`OPEN-ITEMS` 26). But `կետ 63` DID — it appears in the
    read list — and the model used its first clause (the 5.10/6.10/7.10/8.8/9.10
    mapping) and stopped before the clause that answers the question. That is a
    reading failure inside a delivered chunk, a class not previously recorded.

    **This contradicts the obvious prescription.** An external review of the same
    answer recommended raising Top-K to 20 and adding BM25. More retrieval would
    not have helped: half the answer was already in context. Every guessed line
    number so far has also been wrong — `8.8`, `9.1` and the review's `9.2`.
    Section 9 is «այլ գործունեությունից» (other ACTIVITIES), as points 9.1, 9.3
    and 9.6-9.11 all state.

35. **REJECT the recurring "soft verifier" suggestion.** External reviews keep
    proposing that `validateQuotes.ts` accept ~95% semantic similarity instead
    of exact substring matching, because `[…]` redactions look untidy. Do not.
    A quote reading «մինչև 25-ը» for «մինչև 20-ը» is ~97% similar and gives an
    accountant the wrong filing deadline. Item 11 already settled this: "close
    enough" IS the failure mode. The correct fix is FEWER strips — prompt the
    model to quote only what it can copy exactly — never weaker checking.

40. **No budget alarm on any provider.** The 2026-08-25 outage was discovered by
    a user receiving a wrong answer, not by monitoring. Three providers are now
    on the critical path (Gemini embeddings, Voyage rerank, Anthropic
    generation) and each disguises exhaustion differently — 429, and 400. A
    depleted embeddings balance takes retrieval to zero, which is the most
    damaging of the three. Cheapest useful version: a startup + daily probe of
    each provider with one cheap call, logged to `crawl_log` and surfaced in the
    corpus banner.

41. **`search_unavailable` is unverified in the UI, and `ask.ts` is unguarded.**
    The streaming route names the failure; the non-streaming `/api/ask` path and
    `ask.ts` still degrade silently, and the frontend's handling of the new event
    was not checked because the working tree has uncommitted frontend changes.
    Until then a user on the ask path can still be told a norm does not exist
    when the truth is that search is down.

37. **The number guard is built and REPORT-ONLY — the enforcement decision is
    open.** `answer/validateNumbers.ts`, 20 tests, logged in `chat.ts` and
    recorded per-question by `triage.ts`. Measured power against a falsified
    number of the same shape in the same sentence: **100% on hierarchical refs
    (`9.2`), 3–4 digit integers and grouped amounts; 91% on 2-digit; 21% on
    1-digit**. Firing rate on real answers is 2 in 39, both defensible.

    What is NOT decided is whether it may act, and there are three candidate
    answers, none measured:
    - **Enforce on the `line` family only.** It is the documented harm (`8.8`,
      `9.1`, `9.2`), its power is 100%, and the genuine line numbers in the
      corpus appear under an explicit «տողերը» label. Narrowest useful action.
    - **Surface without rewriting** — a footer naming the unverified number, as
      the quote validator does for strips. Cheap, and it cannot break a
      sentence.
    - **Regenerate the sentence.** Correct in principle, an extra API call and
      an unbounded loop in practice; see item 22's cautionary note.

    Do NOT excise the number the way a quote is excised: «լրացրեք […] տողը»
    tells the reader nothing and destroys the sentence. And do not raise
    1-digit power by loosening the label rule — that is the direction item 35
    rejects for quotes, for the same reason.

38. **Tax RATES are the weakest protected class, structurally.** A rate is
    usually one digit, and one digit appears somewhere in 30,000 characters of
    statute essentially always, so digit matching cannot verify it — only the
    adjacent «տոկոս»/`%` label can, which is what lifted 2-digit power from 58%
    to 91%. Residual 1-digit power is 21%. A fabricated «5 տոկոս» where the law
    says 10 would still pass if any provision in context states any 5 next to a
    percent marker. Candidate fix: check the rate against the SPECIFIC row of
    the rate table the answer cites, rather than against the whole context.

39. **`namedNotRetrieved` in `triage.ts` misses Armenian word order.** It
    matches «Հոդված 209»; an answer writing «209-րդ հոդվածը» is invisible to it.
    It reports 0 of 250 Class-2 smells, and the number guard flagged exactly
    this shape on real answers. The Class-2 figure is therefore an undercount
    of unknown size — fix the regex before citing 1-of-250 again.

36. **"Line 9.2" is wrong and has now been asserted three times** by external
    review (after 8.8 and 9.1). Verified against primary text: `կետ 50` says
    9.1 is «այլ ԳՈՐԾՈՒՆԵՈՒԹՅՈՒՆԻՑ», so section 9 is other ACTIVITIES. Asset
    disposal is **row 20 of `Հավելված 1, աղյուսակ 3`, filled directly** —
    `կետ 63`: «12-րդ, 13-րդ, 15-րդ, 18-20-րդ կետերում` [Գ] = [Ա] x [Բ]». No 9.x
    sub-line exists because article 260 excludes item 9 from the deduction
    mechanism. Both required chunks are pinned on golden question 36.

42. **THE TOP DEFECT IS CONTEXT ASSEMBLY, not the model and not retrieval.**
    Measured by `answer-coverage.ts` (n=6 provisions, 2 questions, Sonnet):

        of provisions DELIVERED to generation, 100% were used
        50% of required provisions were NEVER delivered
        27% and 33% of retrieved characters reached the model

    `Հոդված 258` is retrieved at **rank 1** and then reduced from 8,134
    characters to 1,672 by `generationDocument`. The 7% rate survives; the 3%
    deduction floor (part 3) and the fixed-asset exclusion (part 6(2)) do not —
    and the second decides the EV-charging question outright.

    **This retracts the prompt-side diagnosis.** The model reads what it is
    given, so a stronger "what to check" instruction, a completeness pass, or a
    second opinion all aim at the wrong layer. The lever is the extraction
    window in `retrieval/rerank.ts`.

    Candidates, none measured:
    - **Follow same-article references, which already exists but is bounded to
      parts the delivered text names.** Part 1's table does not name part 6, so
      the deduction machinery is unreachable from the rate row. Widening the
      trigger from "named parts" to "parts the QUESTION implicates" would reach
      it.
    - **Deliver the whole article when it is short enough.** 8,134 characters is
      ~14k tokens of Armenian — real money at Sonnet prices, but `FRESH_LIMIT`
      is already 8 chunks and the 4→8 change bought 57.6%→81.8% on complete
      context. Measure the same way.
    - **Never trim the rank-1 chunk.** Cheapest possible version, and it would
      have fixed this case outright.

    Measure with `answer-coverage.ts` before and after; `score.ts` is blind to
    all of it, since retrieval already scores 100% here.

    Caveat: 6 provisions is a very small base. Grow the marker file — the 22
    hand-test answers are the natural source, which is one more reason the
    hand-test matters.

43. **Q36's row 20 may already be fixed.** `OPEN-ITEMS` 26/34 record
    `137687#Հավելված 1, աղյուսակ 3` at rerank rank 11 and undelivered. On
    2026-08-25 `answer-coverage.ts` reported it DELIVERED **and** USED. If that
    holds, the tie-aware cut or guaranteed vector slots closed it and both items
    can be retired. Confirm before believing it — one run, and the marker
    («Այլ ակտիվների») could match another chunk.

44. **Per-turn diagnostics are not persisted — only the text is.** `messages`
    holds `id, session_id, role, content, created_at` and nothing else. The
    retrieved article refs, the coverage verdict, the stripped-quote count, the
    model and the cost all go out in the `done` SSE event and are then dropped.

    This is about to cost real information. 2026-08-25 showed twice over that
    the first question about any bad answer is *"what text did generation
    actually receive"* — and for a live session there is now no way to answer
    it. Handing the app to a tester without this means their session produces
    opinions we cannot diagnose.

    Cheapest sufficient version: one additive table keyed by message id holding
    `article_refs text[]`, `coverage`, `invalid_quotes`, `unsourced_legal`,
    `model`, `ms`. Additive only — no change to `messages` — so it cannot
    disturb the live site. `eval/review.ts` already reads and exports the
    conversations and would join it directly.

## Market feedback — first external reviews (recorded 2026-08-28)

Three audiences: first casual users, price-sensitivity screenshots, and
accountants with 20-25 years of practice. Kept verbatim-ish because the
wording is the data.

45. **"Հին ու նոր ինֆո յա տալիս" — old and new turnover-tax rules mixed in one
    answer.** The single most dangerous item in the feedback, and it is NOT a
    hallucination: the 2025→2026 turnover-tax reform changed rates, the corpus
    holds articles containing both current text and transitional provisions,
    and answers do not distinguish "in force now" from "in force from
    2026-01-01" or "as before the amendment". Three findings converge here:
    - the crawl of 2026-08-25 found `Հոդված 272` (micro→turnover transition)
      and the local-duty RATE articles changed on ARLIS and NOT yet re-ingested
      (the corpus is serving pre-amendment text right now);
    - the experienced accountants asked, unprompted, for transitional
      provisions (անցումային դրույթներ) to be emphasised;
    - they also asked for "what changed recently" to be highlighted.
    One product gap, three symptoms: THE SYSTEM HAS NO TEMPORAL AWARENESS in
    its answers. `articles.effective_from/to` exist in the schema and are
    unused by generation.

46. **"Too much dry statute text" (casual) + "adds irrelevant provisions"
    (experts) — the answer is too long and under-prioritised.** Both segments,
    independently. Note the tension with the context-assembly finding (item
    42): generation READS too little and WRITES too much. These are not
    contradictory — the fix is prioritisation at both ends, not a knob turned
    one way.

47. **Validated bets, for the record:** accuracy rated high by 20-25-year
    accountants; "better than orin.ai — gives the concrete laws, rests on a
    real base"; "much faster than the competitor"; the citation-first format
    lands with GPT-accustomed users. The three core bets (grounding, verbatim
    citations, deterministic pipeline) are the parts the market liked.

48. **B2C price resistance is real.** "iCloud's $3/mo already hurts";
    "$10+/mo — few will pay". Individual-subscription revenue at scale is in
    doubt; the reviewers themselves suggested B2B. Matches the firm-licence
    analysis of 2026-08-25: ~9,000 accountants sit in a few hundred
    organisations, and a few hundred B2B deals beat 4,500 B2C conversions.

49. **Real users stack unrelated questions in one chat — observed by the owner,
    confirmed in sessions (2026-08-28).** Of 21 multi-question sessions, most
    are legitimate drill-downs, but e.g. `4f995f13` goes vacation-compensation
    → turnover-tax rates in one chat. Three consequences:
    - `fact_summary` + carried chunks deliberately persist across turns, so an
      unrelated follow-up risks contamination. `isTopicShift` exists to defuse
      this and HAS NEVER BEEN MEASURED. Test: same question asked fresh vs
      after an unrelated topic; compare retrieval. If contaminated: clear
      summary + cache on shift.
    - Item 12 (context-window crash) is UN-deprioritized. The "91% one-shot"
      figure included agent probes and forum-shaped traffic; live humans
      stack. Cheapest fix: turn cap + graceful "new consultation" message.
    - Two undesigned behaviours observed: a user PASTED AN ARLIS URL expecting
      the tool to read it (free feature — corpus already keys by arlis id; a
      link is a document lookup), and bare conversational fragments («հա որ»,
      «why») as follow-ups, which the contextualiser must survive.
