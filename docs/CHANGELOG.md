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

**2026-08-17** — **Redesigned for accountants: three-pane workbench.** The UI
was a chat app, and the audience does not work like chat users. An accountant
does not *read* an answer, they *verify* one and then paste conclusion plus
citation into a client memo — so the statute must be on screen beside the
conclusion, not behind a "Источники (4)" toggle that made verification the
expensive step.

- **Persistent norm panel** (`NormPanel.tsx`): the cited provision with the
  quoted fragment marked in place, status, adoption and amendment dates,
  cross-references, ARLIS link, and a copy button that yields quote + citation
  + link together — which is what actually goes into correspondence.
- **Citations replace the sources list.** Each retrieved provision is a chip
  that loads it into the panel; carried-over chunks are styled distinctly, so
  provenance stays visible.
- **Case rail** instead of a hidden session list. Accountants work per client
  and return to a matter; `сессия 9c603654…` is not a unit anyone thinks in.
- **Ledger palette**, taken from the audience's own material world: paper with
  a green-grey bias, ink, hairline rules, verdigris accent, and madder red
  reserved for the one thing red means in a ledger — attention needed.
- **Sylfaen for Armenian legal text.** One of very few widely installed serifs
  with genuine Armenian coverage; statute should look like statute.

One self-inflicted inconsistency caught during verification: the amendment date
was rendered as a red warning chip on *every* article, which is exactly the
misuse of colour the palette was chosen to avoid. Red now appears only for
amendments inside 180 days — a provision changed recently is worth a second
look; a 2017 amendment is just a date, and flagging every article teaches the
reader to ignore the colour that matters.

Verified in the browser at 1500×900: panes resolve to 224 / 831 / 430px,
clicking a citation swaps the panel (`Հոդված 63` → `Հավելված 1, աղյուսակ 6`),
dates parse from the chunk header, and a live answer rendered `Հոդված 229` with
`Ред. 03.07.2026` correctly flagged as recent.

**2026-08-18** — **Answers shortened; the norm panel made the prompt obsolete.**
Since the workbench shows each cited article beside the answer with the quoted
passage highlighted, inline quotation blocks reproduce what is already on
screen — and Armenian is the most expensive text we generate. The prompt now
caps quotations at two, asks for the clause rather than the paragraph, and
targets under 200 words of prose. Measured on the same question, same model:

| | before | after |
|---|---|---|
| total | 36s | **26.3s** |
| characters | 2001 | **900** |
| output tokens | ~1700 | **515** (−70%) |
| invalid quotes | 0 | 0 |

Also fixed the doubled disclaimer (`Са տեղեկատվական…` — both language variants
spliced together, with a Cyrillic С). The prompt listed both and the model
merged them; it now names one line per language explicitly.

**2026-08-18** — **A user-reported failure, diagnosed into three separate
problems.** A question about import deductions under turnover tax produced an
answer riddled with `[quote failed verification]` placeholders and a
self-contradiction. Checked against the corpus:

1. **Retrieval miss (the real bug).** `109017#Հոդված 258` holds the answer —
   the 9.5%-of-documented-expenses rule introduced by ՀՕ-285-Ն — and was not
   retrieved for natural phrasings. Both failing questions pulled the
   profit-tax expense chapter (Հոդված 110–121) instead: a large, dense, very
   on-topic-looking cluster that drowns the single turnover-tax article.
   Retrieval only found 258 when the query already contained "9.5 процентов
   документированных расходов" — i.e. when the asker already knew the answer.
2. **Corpus gap.** SRC order N 1513-Ն is genuinely not ingested (only N 1512-Ն
   is, as arlis 199961). The model knew it from pretraining, cited it, and the
   validator purged it. **That is the guard working correctly** — refusing to
   show a citation we cannot display.
3. **Presentation.** An answer peppered with removal notices is unreadable even
   when every individual removal was right.

**Rejected: fuzzy/semantic citation matching.** It was proposed as the fix and
would break the property that makes this tool worth using. A quote differing by
a negation or one digit is semantically near-identical and legally opposite;
tests cover exactly that (`20-ը`→`25-ը`, inserted negation). In this very
incident the validator was *correct* — semantic matching would have passed a
citation to a document we do not hold. The false positives we have had were
fixed by naming specific meaning-free differences (trailing punctuation,
ellipsis, restored part numbers), taking the rate from ~1.75 to ~0.4 per answer
with exactness intact.

**2026-08-18** — **One-hop expansion through `article_refs` shipped** (spec
pipeline step 3, the remaining half of the cross-reference work). The top 8
vector candidates contribute the provisions they cite; the reranker then judges
the enlarged pool. Outbound edges only — inbound would drag in every provision
referring to a popular article like Հոդված 53. Measured on 25 questions,
pool 50:

