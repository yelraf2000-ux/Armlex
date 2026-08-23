# Gotchas — hard-won, do not re-derive

Technical traps discovered by running things, not by reading docs. If you're
about to touch a related area, read that section first — each one cost real
time once already.

## ARLIS (HTML parsing — `scraper/src/parse/actPage.ts`)

- **Act numbers are positional, not the first match.** Decisions/orders print
  their own number in the header (`N 155-Ն`); laws print theirs at the foot
  (`ՀՕ-195`). A law's header often carries an *amendment* reference instead
  (`օրենքը խմբ. … ՀՕ-5-Ն`) — taking the first regex match in either case gets
  the wrong number.
- **Dates come in both orders.** Laws: `2016 թվականի հոկտեմբերի 4-ին` (year
  first). Decisions: `1 փետրվարի 2024 թվականի` (day first). Take whichever
  pattern matches **earliest in the text**, not a fixed preference — a
  decision's body contains both its adoption date and its *effective* date,
  and preferring one pattern silently grabs the wrong one.
- **Only codes/laws use `Հոդված` (articles).** Decisions and orders use
  numbered points (`կետ`) plus annexes; one law (178425) is a bare table with
  neither. `ActPage.structure` (`articles | points | tabular | unknown`)
  exists because of this — chunking must branch on it.
- **Annex headings live inside single-row layout tables**, not `<p>` tags.
  Classifying only inside the paragraph branch silently demotes every
  table-wrapped annex heading to body text.
- **The Tax Code has two live ARLIS ids: 109017 and 228650.** Both serve
  byte-identical `/latest` content. **109017 is canonical** — its bare
  (non-`/latest`) version differs from `/latest`, meaning it's the original
  record `/latest` advances from. 228650's bare version *is* `/latest` — a
  consolidation snapshot the next amendment supersedes with a new id.
  228650 is registered as an alias, not ingested separately.

## Postgres full-text search

- **The `simple` config does no Armenian stemming.** `հարկ` and `հարկի` are
  different lexemes to it. A query for one will not match the other.
- **`websearch_to_tsquery` / `to_tsquery` with `&` ANDs every term.** One
  conversational word in a natural question (`ինչ`, `կասես`) drives the whole
  query to zero hits. `retrieve.ts`'s `ftsRetriever` runs a strict AND pass
  first, then falls back to OR-ranked only if that returns nothing.
- **`ts_rank_cd` needs normalisation flag `2`**, or document length dominates
  ranking. Without it, article 108 (43,369 chars — the single longest chunk in
  the corpus) won top-hit for multiple unrelated questions simply by
  containing more of every term.

## JavaScript / tooling

- **`\b` is ASCII-only.** A regex `\b` placed right after an Armenian letter
  never matches, because Armenian letters aren't ASCII word characters. This
  silently made the `-Ա`/`-Ն` act classifier treat every individual (`-Ա`)
  act as RAG-eligible — caught only by adding `-Ա` control documents to the
  audit and checking the classifier actually rejected them.
- **U+2024 (`․`, ONE DOT LEADER) appears as a visual dot** in some article
  numbers on ARLIS pages. Naively normalizing or stripping it lost 3 real
  articles during parsing.
- **Git Bash's `curl` computes `Content-Length` in characters, not UTF-8
  bytes.** Any request body with Armenian or Russian text gets a length
  mismatch and the server rejects it. Use Node's `fetch` or PowerShell's
  `Invoke-RestMethod` for manual testing with non-ASCII payloads.
- **Vite's dev server binds IPv6 `::1` by default.** Probing
  `http://127.0.0.1:PORT` from a script gets `ECONNREFUSED` even though the
  server is actually up — use `localhost`, not the literal IPv4 address.
- **Heredoc-based `python`/`sed` file patches fail silently on CRLF-containing
  files** in this environment — the replacement string doesn't match and the
  script exits 0 having changed nothing. Use the Edit tool instead of shell
  heredocs for patching source files.
- **`output_config.format.schema` (Anthropic structured outputs) rejects
  `maxItems`** on array-type schema properties — 400 `invalid_request_error`.
  Cap array length via the prompt instructions instead.

## Prompting

