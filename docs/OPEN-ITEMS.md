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