| | hit@5 | hit@8 | recall@5 | recall@8 | MRR |
|---|---|---|---|---|---|
| without | 80.0% | 84.0% | 66.0% | 76.7% | 0.609 |
| **with** | **84.0%** | **88.0%** | **70.0%** | **78.7%** | **0.625** |

Better on every metric, so it ships. `EXPAND_ONE_HOP=0` disables it for
measurement.

**Two honest caveats.** First, the win did not come from the questions it was
built for: "Нужно ли платить НДС при импорте товаров?" went MISS → **rank 2**,
while both newly-added questions still fail in the benchmark. Second, and more
important: **`score.ts` embeds the raw question and never runs the
contextualiser**, so it measures a harder task than the app performs. On the
real pipeline — contextualiser terms plus expansion — "Какие расходы
вычитаются при налоге с оборота" now returns `Հոդված 258` at **rank 1**.

The import variant still misses: "импортирую товар" pulls the VAT-import
articles strongly enough to bury the turnover-tax rule. It needs the system to
understand that the stated *regime* overrides the *transaction* signal, which
neither embedding similarity nor the citation graph provides.

**2026-08-18** — **July-2026 Tax Code amendments applied end to end.** The
crawl had been flagging 7 modified articles (Հոդված 79, 86, 128, 189, 194,
271, 384) since the 15th; the corpus was serving the pre-amendment text. Ran
the accept sequence: crawl --apply → ingest → generate (7 cache misses only)
→ load --replace → buildRefs. Verified after: snapshot-vs-DB drift 0,
duplicate slice rows 0, 902/902 chunks covered, 749 edges rebuilt, benchmark
unchanged at 84.0% hit@5.

**A real stale-vector bug surfaced mid-sync.** The vector cache is append-only:
re-embedding a changed chunk appends a fresh line and leaves the superseded one,
both sharing an id. The loader assigned slice indexes by position, so each of
the 7 amended articles ended up with its OLD-text vector attached as an extra
slice — and since retrieval max-pools slices, the withdrawn wording was still
attracting queries. The loader now dedupes by id (last line wins); details in
GOTCHAS.md.

**2026-08-18** — **Second external analysis triaged; two ideas adopted, the
rest already measured or already built.** Verified its claims first: Հոդված
160.1 (tuition income-tax refund) IS in the corpus and retrieval returns it at
**rank 1** for the language-courses question the analysis said fails —
pinned into the golden set (now 26 questions, 84.6% hit@5). Education
licensing law is out of corpus by v1 scope, not by accident.

Adopted:
- **Branch before you ask** (prompt): when an ambiguity has 2–3 enumerable
  readings covered by the fragments, answer each branch instead of stopping
  for a clarifying question; and when the user's stated goal fails on the law
  itself, say that first rather than walking them through a doomed procedure.
- **Graceful degradation** on repeated quote removals: streamed notices stand,
  but ≥2 removals now close with one line pointing at the norm panel, where
  every cited article is shown in full anyway.

Rejected again, same grounds as before: fuzzy/semantic quote matching (a
one-digit difference is legally opposite and ~96% similar), hybrid keyword
search (measured worse, MRR 0.609→0.445), parent-child chunking (measured
worse, hit@5 34.8%→17.4%). Cross-document 1512↔1513 linkage remains blocked on
ingesting N 1513-Ն — a corpus decision, not architecture.

**2026-08-19** — **Two more live head-to-heads against Orin; failures
classified into a three-class taxonomy** (full write-up in `DECISIONS.md`).
The 5.11/5.7 form-row question: we honestly declared «none» but missed
Հոդված 258 and 53, which Orin surfaced — a Class-1 (plane mismatch) loss. The
bakery/micro question: our answer was strong (branch structure, verified
quotes of 270(3) and 269(1), out-of-corpus domains named — the recent prompt
fixes visibly working) but it asked the USER for Հոդված 77's text while the
270→77 edge and the article itself sit in our own database — the purest
Class-2 (named-but-unfetched) specimen yet. Orin took 5+ minutes on that
question, consistent with an unbounded agentic loop.

Also recorded: Orin's claim that 267(5) has been invalidated conflicts with
the consolidated ARLIS text we hold as of 15.08.2026 — flagged for manual
verification, since one of the two systems is materially wrong about standing
law.

Planned order of systemic fixes, each gated on the golden set: cited-slot
guarantee (Class 2 cheap tier) → regime-aware contextualiser (Class 1) →
corpus scope decisions (Class 3: Labour Code, turnover-tax form order,
N 1513-Ն) → bounded case-mode loop (Class 2 general tier).