- **A Russian-language system prompt measurably biases answers toward Russian
  even for Armenian questions** — the prompt's own language outweighs an
  explicit "answer in the user's language" instruction inside it. Fix: write
  system prompts in a neutral third language (English here) with an explicit,
  separate language-mirroring rule. Verified before/after: Armenian question →
  Armenian answer (0 Cyrillic characters) only after the rewrite.

## Provider APIs

- **Gemini's free-tier embedding quota is 1,000 requests/DAY**
  (`EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier`), not a
  per-minute limit as the 429 backoff pattern suggests. Retries **count
  against the daily quota** — four calibration runs with retry storms burned
  nearly the entire daily allowance on a job that needs ~21 requests. A
  single isolated probe request can succeed (200) even while the account is
  quota-exhausted for sustained traffic — don't use one successful probe as
  evidence the throttle lifted.
- **Voyage's unpaid tier is 10K TPM / 3 RPM** — a full 885-chunk corpus embed
  would take ~10 hours. Adding a payment method (billed against the existing
  200M free-token allowance, not a new charge) lifted this instantly —
  verified: full corpus in ~90 seconds afterward.
- **Both Gemini and Voyage return unit-normalised embedding vectors** — cosine
  similarity reduces to a plain dot product, no need to normalize before
  comparing.

## A prompt instruction loses to the bulk of the context

Two separate bugs, same mechanism. First: a Russian-language system prompt
biased answers toward Russian even for Armenian questions. Later, after that
was fixed: a Russian question came back entirely in Armenian, because the
request carried ~34,000 characters of Armenian statute and the retrieved text
outweighed the "answer in the user's language" rule.

The lesson is not "write a stronger instruction". Anything the surrounding
context can drown out should be **computed, not inferred** — `answer/language.ts`
counts scripts and states the answer language as a fact in the request. Reach
for a deterministic function whenever a rule must hold against the weight of
the context, not just alongside it.

## A guard that fires on valid input teaches users to ignore it

Verbatim quote validation was rejecting ~1.75 quotes per answer, and one of
those fired on *every* answer — the mandatory disclaimer, which the model
wrapped in « » because our own prompt presented it that way. A reader who sees
"this quote could not be verified" under a correct quote in every single answer
learns the notice means nothing, which is precisely when the guard stops
protecting anyone.

When a safety check fires, log **what** it rejected, not just how many. A count
cannot distinguish a fabricated quote (guard working) from a reformatted one
(bug in the guard), and those need opposite fixes. Both were present here.

## Never pace content delivery on requestAnimationFrame

The streaming answer was smoothed by draining a buffer inside a `rAF` loop.
rAF does not fire while a tab is hidden or otherwise not compositing, so the
pacer stalled with text already received and the answer rendered **completely
blank** — the stream had finished, the articles were listed, and the answer was
empty. Caught in the browser, not in tests.

Use a timer for anything that delivers content: timers are throttled in
background tabs rather than stopped. And always flush the remaining buffer when
the stream ends, in `finally`, so received text can never be withheld because
an animation was mid-flight or a request threw.

## Anthropic credit exhaustion surfaces as a 400, not a 402

`{"type":"invalid_request_error","message":"Your credit balance is too low..."}`
arrives as HTTP 400 and is re-raised by the app as a 502 "chat failed". It reads
like a request-shape bug. Check the balance before debugging the payload.

Budget for hand-testing: one chat turn is roughly $0.09 (~20k input + ~1.7k
output, Sonnet-class, Armenian at ~1.7 tokens/char). Verifying one change over
five queries costs ~$0.45, and a few rounds of that is real money.

## ARLIS hides articles behind a ⚖ anchor in the heading cell

Articles that have linked court practice carry an `<A>` with `&#9878` (⚖,
U+2696) INSIDE the heading `<td>`, so the cell text reads `⚖Հոդված 2.` and any
`^Հոդված` anchor rejects it. This silently dropped 16 Tax Code articles —
2, 4, 102–105, 109, 238, 328, 330, 333, 335, 342, 343, 398, 408.

The failure is invisible from the app: a missing article looks exactly like a
question the corpus does not cover. It surfaced only because cross-reference
extraction produced 85 citations pointing at articles that did not exist —
**the corpus contradicting itself is the cheapest integrity check available.**
Worth re-running after any parser change: an act that cites articles it does
not contain has lost something.

