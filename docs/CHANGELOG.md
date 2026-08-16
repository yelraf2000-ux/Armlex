# Changelog

Append-only, chronological. One entry per significant piece of work. This is
the literal history — when in doubt about "what happened when," this file is
the source of truth, not memory or a summary.

Add a new entry at the bottom when you finish a piece of work. Keep entries
short — one or two lines. Detail belongs in `DECISIONS.md`, `GOTCHAS.md`, or
`BENCHMARK.md`; this file just says what happened and when.

---

**2026-08-10** — Milestone 1: repo scaffold, Postgres schema (10 tables, 3
enums, FTS + trigram + HNSW indexes), migrations applied to Neon.

**2026-08-10** — Milestone 2: ARLIS audit script built and run against 23
documents. Corpus discovery (21 tax documents). Found: Tax Code has two live
ids (109017 canonical, 228650 alias — see `DECISIONS.md`); `-Ա`/`-Ն` act
suffix classifier built and control-tested.

**2026-08-10** — Milestone 3: HTML parser (`actPage.ts`) and three chunking
strategies (articles / points / tabular) built and tested against real
snapshots. 9 regression tests added.

**2026-08-10** — Milestone 4: full corpus ingested — 20 documents, 885
chunks, 1 alias registered. `db:verify` at 43/43 checks.

**2026-08-14** — Neon credential rotated twice (once proactively, once after
exposure in a screenshot); `.env` vs `.env.example` confusion resolved —
template is committed and must never carry real values.

**2026-08-14** — Dev tool built: Fastify API + Vite frontend, three modes
(Search / Ask / Chat), `npm run dev` starts both together.

**2026-08-14** — `ANTHROPIC_API_KEY` added; Ask mode verified end-to-end
against the live corpus, including the "no relevant fragments" refusal path.