**2026-08-19** — **First real-traffic measurement: 250 authentic accountant
questions harvested from accountant.am (2026 vintage, robots-permitted, widget
chrome stripped) and triaged through the full pipeline with Flash-Lite.**
Cost ≈ $3. The distribution nobody had until today:

| verdict | share | top driver |
|---|---|---|
| full | **19%** | turnover/micro, ՀԴՄ, VAT — the corpus's home ground |
| partial | **48%** | labour/payroll 23%, turnover 16% |
| none | **33%** | **labour/payroll 40%**, bookkeeping-practice 10% |

Three conclusions with numbers attached:

1. **Labour/payroll is the single biggest lever: ~24% of ALL real questions**
   (61/250) are payroll-driven, and they dominate the failures. The Labour
   Code ingestion decision now has hard demand evidence behind the forecast
   (+10–20pp answerable share).
2. **The fix order was wrong and is corrected by data.** Class-2
   (named-but-unfetched) fired on 1/250 questions — the cited-slot guarantee
   drops to the bottom of the queue. Corpus beats retrieval beats plumbing,
   in that order, by measured frequency.
3. **Հոդված 258 was retrieved for only 17/250 questions** despite being the
   rate table for the most common regime in the traffic — consistent with its
   three known misses. The Class-1 fix keeps its priority, now with a
   distribution behind it.

Also: invalid quotes 11% (Flash-Lite's act-title-in-guillemets habit, matches
the earlier A/B), zero parse/header failures across 250 — the pipeline held.

The honest reading of 19%: the golden set (85.2% hit@5) measures questions the
corpus CAN answer; real traffic includes everything accountants actually face.
Both numbers are true. The gap between them is the roadmap, now quantified.

**2026-08-19** — **The Class-1 mechanism found and fixed: enumeration-aware
indexing, then the reranker taught to read the matched item.** Shipped after
the largest measured retrieval gain since the reranker.

The diagnosis, from one worked case (a VAT-registered company selling a used
electric car): the governing rule is in Հոդված 64 — 26,404 characters, the VAT
exemptions list — indexed as **8 vectors averaging ~3,300 characters of
unrelated exemptions each**. A question about one exemption matches that blur
weakly. Same mechanism for 258 (rate table, 3 vectors), 254 (5), 267 (4):
every Class-1 failure collected — import deduction, 5.11/5.7 carry-forward, IT
benefits, electric car — targets an enumeration article.

**Fix 1 — one vector per enumerated item** (`embed/split.ts`, policy `enum`).
Parts, points and table rows become separate vectors, each carrying the
metadata header, the governing lead-in («2. ԱԱՀ-ից ազատվում են…») and, for
table rows, the column header — all resolving to the parent chunk, so
generation still receives the whole article. This is NOT the sub-article
chunking rejected on 2026-08-15, which made parts separate retrievable chunks.
1,276 → 5,139 vectors; 214 articles expanded; 64 → 61 vectors, 258 → 23.
Vector-only A/B on the golden set: **hit@5 66.7% → 81.5%, better on every
metric.**

**Fix 2 — and the surprise.** End to end, the reranker gave most of it back
(hit@5 flat at 85.2%, MRR 0.653 → 0.632). Cause: `rerank.ts` showed each
candidate as its first 1,800 characters — the header plus exemption №1; row 8 of
a rate table sits 20,000 characters later, invisible. Showing the matched slice
alone over-corrected (hit@8 92.6% but MRR 0.564 — terse table rows lost to rich
prose openings; per question 6 better, 10 worse). Showing **prefix + matched
slice** removed the asymmetry:

| live, 27 questions | hit@5 | hit@8 | recall@5 | recall@8 | MRR |
|---|---|---|---|---|---|
| before (token index, prefix rerank) | 85.2% | 88.9% | 72.2% | 80.2% | 0.653 |
| **after (enum index, prefix+slice rerank)** | **88.9%** | **92.6%** | **75.9%** | **87.0%** | **0.681** |

Per question: 3 improved (one MISS → 1, two 2 → 1 — all enumeration
articles), 7 slipped by 1–2 ranks, 17 unchanged. The aggregate gain is carried
by structural wins on exactly the targeted articles; the slips are within noise
at n=27.

Also in this pass: `load.ts` batched (a 5,139-row load took 1m14s instead of a
projected ~35 min of one-round-trip-per-row inserts, during which retrieval was
degraded); a `verify-hnsw` FAIL traced to comparing the database against a
stale on-disk file, not to the index (34/34 top-1 once the files agreed);
superseded vector caches archived so the scorer stops brute-forcing them.