Strip leading non-letter, non-digit characters before matching any ARLIS
heading. Assume decoration can appear inside a heading cell.

## The embedding cache is keyed by location, not content

`data/vectors/<model>.jsonl` keys slices by `<arlisId>#<ref>`. That identifies
WHERE a chunk sits, not WHAT it says, and the two come apart on any parser or
chunker change — fixing the ⚖ bug moved text out of chunks that had absorbed
it, leaving the same ref with different content. A ref-keyed cache then serves
vectors describing text that no longer exists, and retrieval keeps returning
results that are quietly wrong.

Cache lines now carry a content fingerprint, so a changed chunk is a miss by
construction. If you ever add another cache along this path, key it by content
too — anything keyed by position will eventually go stale without saying so.

## `--only <id>` on the ingest script does not limit what is written

`npm run ingest -- --only 109017` filtered the parse summary but the run still
rewrote every document, cascade-deleting all 1,269 embeddings rather than just
the Tax Code's. Everything is recoverable from snapshots and the vector cache
(~2 minutes), but do not rely on `--only` to bound the blast radius: check
`SELECT count(*) FROM embeddings` after ingesting.

## The append-only vector cache resurrects old text through the loader

`generate.ts` appends a fresh line when a chunk's content changes and never
removes the superseded one, so both lines share one id. `load.ts` grouped by
parent and assigned slice indexes by position — which quietly attached the
OLD-text vector to the article as an extra slice. Retrieval max-pools slices,
so queries kept matching wording that no longer exists in the corpus. Observed
after applying the July-2026 Tax Code amendments: all 7 re-embedded articles
carried old and new vectors side by side, and the stale one was live in search.

The loader now dedupes by id, last line wins (appends are chronological). The
general rule: any consumer of an append-only file must decide what "current"
means — position in the file is provenance, not identity.

## npm eats option flags on workspace scripts — a "dry run" that wiped production

Root scripts are indirections: `"ingest": "npm run ingest -w @armlex/backend"`.
So `npm run ingest -- --dry-run --only 51` expands to
`npm run ingest -w @armlex/backend --dry-run --only 51` — no second `--`. npm
claims every flag it recognises as its own, and it recognises **both**
`--dry-run` and `--only`. Neither reaches tsx. The script sees an empty argv.

On 2026-08-23 that turned an intended one-document dry run into a full
re-ingest of all 21 documents: every `articles` row replaced, and by cascade
**all 5,139 embeddings and the entire `article_refs` graph deleted**. Render
shares the Neon database, so the live site lost its vector leg — answering
Russian and Armenian questions at ~0% — until the disk cache was reloaded.

The tell was available and unread: the report covered 21 documents when one was
requested. `ingest/run.ts` now prints scope beside mode
(`REPORT ONLY · ALL documents · 22 document(s)`) so the mismatch is unmissable.

- **Bare positionals DO survive** the double hop — `npm run audit -- 51` works.
  Only option-shaped flags are eaten. This is why the trap is easy to miss.
- **Fail safe, don't fail useful.** The real defect was that ingest *wrote by
  default* and `--dry-run` was the opt-out, so a lost flag escalated to a
  production rewrite. It is now `--apply`-gated, like `buildRefs.ts` — which
  survived the same swallowing an hour later without incident.
- **Prefer `npx tsx <path> --flags` in docs and habit.** Every file docstring
  that teaches `npm run X -- --flag` is teaching the broken form.
- `crawl/run.ts` was already `--apply`-gated. `reembed.ts` is untraced.

Recovery cost no API calls, by design: `data/vectors/*.jsonl` is keyed by
`<arlisId>#<ref>`, not database id, so cached vectors remap onto freshly
ingested rows. `load.ts --replace` then `buildRefs.ts --apply` restored the
golden set to 88.9 / 92.6 / 87.0 / 0.681 exactly.

**Corollary, cost ~20 minutes on its own:** a benchmark running while the tables
were being rewritten reported `vector + rerank-2.5` at 51.9% and read as a
reranker regression. It was the index vanishing mid-run. `score.ts` cannot tell
an empty index from a retriever that found nothing, and 0.0% is also the real
FTS number — so a wiped index renders as a plausible result table
(`OPEN-ITEMS.md` 24). Never diagnose a retrieval regression without first
confirming the index is populated.