**2026-08-14** — Chat mode built: query contextualisation (Haiku), session
chunk carry-over (`session_chunks` table), multi-turn grounded generation.
Round-robin carry-over ordering fix (turn-recency ordering was evicting the
opening turn's chunks exactly when a cross-turn conclusion needed them most).

**2026-08-14** — Bug found and fixed: Russian-language system prompts were
biasing generation toward Russian even for Armenian-language questions.
Rewrote both prompts (`ask.ts`, `chat.ts`) in English with an explicit
language-mirroring rule. Verified: Armenian question → Armenian answer, 0
Cyrillic characters in output.

**2026-08-14** — Golden-set v1 (glossary+FTS proposer) built, 90 candidates
proposed for 30 questions. Verification judge run: only 11/30 questions
resolved (86% rejection rate). Root cause diagnosed: the glossary-based
proposer never surfaced the obviously-correct article for several questions
(e.g. missed Հոդված 254 for the turnover-tax threshold question entirely).

**2026-08-14** — Golden-set v2 (title-index LLM proposer) built, replacing
the glossary heuristic. All 30 questions received candidates on first pass.
Re-verification: 23/30 questions resolved, up from 11/30. 2 of the remaining
7 confirmed as a genuine corpus-scope gap (IT-startup incentive law never
ingested).

**2026-08-14** — Embedding generation pipeline built (`generate.ts`):
resumable, disk-cached, provider-agnostic (Gemini + Voyage). Token-aware
splitter with a hard-cap backstop verified never to exceed the model input
limit.

**2026-08-14** — Voyage corpus fully embedded (1,269/1,269 slices) after a
payment method was added to lift the unpaid-tier rate cap (10K TPM → full
speed in ~90s).

**2026-08-14** — Gemini corpus embedding repeatedly throttled; root cause
diagnosed as a **daily** quota (1,000 requests/day), not per-minute as
initial 429 patterns suggested. Calibration attempts burned most of a day's
quota on a job needing ~21 requests. 958/1,269 slices landed before quota
exhaustion; remainder deferred to next daily reset.

**2026-08-14** — Retrieval benchmark run in fair mode (common 638-chunk
universe): FTS 0.0% hit@5, Gemini 91.3%, Voyage 39.1%. **Gemini selected** —
2.3× Voyage, and its 3,072 dimensions require no schema migration.

**2026-08-14** — Diagnosed two live-app bugs from user-reported screenshots:
(1) a natural-language shop-opening question retrieved four irrelevant
articles via FTS, confirming the retrieval-quality problem the benchmark
above was built to fix; (2) transliterated Armenian ("xanut bacel") returns
zero FTS results — a distinct gap not yet on any fix list until this session.

**2026-08-14** — Documentation restructured from one growing
`PROJECT-STATE.md` into six focused files (this changelog included), so a
future session reads only what's relevant instead of one large blob.

**2026-08-14** — Prompt caching added to `chat.ts` (breakpoints on the system
prompt and the last history message; `usage` now returned in the API response
so cache effectiveness is observable). **Measured saving over 4 turns: 6.7%,
not the ~65% predicted.** Root cause of the bad estimate: history was assumed
to dominate the request, but per-turn chunks (~10k tokens, in the volatile
tail after the breakpoint) dominate instead. Per-turn saving does grow with
conversation length (10.8% at turn 3 → 18.7% at turn 4). Kept — net positive
and low risk — but the real lever is moving stable carried chunks above the
breakpoint, which belongs with the Tier 1 retrieval rewiring.

**2026-08-14** — `CLAUDE.md` moved from `Desktop/` into `ArmLex/`. It was
being inherited by six unrelated sibling projects (gymflow, yerevan-chairs,
etc.), injecting the tax-law spec into their context. Added a pointer block at
its top routing to `docs/` and stating that the spec describes intent, not
current reality — specifically that retrieval scores 0.0% and no milestone
should be assumed wired up just because it is specified.

**2026-08-15** — Sub-article (մաս) chunking implemented, measured, and
**reverted**. Size profile improved as predicted (p90 5,795 → 4,100 chars),
but retrieval quality roughly halved with the model held constant
(voyage-3-large: hit@5 34.8% → 17.4%, MRR 0.262 → 0.111). Reverted;
`PART_SPLIT_THRESHOLD` set to Infinity with the implementation and a
regression test retained. Full analysis in `DECISIONS.md`. Two real bugs were
found and fixed along the way: part numbering had to be made monotonic (long
articles contain sub-enumerations restarting at "1.", producing three
separate `Հոդված 341, մաս 1` chunks), and the scorer needed article-level ref
normalisation so part-level and article-level chunking are comparable at all.

**2026-08-15** — Gemini daily quota confirmed reset, but re-exhausted almost
immediately by batch calls. Quota metric is
`EmbedContentRequestsPerDayPerProjectPerModel-FreeTier` (value 1000) —
note `batchEmbedContents` appears to consume quota per *content item*, not
per HTTP request, which is why ~1,000 slices/day is the practical ceiling on
free tier regardless of batching.

**2026-08-15** — **Retrieval wired into the app (milestone 5b).** Migration 003
allows slice-level embedding rows (the old `UNIQUE (article_id, model)` would
have forced averaging slices, changing retrieval behaviour away from the
benchmarked max-pool). Loaded 958 Gemini vectors covering 638/885 chunks.
`verify-hnsw.ts` confirms the HNSW index reproduces brute-force ranking at
**100% top-1 and 100% top-8 agreement** — the shipped path returns what the
benchmark measured. `retrieve()` now bound to `vectorRetriever`.

**2026-08-15** — **Hybrid RRF implemented, measured, NOT shipped.** Same hit
rates as vector-only but materially worse ranking (recall@5 79.7% → 75.4%,
MRR 0.647 → 0.503), because FTS contributes 0% on the Russian golden set while
RRF still credits its top-ranked misses. Kept in the codebase for re-testing
once an Armenian golden set or a reranker exists. Full rationale in
`DECISIONS.md`.

**2026-08-15** — Added a loud warning when the vector leg is unavailable
(missing key, quota, API error). Silent degradation to FTS-only is
indistinguishable from a genuine "no relevant fragments" answer, while
actually meaning retrieval is ~0% — exactly the failure that must not be
quiet. Also split `vectorSearch(queryVector, limit)` out of `vectorRetriever`
so the eval harness can exercise the real pgvector path with cached query
vectors when the embedding provider is rate limited.

**2026-08-15** — **Transliteration + `fact_summary` shipped** (OPEN-ITEMS 6
and 9). The contextualiser now (a) converts Latin-script Armenian to Armenian
script — `"es uzum em pokr xanut bacel"` → `"ես ուզում եմ փոքր խանութ բացել"`,
a query that previously returned exactly 0 results; (b) injects Armenian legal
terms alongside the user's wording, since the corpus is Armenian; and (c)
maintains a running summary of USER-stated facts, persisted to
`sessions.fact_summary` and fed into both the search query and the generation
prompt. Verified over three turns that facts accumulate (shop → +sole
entrepreneur +30M turnover → +2 employees) and that a vague follow-up carries
them into retrieval. Only user-stated facts are recorded — never inferred,
never from the assistant — since a fabricated premise would silently redirect
both retrieval and the answer.

**2026-08-15** — **Verbatim quote validation shipped** (OPEN-ITEMS 11, spec
principle #2). Every quoted Armenian span in an answer is now checked as an
exact substring of the chunk texts actually supplied; unverifiable quotes are
removed and their citation retained, so the reader is still pointed at the real
provision but never shown unverified text as the words of the law. Matching is
exact — only meaning-free differences (whitespace runs, dash and apostrophe
variants) are normalised — because fuzzy matching would wave through precisely
the dangerous case: a quote differing by one digit or a negation is nearly
identical and completely wrong. 11 tests cover verbatim acceptance, whitespace
tolerance, a changed deadline (`20-ը`→`25-ը`), an inserted negation, outright
fabrication, and multi-chunk matching. Test suite now 43 passing.

**2026-08-15** — **Gemini paid tier enabled; corpus fully embedded.**
1269/1269 slices, 885/885 chunks in pgvector (was 638). HNSW still reproduces
brute force at 100% top-1 and top-8.

**2026-08-15** — **CORRECTION: the 91.3% hit@5 was inflated.** It was measured
against a 638-chunk index; at full 885-chunk coverage the same retriever
scores **73.9%**. The extra 247 chunks are additional distractors — a bigger
haystack is genuinely harder. 73.9% is the honest figure for the complete
system. Anyone quoting 91.3% is quoting a partial index.

**2026-08-15** — **`searchTerms` added to the contextualiser — the fix that
made colloquial questions retrievable.** Diagnosis: "rewrite faithfully, never
add facts the user didn't state" and "add Armenian legal vocabulary the user
never used" are conflicting instructions, and the model resolved the conflict
conservatively every time — staying faithful and omitting the terms. So
"ինչ հարկեր պիտի տամ" reached the retriever with no vocabulary shared with
«Շրջանառության հարկ վճարողները», and returned tax-return FORMS and a REPEALED
article. Splitting into two schema fields (faithful `standalone_query` for
display/generation, `search_terms` appended for retrieval only) fixed it
structurally rather than by prompt pressure. Same question, before → after:
`223829 forms, 109017#Հոդված 128 (repealed), 194786` →
`109017#Հոդված 8, 254, 266, 271`. The "I want to open a small shop" case now
produces a correctly cited answer covering general vs special regimes,
turnover tax and micro-business.

**2026-08-15** — **Reranker shipped (milestone 6).** `retrieve()` is now
`vector top-50 → voyage rerank-2.5 → top-N`. Measured on the 23-question
golden set at full corpus coverage:

| Retriever | hit@5 | recall@5 | recall@8 | MRR |
|---|---|---|---|---|
| fts (baseline) | 0.0% | 0.0% | 0.0% | 0.000 |
| vector only | 73.9% | 62.3% | 71.7% | 0.578 |
| hybrid RRF | 78.3% | 64.5% | 71.7% | 0.445 |
| **vector + rerank-2.5** | **87.0%** | **71.7%** | **79.0%** | **0.677** |

Better on every metric, so it ships — the same evidence rule that kept hybrid
RRF switched off. Model chosen by probe on a real article-vs-form pair;
`rerank-2-lite` was rejected outright for ranking the form ABOVE the article.
Pool size chosen by sweep (15 / 30 / 50 / 80 → 50 wins; 80 is worse, the added
noise costs more than the extra recall). Latency of the rerank call alone,
median of 5: **547 ms** for 50 documents — the query-embedding call (~2.5–4 s)
still dominates the pipeline. Degrades to plain vector order on any provider
error, since ordering is an improvement, not a correctness requirement.

Live confirmation on the case that motivated it — the kiosk question that
previously surfaced tax-return FORMS above governing articles:

    vector only : 271, 266, 8, 223829#Հավելված 1 (FORM), 254
    reranked    : 253, 8, 269, 258, 254        (no forms)

**2026-08-15** — **Three defects found by hand-testing the live app**, all in
the generation layer, all fixed and covered by tests (suite 30 → 37).

1. **Answer language was unreliable.** «нужна ли касса в магазине» came back
   with 0 Cyrillic and 1,139 Armenian characters. Root cause: the prompt asked
   the model to *infer* the user's language while the same request carried
   ~34,000 characters of Armenian statute — that mass outweighs a one-line
   instruction. Same failure as the old Russian-prompt bias, with the pressure
   now coming from retrieved text rather than the prompt. Fixed by deciding it
   deterministically: `answer/language.ts` counts scripts and the request
   states `ANSWER LANGUAGE: RUSSIAN|ARMENIAN`. Latin script resolves to
   Armenian on purpose (transliterated questions). Verified 5/5.

2. **The contextualiser translated queries to English.** «ես բուդկա եմ ուզում
   բացել» → `standaloneQuery: "I want to open a kiosk (budka)"`. English is
   neither the corpus language nor the user's, so it helps neither retrieval
   nor generation. The prompt never said what language the rewrite should be
   in. Fixed in the schema description and the system prompt; verified across
   Armenian, Russian and transliterated input.

3. **Quote validation was rejecting valid quotes** — ~1.75 per answer, one of
   them on *every* answer. Three causes, two of them bugs in the validator
   rather than model fabrication:
   - The mandatory disclaimer was wrapped in « » and machine-checked against
     the law, which it can never match. Root cause was our own prompt, which
     *presented* the disclaimer inside guillemets. Both prompts now state that
     quotation marks are reserved for the law.
   - Legitimate elision («X ... Y», both halves verbatim) was rejected.
     Segments now match individually — in order, non-overlapping, each ≥15
     characters so two coincidental short matches cannot be stitched into a
     fabricated claim.
   - Sentence-final punctuation and restored part numbers ("1. ") counted as
     mismatches: the model reproduced Հոդված 8 verbatim and closed it with `.`
     where the corpus has `:`. Trailing punctuation and leading enumerators are
     now relaxed; interior punctuation stays exact. U+0589 ARMENIAN FULL STOP
     is normalised to the ASCII colon ARLIS actually emits.

   Measured: **~1.75 → ~0.4 rejections per answer**, and survivors are genuine
   — e.g. `Ինդիվիդուալ ձեռնարկատերերի` where the Code says `անհատ ձեռնարկատեր`.
   The rejected text is now logged, not just its count: a bare count cannot
   distinguish a correct rejection from a validator bug, and those need
   opposite fixes.

**2026-08-15** — **Latency measured end to end: ~70 s per answer.**
Contextualise 2.4 s, embed 0.7 s, pgvector 3.6 s, rerank 1.0 s (retrieval
subtotal 7.5 s) — and **~62 s of generation**. Retrieval is not the bottleneck;
generation is, driven by ~1,700 output tokens of Armenian at ~1.7 tokens per
character. The fix is streaming (already in the spec, milestone 8), not
optimisation — the answer takes as long as it takes, but the user should not
watch a blank screen for a minute.

**2026-08-15** — Anthropic credit balance exhausted mid-verification;
`/api/chat` returns 502 with `invalid_request_error: credit balance is too
low`. Costing note for future sessions: a chat turn is roughly $0.09 (~20k
input + ~1.7k output, Sonnet-class), so hand-testing one change across 5
queries is ~$0.45.

**2026-08-15** — **`article_refs` populated** (spec pipeline step 4, previously
0 rows). Pure extraction in `ingest/extractRefs.ts` with 16 tests; resolution
and writing in `ingest/buildRefs.ts`, dry-run by default. Patterns were read
off the corpus rather than invented — ordinals vary by final digit (`-ին` after
1, `-րդ` otherwise), article numbers are not integers (402.1 and 402.2 are
distinct articles), and citations come as lists (`52-րդ և 53-րդ`) and ranges
(`407-410-րդ`). Two traps handled explicitly: the chunk's own metadata
breadcrumb (`› ԳԼՈՒԽ 3 › Հոդված 8`) is not a citation, and «սույն հոդվածի 3-րդ
մասով» is a self-reference — excluded by requiring the number to PRECEDE
`հոդված`. Unresolved citations are left unresolved rather than guessed: a wrong
edge drags an unrelated provision into generation looking just as authoritative
as a correct one.

**2026-08-15** — **16 Tax Code articles were missing from the corpus, and are
now recovered.** Found while validating cross-references: 85 citations pointed
at articles that did not exist in the database. ARLIS marks articles having
linked court practice with a ⚖ (U+2696) anchor INSIDE the heading cell, so the
cell reads `⚖Հոդված 2.` and the parser's `^Հոդված` anchor rejected it. Lost:
**2, 4, 102, 103, 104, 105, 109, 238, 328, 330, 333, 335, 342, 343, 398, 408**
— including Հոդված 2, which regulates tax relations. The loss was invisible by
construction: a missing article is indistinguishable from a question the corpus
does not cover.

Parser now finds **474** article headings, not 457. That number is
cross-checked two ways: a raw `Հոդված N` scan of the snapshot finds 463
distinct numbers, all of which parse, plus 11 written with U+2024 dot leaders
that the raw scan cannot see but the parser normalises — 463 + 11 = 474, zero
duplicates. The old test asserting 457 was pinned to the bug; both it and the
chunker test are updated, with a dedicated regression test naming the ⚖
articles. Corpus re-ingested: **885 → 902 chunks**.

Independent confirmation the fix is real: unresolved cross-references fell
**98 → 36** (targets that were "absent from the corpus" now exist), and
`article_refs` grew 696 → **749 edges**.

**2026-08-15** — **Embedding cache was silently serving stale vectors.** The
cache key is `<arlisId>#<ref>` — where a chunk sits, not what it says. Those
come apart on any parser change: fixing the ⚖ bug moved 16 articles' text out
of the chunks that had absorbed it, so those chunks kept the same ref with
different content and the cache happily returned vectors describing text that
no longer existed. Retrieval would still return results; they would just be
quietly wrong. Cache lines now carry a content fingerprint and a changed chunk
is a miss by construction. Entries written before fingerprinting have no hash
and are treated as misses — their provenance cannot be established. Full
re-embed: 1,276 slices, ~2 minutes. HNSW re-verified at 100% top-1 and top-8.

**2026-08-15** — **Reranker re-measured on the 902-chunk corpus** — the numbers
hold. hit@5 87.0%, hit@8 87.0%, recall@5 71.7%, recall@8 79.0%, MRR 0.654
(was 0.677 at 885 chunks; 17 more chunks are 17 more distractors). Vector-only
is 73.9% / 0.599 on the same corpus.

**2026-08-15** — **Streaming shipped, plus the latency work behind it.**
`/api/chat/stream` (SSE) emits four event types: `stage` (progress), `chunks`
(the retrieved articles, as soon as retrieval lands), `delta` (answer text) and
`done` (usage, timings, rejected-quote count). The frontend consumes them and
fills the assistant turn in as they arrive.

Measured warm, before → after:

| | before | after |
|---|---|---|
| first visible feedback | 79s | **0.1s** (stage) |
| articles shown | 79s | **~7s** |
| first answer text | 13.9s | **8.0s** |
| complete answer | 79s | 39–50s |

**Streaming had to be reconciled with verbatim-quote validation**, which
previously sanitised the finished answer. Emitting first and correcting later
was not acceptable — an unverified Armenian quote would be on screen looking
exactly like law. `answer/streamGate.ts` streams everything EXCEPT the inside
of a quotation: text is withheld from the opening `«` until the closing `»`,
then that one quote is checked and either released or replaced with the removal
notice. It calls the same `isVerbatimQuote` the batch path uses, deliberately
not a second implementation — two copies of "is this verbatim" would drift and
the one users see would be the untested one. 12 tests, including that quote
text never appears in output before its closing delimiter, and that an
unterminated quote is checked at flush rather than released.

Three latency findings along the way, two of which corrected earlier guesses:

1. **The HNSW index has never been used.** `DISTINCT ON (a.id) ... ORDER BY
   a.id, dist` forces a full scan and sort — the index cannot help when the
   first sort key is `a.id`. It does not matter: warm, that full scan over
   1,276 vectors takes **231–278ms**, and an index-using rewrite measured
   *slower* (276–341ms) with identical results. Left alone. Worth revisiting
   only if the corpus grows by an order of magnitude. Note this also means
   `verify-hnsw.ts` passing "100% agreement with brute force" was trivially
   true — it *was* brute force.
2. **`retrieve.ts` and `chat.ts` each held their own connection pool.** Two Neon
   connections instead of one, and the warm-up was useless because pinging one
   pool left the other unconnected. Shared pool in `db/pool.ts`: cold db stage
   **4.1s → 0.4s**.
3. **The 3.6s vector search measured earlier was Neon cold start, not query
   cost.** `/api/warm`, called by the UI on load, absorbs it seconds before
   anyone finishes typing. A periodic keep-alive would also work and would burn
   compute hours around the clock to do it.

Also: the contextualiser's system prompt is now cached (identical every turn,
and it sits on the critical path to first token), and the two session reads run
in parallel instead of sequentially.

**3–4s to first text was the target and is not reached.** The floor is ~6.5s of
sequential API calls — contextualise (3.7s) then embed + rerank (2.8s) — before
there is anything to say. Getting under that means taking the contextualiser
off the critical path, which is what makes colloquial questions retrievable at
all, so it needs measuring against the golden set rather than assuming.

**2026-08-15** — **Streaming made to actually read as writing.** Tokens arrive
from the API in uneven bursts — a pause, then a paragraph at once — which
looked like the UI freezing and unfreezing. Deltas now land in a buffer that a
timer drains at a steady rate (proportional to backlog, so it never falls
behind); measured ~62 characters/second on screen against bursty arrival.
Added a blinking caret while text is still coming, a breathing dot and fade-in
on the stage line, and fade-in for the article list. All motion is disabled
under `prefers-reduced-motion`.

**A real bug surfaced while verifying this in the browser:** the pacer was
first written on `requestAnimationFrame`, which does not fire when the tab is
not compositing. The stream completed, the sources appeared — and the answer
rendered **blank**, because the drain loop never ran. Content delivery must not
depend on whether anyone is looking at the page. Now on a timer, with a
guaranteed flush in `finally` so received text is delivered even if the request
throws mid-stream. Verified end to end in the browser: 2,367 characters, caret
cleared on completion, disclaimer intact, 0 removal notices.

**2026-08-15** — **Confidence gate shipped (milestone 7 complete) — but NOT on
reranker scores, which measurement ruled out.**

The spec proposed gating on reranker scores. Calibrated against the golden set
(`eval/calibrate-confidence.ts`), they do not carry the signal:

| | mean top-1 | range |
|---|---|---|
| covered (20) | 0.662 | 0.496 – 0.836 |
| missed (3) | 0.589 | 0.570 – 0.613 |

The distributions overlap almost entirely — ten covered questions score below
the highest-scoring miss — and the optimiser's best threshold degenerates to
0.100, i.e. "always confident", which merely reproduces the 87% base rate.
The cause is structural, not a tuning problem: **a reranker scores topical
relevance, and relevance is not sufficiency.** A VAT form is highly relevant to
a VAT question and contains none of the rule.

The gate therefore uses the spec's other signal — the model's self-report —
because unlike the reranker the model has actually read the fragments. It
declares `COVERAGE: full|partial|none` on the first line, BEFORE writing, so
the verdict is not a rationalisation of an answer it has already committed to.
`answer/coverage.ts` strips that line from the stream (11 tests: split across
deltas, missing header, header-shaped text later in the answer, header-only
response).

Validated on the three questions the golden set proves miss and three it proves
are covered: **6/6 correct** — all misses declared `partial`, all covered
declared `full`, header never leaked. Small sample, and the separation observed
is full-vs-partial rather than reaching `none`; worth re-checking as the golden
set grows.

The UI shows an amber notice for `partial` and red for `none`, and deliberately
nothing for `full` — a badge on every answer trains the reader to ignore it, so
the absence of a warning is the signal.

**Two frontend bugs found by checking in a real browser rather than assuming:**

1. **The animation CSS was never loaded.** It was appended to `index.css`,
   which nothing imports — `main.tsx` imports `styles.css`. Every streaming
   animation shipped inert. `index.css` was dead and is deleted.
2. **Hardcoded light-theme colours.** The app is theme-aware via
   `prefers-color-scheme` and CSS variables; the notice now defines both
   palettes instead of assuming a white background.

**2026-08-15** — **Milestone 8: the workbench.** Five pieces, all verified in a
real browser rather than assumed:

1. **Markdown rendering.** Answers arrive with `**bold**` and lists, and were
   rendering as literal characters — a structured legal answer read as noise.
   `markdown.ts` parses the subset our own prompt produces (bold, bulleted and
   numbered lists, paragraphs); `MarkdownView.tsx` renders it. No dependency:
   the output shape is fixed by our prompt, and unsupported constructs render
   as the literal characters the model wrote — visibly wrong rather than
   silently executed. 13 tests, including that an unclosed `**` stays literal
   and that Armenian text in « » is never reformatted.
2. **Article cards.** The quoted fragment is now marked **in place inside the
   full article**, so the surrounding conditions and exceptions are visible —
   reading a quote alone is the commonest way to be confidently wrong about a
   provision. Plus status ("действует"), the amendment date from the chunk
   header, and the ARLIS deep link.
3. **Related articles.** `/api/related` walks the 749 `article_refs` edges and
   the card lists what an article defers to (e.g. Հոդված 60, 64, 65), fetched
   on first expand rather than on render. Armenian tax law cites constantly, so
   the article a reader lands on is often not the one carrying the rule.
4. **Session list.** `/api/sessions` and `/api/sessions/:id`; past
   conversations are listed by their opening question and can be reopened.
   `fact_summary` lives on the session, so without this the accumulated context
   of a case was unreachable.
5. **Corpus banner.** Real provenance from `/api/corpus` — "20 актов, 902
   фрагментов · сверено с ARLIS 15.08.2026" — replacing a hardcoded string. A
   legal tool that does not say how current it is invites the reader to assume
   it is current.

Two things worth noting from the build. A file named `Markdown.tsx` alongside
`markdown.ts` **collides on Windows**, whose filesystem is case-insensitive —
renamed to `MarkdownView.tsx`. And the browser was left showing stale errors
from failed hot reloads during intermediate edits; the console errors named
symbols that no longer existed, which is misleading unless you force a full
reload before believing them.

Tests now 120 (13 backend-shared + 20 scraper + 74 backend + 13 frontend); the
frontend gained a test script for the parser.

**2026-08-15** — **Milestone 9: update detection.** `npm run crawl` re-fetches
every ingested document, chunks it exactly as ingestion would, and diffs
against the stored chunks — reporting per document `unchanged` / `changed`
(with the specific articles added, removed or modified) / `error`. Writes a
`crawl_log` row per run and exits non-zero on any error so a scheduler surfaces
the failure. Detection only by default: the spec's rule is *serve old data,
never ingest garbage*, and a parser broken by a site redesign would otherwise
overwrite a good corpus with an empty one, unattended, on a schedule.

**First run reported 20/20 documents changed** — precisely the "monitor that
always alarms" failure the file's own header warns about. Cause:
`content_hash_hy` exists in the schema but ingestion never populated it, so
every comparison was against NULL.

The fix was not to populate it. **The baseline is now derived from the stored
chunks themselves.** A "record the baseline on first run" step would have been
worse than the bug: it would stamp the CURRENT page as the baseline, so any
amendment made between ingestion and the first crawl would be silently absorbed
and never reported — a detector that starts by forgetting the thing it exists to
catch. Comparing live chunks against stored chunks has no such blind spot and
needs no migration.

After the fix, against the live site: **19 unchanged, 1 changed** — the Tax
Code, with `Հոդված 79, 86, 128, 189, 194, 271, 384` modified relative to our
snapshot. Article-level detail is what makes this actionable: re-embedding is
keyed by content, so only the chunks that actually moved miss the cache.

Also: a 10-day silence warning (a broken detector reports "nothing changed"
forever, which looks identical to a quiet period in legislation), a zero-chunk
parse treated as an error rather than a repeal, and `docs/CRAWLING.md` with the
Windows Task Scheduler registration.

Two smaller traps recorded: `npm run crawl -- --limit 3` silently swallows
`--limit` as an npm flag and checks the whole corpus (use `npx tsx` for the
limited form), and a `LIMIT` fragment interpolated into a postgres.js template
did nothing at all rather than erroring.

**Not built: discovery of NEW documents.** This finds changes to documents
already in the corpus. Finding newly published acts needs either the ARLIS
search endpoint reverse-engineered (possibly JS-rendered) or sequential id
probing across a shared national id space plus a classifier. Adding a document
remains a manual decision — defensible for a 20-document tax vertical, not for
a second vertical.

**2026-08-15** — **UI pass on the things that got in the way**, all verified in
the browser:

- **Composer is a growing textarea, not a one-line input.** A tax question runs
  several lines (turnover, headcount, activity) and a single line hid most of
  it. Enter sends, Shift+Enter breaks a line, height grows 44→200px then
  scrolls, collapses after sending. Made sticky: an answer runs several screens,
  and the input used to scroll out of reach exactly when the reader wanted to
  ask the follow-up the answer had just prompted.
- **Auto-scroll that follows the stream** and yields when the reader scrolls up.
- **Clickable example questions** in the empty state, spanning the corpus rather
  than flattering it — including a transliterated one, since that is how
  Armenian users type without an Armenian keyboard. They also state the corpus
  boundary: every example is a tax question, because that is all it contains.
- **Segmented mode switcher**, Chat first — it is the product; Search and Ask
  are diagnostics kept because Search shows retrieval with no model in the way.
- User turns given a distinct shape from answers; narrow-screen rules.

**Auto-scroll took two attempts, and the first was wrong in an instructive
way.** It followed only when the viewport was within 160px of the bottom.
Measured: text arrives faster than the effect re-runs, so the gap crossed the
threshold within seconds and following switched off permanently — stuck at
207px with the answer still growing. Distance from the bottom is not the
signal; **deliberate reader intent is**. Now a wheel/touch listener decides, so
a gap that opens on its own never counts as "the reader scrolled away".
Verified: gap held at 0 while text grew 1,223→1,644 chars; scrolling up left
the reader at scrollY 466 undisturbed; returning to the bottom resumed
following.

---

*Next entry goes here — append below this line, don't insert above.*