**2026-08-19** — **Real-traffic re-measurement on the new index: 250 authentic
questions, same Flash-Lite triage as the morning baseline.**

| coverage | morning | now |
|---|---|---|
| full | 19% | **31%** |
| partial | 48% | 40% |
| none | 33% | **29%** |

57 questions improved, 24 worsened, 169 unchanged. The deterministic signal —
how often retrieval reaches the enumeration articles the fix targeted —
confirms the mechanism: Հոդված 254 reached 12 → **28** questions, Հոդված 64
1 → **8**, Հոդված 258 17 → 22. First live sign, two questions into the run:
«ՏՏ ոլորտում գործունեությունը կարո՞ղ է օգտվել արտոնությունից» went none →
partial, the IT-benefits case the whole investigation started from.

**The 24 regressions, classified rather than counted.** 12 labour/payroll and
3 bookkeeping — out-of-corpus questions where the model's none-vs-partial call
on adjacent material is judgment, not retrieval. Of the 9 tax-proper, several
have identical or merely reordered retrieval (car leasing, Wildberries, border
village) — verdict variance. **Measured noise floor: 5 of 81 verdict flips
occurred on byte-identical retrieval.** That leaves ~4 genuine retrieval
regressions worth pinning once their expected articles are verified: IT
benefits (254 dropped out of the top 4), ՀԴՄ acquisition deduction, passenger
transport, RF-import reporting.

Honest framing of the metric: Flash-Lite verdicts vary run to run, so the
coverage shares carry a few points of noise; the reach counts and the golden
set are the deterministic evidence, and they agree with the direction.
`eval/triage-diff.ts` added to make this comparison a one-liner.

**2026-08-23** — **Labour Code ingested (arlis 51) — the tax-vertical boundary
crossed deliberately, on demand evidence.** 288 articles + 8 annexes, act
ՀՕ-124-Ն, parsed by the existing pipeline with no parser work: p50 1,111 chars,
p90 2,716, max 6,347 (far healthier than the Tax Code's 33,627), the one table
intact. Corpus is now **21 documents, 1,190 chunks, 5,639 vectors, 100%
coverage**; `article_refs` rebuilt at **891 edges** (was 749 — the extra are the
Labour Code's internal citations).

**Tax retrieval cost: zero.** Same index, same day, before and after:

| | before | after |
|---|---|---|
| hit@5 / hit@8 | 88.9% / 92.6% | **88.9% / 92.6%** |
| recall@5 / recall@8 | 75.9% / 87.0% | **75.9% / 87.0%** |
| MRR | 0.681 | **0.681** |

Not one metric moved. The 638→885 precedent (91.3% → 73.9%) did **not** repeat:
those chunks were tax forms and orders competing directly with tax questions,
while labour law sits far away in embedding space. Distractors cost recall when
they are near-misses, not when they are distant.

Retrieval on the motivating question (wage delay, from the 250-question real
set) now returns `Հոդված 130` at **rank 1** (0.809), plus 129, 198 and 112 in
the top 8 — four of the five articles both the competitor and the accountants
on accountant.am cited. Rerank scores 0.70–0.81, against 0.45–0.47 typical for
tax questions. That question previously returned a correct-but-useless refusal.
Closes `OPEN-ITEMS.md` 19a.

**2026-08-23** — **Live outage, self-inflicted: `npm run ingest -- --dry-run
--only 51` was neither dry nor scoped.** Root cause is npm, not the script.
Root `npm run ingest` is itself `npm run ingest -w @armlex/backend`, so flags
after `--` are appended to the INNER npm command with no second `--`; npm claims
both `--dry-run` and `--only` as its own options and never forwards them to tsx.
The script saw an empty argv, so `DRY_RUN` was false and `ONLY` undefined: a
full re-ingest of all 21 documents, replacing every `articles` row and
cascade-deleting **all 5,139 embeddings and the whole `article_refs` graph**.
Render shares the Neon database, so the live site's vector leg was down until
the disk cache was reloaded. Bare positionals DO survive the double hop
(`npm run audit -- 51` works) — only option-shaped flags are eaten.

Recovery cost no API calls: `data/vectors/*.jsonl` is keyed by
`<arlisId>#<ref>`, not database id, so cached vectors remap onto freshly
ingested rows. `load.ts --replace` → 5,139 restored; `buildRefs.ts --apply` →
graph rebuilt; golden set back to 88.9 / 92.6 / 87.0 / 0.681 exactly.

**A phantom finding to disregard if it appears in any earlier note:** a
benchmark running while the tables were being rewritten reported
`vector + rerank-2.5` at **51.9%** and was briefly read as a reranker
regression. It was the index disappearing mid-run. The reranker never regressed.

**Fix: `ingest/run.ts` now writes only with `--apply`** (matching
`buildRefs.ts`), so a swallowed flag means *do nothing* rather than *rewrite
production*. `--only` → `--doc`, since npm claims `--only`; the old spelling
still resolves. The header line now names mode **and scope**
(`REPORT ONLY · ALL documents · 22 document(s)`) — the missing signal, since the
request was for one act. Regression-tested: the original command is now inert
and the database is verifiably unchanged after it. `crawl/run.ts` was already
`--apply`-gated and was never at risk.

**Two gaps this exposed, both still open:** `score.ts` renders an empty vector
index as a plausible `0.0%` result table — indistinguishable from the genuine
FTS number, and it cost real time chasing the phantom above; `retrieve.ts` has
exactly this guard for the API path ("degrading must never be silent") and the
eval harness has no equivalent for the database path. And every npm script
taking option flags shares the swallowing trap; `reembed.ts` is untraced.

---

*Next entry goes here — append below this line, don't insert above.*

**2026-08-24** — **Real-traffic re-measurement after tiers 1 and 3: the largest
single-day move the project has recorded.** 250 authentic accountant questions,
same Flash-Lite triage as every prior baseline.

| coverage | 2026-08-19 | 2026-08-23 | **now** |
|---|---|---|---|
| full | 31% | 29% | **47%** |
| partial | 40% | 47% | 38% |
| none | 29% | 24% | **14%** |

**Improved 80, worsened 25, unchanged 145** — a 3:1 ratio against a measured
noise floor of ~6% on verdict flips, so the direction is real even if the
decimals are not.

**`names unretrieved article` fell to 1 of 250 (0%)** — the Class-2 smell, the
model naming a provision it needed but did not have. It was the motivating case
for the cited-slot guarantee and is now essentially eliminated.

What produced it, in the order shipped: corpus 20 → 33 documents; part-level
extraction with `FRESH_LIMIT` 4 → 8; the tie-aware cut; guaranteed vector slots;
same-article cross-reference following; `temperature: 0` on the contextualiser;
rule 3a (no invented numbers); `[…]` redaction; rule 7a (ask only for user
facts); and the cited-slot guarantee.

**Unchanged: the invalid-quote rate, 11% → 11%.** Nothing shipped today touched
how the model quotes, and it shows. These are FLASH-LITE's quotes — the triage
generates with `gemini-3.5-flash-lite`, not the Sonnet the app runs — so this
figure is simultaneously the real-traffic scorecard AND the cheap-model arm of
the generation-model comparison. Flash-Lite reaching 47% full on real questions
makes the model-swap case stronger than it looked; its quote fidelity remains
the open question, and invalid quotes are stripped by the validator rather than
shown, so the cost is thinner answers, not false ones.

**25 questions worsened** and are not yet triaged; some are verdict noise (the
floor is 5 of 81 flips on byte-identical retrieval), some are likely real. Worth
classifying before the next retrieval change, not after.

---

**2026-08-25** — **The 22 hand-test questions are pinned to a file**
(`data/eval/handtest-22.md`, generated by `eval/handtest-sheet.ts`). Step 1 was
specified as a recipe — 10 `full`, 6 worsened, 6 `none` — which is not a set:
two sessions would test different questions and no result could be attributed
to a question afterwards, the same defect that lost wave 2's regression
(`OPEN-ITEMS` 29). Selection is deterministic; the sheet carries the question
text, the triage verdict and the DELIVERED article refs, which is what bucket C
needs, since "is this a corpus gap or a delivery failure" is answerable only
against the refs. Baseline `triage-results-preTier1.jsonl` (80 improved / 25
worsened / 145 unchanged).

**2026-08-25** — **Mechanical validation of cited NUMBERS
(`answer/validateNumbers.ts`), report-only.** The prerequisite `PROJECT-STATE`
step 3 names before any cheap-model switch. Quotes have been checked since
2026-08-15; numbers were guarded only by prompt rule 3a, and every wrong line
number this project has produced — `8.8`, `9.1`, `9.2` — arrived inside a
well-formed, correctly-cited answer, which is the shape a prompt rule cannot
catch. 20 tests. Wired into `chat.ts` as a log only: nothing is rewritten.

Scope is EVERY number, not a vocabulary of legal labels — a label the file
forgot to list would be a number nobody checks, and anything present in the
fragments passes anyway, so prose numbers are exempt by construction.

**The firing count could not tell a working guard from a vacuous one.** Forty
questions gave zero firings, which is what both look like. `number-guard-power.ts`
settles it by perturbing every number in every real answer into a false one of
the same shape, in its own sentence, and asking whether the guard catches it:

| shape | power | note |
|---|---|---|
| hierarchical ref (`9.2`) | **100%** | the documented failure mode |
| 3–4 digit integer | **100%** | article and act numbers |
| grouped amount | **100%** | thresholds |
| 2-digit integer | 91% | |
| 1-digit integer | 21% | a bare `5` is in 30k chars of statute always |

One-digit numbers are where tax RATES live, and they are essentially
unprotectable by digit matching alone. Enforcing rule 3a's own second clause —
the number must appear "attached to that exact meaning" — is what lifted the
2-digit class from 58% to 91%.

**Five false-positive classes were found by measurement and fixed; none was
predicted.** The firing rate on real answers went 21 → 8 → 3 → **2 in 39
answers** while power held at ~65%:

1. **The law never says «մաս 13»** — it writes part 13 as a bare `13.` at the
   start of a line. Requiring the word made every part and point citation
   unverifiable by construction: 21 of 21 firings, all false.
2. **Armenian labels from the right** («209-րդ հոդվածը»), Russian from the left
   («Հոդված 258»). Preferring one side mislabelled the other language's
   citations, and `՝` (U+055D) was missing from the clause boundaries, so a
   marker bled in from the previous sentence and outranked the adjacent one.
3. **An enumeration carries ONE label for all its members** — «5.10, 6.10, 8.8,
   9.10 տողերը», «71-րդ, 72-րդ, 73-րդ հոդվածներ». Only the last member could see
   it until sibling members were consumed first.
4. **A word-based `act` family hijacked every amount**, because nearly every
   legal claim ends in a citation parenthesis: «115 միլիոն դրամը (ՀՀ
   ՕՐԵՆՍԳԻՐՔ…)» had its threshold labelled an act number. Act numbers are
   recognised by their `N …-Ն` form instead, as percentages are by adjacency.
5. **A percentage is the number the marker is stuck to.** A windowed rule read
   «5% (որը կազմում է 10 000 դրամ)» and labelled the computed SUM a rate.

Also fixed: an article number is sourced by the fact that we RETRIEVED that
article, and frequently does not appear in the article's own body text; and act
numbers live on the document, in neither the chunk text nor its ref.

The two surviving firings are both defensible — `5.7` is the known
turnover-tax-line case (`OPEN-ITEMS` 34), and «Հոդված 56-րդ մաս 2-ի» is a
garbled citation the guard reads literally. **Zero false positives on
well-formed answers in the sample.**

**`triage.ts` now stores the answer text AND the fragment text generation read**
(`--out <name>` redirects both files so a sample never disturbs the
250-question baseline). Storing metadata alone was a false economy: the first
question asked of it needed the text and had to pay for a fresh run. Re-fetching
by ref gets `text_hy`, which is NOT the part-reduced text the model was given —
an early version of the power harness did exactly that and reported the
label-scoped guard as no better than the unscoped one, having silently removed
the labels first.

**2026-08-25** — **INCIDENT: the live site appeared to lose all its data. It had
not.** The Gemini embedding prepayment balance emptied. Every query's vector leg
returned `HTTP 429 RESOURCE_EXHAUSTED`, retrieval degraded to FTS-only, FTS
returned nothing, and generation — correctly, from empty fragments — told a user
asking about EV charging stations and the 7% turnover-tax rate that **no norm
covering the question exists**, listing the Tax Code chapters it would have
needed. Corpus verified intact throughout: 33 / 1,737 / 6,992 / 1,100.

Two things are worth keeping from it. **429 does not mean rate limit** — the body
said "prepayment credits are depleted", which no amount of backoff fixes; that
is the third provider in this project to disguise running out of money as
something else. And **the console warning built for exactly this case did not
help.** `warnVectorUnavailable` fired as designed; the log was not being watched
and the request went on to answer anyway.

Fixed: `retrieve` now throws `VectorLegUnavailableError` rather than returning an
empty result, and `/api/chat/stream` sends `search_unavailable` with text saying
the search is down and that this does NOT mean no norm exists. 3 tests. An empty
result because nothing matched and an empty result because we could not search
must never reach generation as the same thing — the second is an outage, and an
outage phrased as a legal conclusion is worse than a visible error, because a
negative answer is actionable.

Also added `eval/probe-question.ts`: runs one question through the live path and
prints `needsRetrieval`, the rewritten query and the ranked chunks. "It cannot
find anything" has four causes that look identical in the UI — empty index,
`needsRetrieval: false`, retrieval returning nothing, retrieval returning the
wrong things — and this separates them in one call.

**2026-08-25** — **A number for the project's oldest defect: `answer-coverage.ts`.**
The golden set scores retrieval and is structurally blind to "we retrieved it,
we sent it, the answer ignored it". The EV-charging question proved the point —
`Հոդված 258` at rank 1, the calculation table at rank 2, a perfect retrieval
score, and an answer that dropped the 3% deduction floor and the fixed-asset
exclusion that decides the question.

Each required provision is now classified `NOT DELIVERED` / `DELIVERED, USED` /
`DELIVERED, UNUSED` against hand-pinned markers in
`data/eval/required-provisions.jsonl`. First baseline, 2 questions / 6
provisions, `claude-sonnet-5`:

    NOT DELIVERED       1 (17%)
    DELIVERED, USED     3 (50%)
    DELIVERED, UNUSED   2 (33%)
    -> of provisions DELIVERED, 60% were used

It reproduces both documented cases exactly: Q36's row 20 is NOT DELIVERED
(rank 11, `OPEN-ITEMS` 26) and its `կետ 63` is DELIVERED, UNUSED (`OPEN-ITEMS`
34). That agreement is the reason to trust the instrument.

**Treat 60% as a first reading, not a figure.** Six provisions is a tiny base,
and the 3% floor was USED on this run while the live answer that prompted the
work missed it — so there is run-to-run variance of at least one provision.
Markers are deliberately generous, which biases toward USED and therefore
UNDERSTATES the defect.

The EV question is also pinned into `golden_verified.csv` (backup:
`golden_verified.pre-ev.bak`) as a retrieval guard — though note it will score
100% there, which is exactly why the new instrument had to exist.

**2026-08-25 (correction, same day)** — **The instrument above was wrong on its
first run, and the corrected reading inverts the conclusion.**

`answer-coverage.ts` judged delivery by asking whether the CHUNK appeared in the
retrieved list. `Հոդված 258` was at rank 1, so all four of its provisions
counted as delivered, and the two the answer omitted were scored
`DELIVERED, UNUSED` — the model's fault. Then the delivered text was checked:

    Հոդված 258   stored 8,134 chars -> DELIVERED 1,672 chars
      part 1 table row 4 (7% rate)      in window: YES
      part 3, the 3% floor              in window: NO
      part 6(2), fixed assets excluded  in window: NO

Both provisions were cut out by `generationDocument`. The tool built to catch
"the model was right, the context was wrong" made exactly that mistake, on its
first case, for the same reason the number-guard harness did: it measured
against a haystack the model never saw.

Corrected, judging delivery on the reduced text at PROVISION granularity:

    NOT DELIVERED       3 (50%)
    DELIVERED, USED     3 (50%)
    DELIVERED, UNUSED   0 (0%)
    -> of provisions DELIVERED, 100% were used
    -> 27% and 33% of retrieved characters reached the model

**The model uses what it is given. The bottleneck is context assembly**, sitting
downstream of a retrieval leg that had already put the right article at rank 1.
`OPEN-ITEMS` 42 is rewritten accordingly: the candidate fixes aimed at the
prompt are the wrong target.

Incidental: Q36's row 20 now comes back DELIVERED and USED, where `OPEN-ITEMS`
26 records it at rerank rank 11 and undelivered. Worth confirming separately —
if real, the tie-aware cut or guaranteed vector slots fixed it.

**2026-09-04** — **User accounts replace the shared password.** Registration by
email + password (scrypt, `node:crypto`, no native dependency) or Google
sign-in; per-user conversation isolation; conversations shareable by link.
Migration 004. 16 tests.

**The part that is easy to get wrong, and the reason this is one change and not
two: the shared gate was never a privacy control, it was a SPENDING control.**
Every answer costs ~$0.10 of API credit, and opening registration removes the
only thing standing between a crawler and the balance. So a per-plan monthly
allowance (free 5 / pro 50 / firm 150) ships in the same commit, checked before
any provider is called. Usage is COUNTED from `messages` rather than tracked in
a counter column, so it cannot drift from what actually happened.

Verified end to end against a running server, not just by unit test:
registration → signed in → allowance falls 5/5 to 4/5 after one question → the
conversation appears in the owner's list. Then the assertions that matter:

    a second account sees                     0 sessions
    reading the first user's conversation     404
    sharing the first user's conversation     404
    a shared link, read with no account       200, messages only
    the same link after revoke                404

404 rather than 403 throughout: a distinguishable "exists but not yours" turns
the route into an oracle for which session ids are real. The share response
carries `createdAt` and `messages` and nothing about the owner.

**The 204 pre-account conversations are kept, not migrated.** `sessions.user_id`
is nullable and they match nobody, so they are invisible in the app and still
readable through `eval/review.ts` — which is the right outcome for both, since
they are the only record of how the tool behaved before this change.

Google sign-in is DORMANT until `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
`PUBLIC_ORIGIN` are set: the button does not render and the routes 404, so
nothing waited on a Google Cloud project. Matching is by email first, then
subject id, so signing in with Google on an address that already registered with
a password lands in the existing account rather than a second empty one that
looks like data loss.

Two implementation notes worth keeping. `gen_random_bytes` is pgcrypto, which
this database does not carry — share tokens are minted with `node:crypto`
instead, and a link's unguessability should not depend on which extensions a
host installs. And scrypt at N=32768 needs `maxmem` raised explicitly, or Node
rejects it with "Invalid scrypt params", which reads like a bad call rather than
a memory ceiling.

**2026-09-04** — **Sharing made findable, and the recipient's page built.**
Two defects in the sharing shipped hours earlier, both found by the owner
trying to use it.

**The control was invisible.** It was an unlabelled icon revealed by hovering a
row in the sidebar list; the first person to look for it could not find it. Now
it is a NAMED button on the first question of the conversation it acts on —
«Կիսվել», becoming «Հղումը պատճենվեց» once issued. The general rule: a control
discovered by hovering is a control most people never discover.

**A shared link returned raw JSON.** The API served `/api/shared/:token` and
nothing rendered it, so the recipient — the whole point of the feature — got a
wall of escaped text. `Shared.tsx` renders the exchange read-only, checked
BEFORE the sign-in gate since a recipient by definition may have no account.

Deliberately not the workbench with its controls removed: no composer, no
session list, no norm panel. A recipient did not come to use a tool, they came
to read something their accountant sent them, so what they get is the exchange,
the disclaimer, and one honest way in if they want to ask their own question. A
withdrawn link and a mistyped one give the same message, because the server must
not confirm that a token was ever real.

Verified signed OUT entirely: the page renders, `/api/auth/me` reports nobody,
and the shared endpoint returns the two messages.

**2026-09-04** — **The landing page is now a question box, not a sign-in form.**
A visitor with no account asks a real question, gets a real answer to the first
part of it, and registers to see the rest. Migration 005, 9 tests.

Why this shape: a description of "grounded answers with verbatim citations"
persuades nobody who has not watched it happen to their own question. The old
landing page asked strangers to create an account before showing them anything.

**Three rules keep it a gate rather than a bait.** The visible part is a true
answer generated from retrieved law, not a hook written to make the hidden half
look valuable — it is literally the opening of the answer, and a test asserts
the shown text is a prefix of the real one. What is withheld is the APPARATUS:
the articles, the quotes, the application. And the blur is DRAWN, not a CSS
filter over real text — a filter leaves the withheld answer in the DOM for
anyone who opens the inspector, which would make the prompt a lie. Verified in
the browser: 0 characters inside the blurred element, no withheld content
anywhere in the page.

**Generated with the cheap model, and the endpoint carries its own protections.**
`/api/preview` is the one route anybody on the internet can call, which is the
exact hazard the shared password used to cover: at ~$0.012 a preview, an
unthrottled endpoint is ~$12 per thousand requests to whoever holds the keys. So
a per-address daily limit (4), a 2,000-character cap on the question, and
Flash-Lite rather than Sonnet. `trustProxy` is now on, without which Render's
proxy makes every visitor share one rate-limit bucket and the fifth person of
the day is blocked. The limiter is in memory — **if this ever runs on more than
one instance the limit becomes per-instance and must move to the database**;
that failure is silent, since the endpoint keeps working and simply costs N
times more.

**The question survives the signup.** It is held in `sessionStorage` and asked
again properly the moment the account exists — verified end to end. Making
someone retype the question they just asked charges them twice for the same
thing, at the exact moment the product is proving it kept its promise.

`previews` also records what was asked and whether it converted. That table is
the only record of what people ask BEFORE committing — every other question in
the database came from someone who had already decided to sign up — and it is
worth more to the marketing than to the product.

Two bugs found by testing rather than reasoning. `splitAnswer` cut mid-word on
short answers: the guard required the boundary to be at or past `MIN_SHOWN`,
but `MIN_SHOWN` is also the floor for the target, so when they were equal no
boundary could ever qualify and it fell through to a raw slice. It now picks
whichever clean stop is CLOSEST to the target, in either direction — searching
only backwards landed a whole paragraph short. And the clipboard fallback used
`window.prompt`, which is blocked outright in embedded contexts and threw,
making a refused clipboard look like a broken button; the link is now rendered
inline and selectable, so copying is a convenience rather than the mechanism.
