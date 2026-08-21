# ArmLex — project state

**Read this first in a new session.** `CLAUDE.md` (repo root) is the spec —
what we intend. This file and its siblings below are the state — what is
true, as of the last update to each.

| File | What's in it | Update it when |
|---|---|---|
| **PROJECT-STATE.md** (this file) | Orientation: status, the one thing that matters, where to look next | Milestone status changes |
| [`CHANGELOG.md`](CHANGELOG.md) | Chronological log, one entry per piece of work | You finish anything worth remembering |
| [`OPEN-ITEMS.md`](OPEN-ITEMS.md) | The backlog, prioritized | Something closes or a new gap is found |
| [`DECISIONS.md`](DECISIONS.md) | Choices made and *why* — read before revisiting one | A non-obvious decision is made |
| [`GOTCHAS.md`](GOTCHAS.md) | Technical traps that cost real time once already | You hit a new one |
| [`BENCHMARK.md`](BENCHMARK.md) | Retrieval benchmark methodology, results, provider limits | The benchmark changes |
| [`CRAWLING.md`](CRAWLING.md) | Update detection: what it does, how to accept a change, how to schedule it | Pipeline B changes |

---

## Status at a glance

| Milestone | State |
|---|---|
| 1 · Scaffold, schema, migrations | done — Neon, `db:verify` 43/43 |
| 2 · ARLIS audit | done — 23 documents |
| 3 · Parser + chunkers | done — **902 chunks**, three strategies (⚖ heading bug fixed 2026-08-15, +17 chunks) |
| 4 · Ingest tax corpus | done — 20 documents, 1 alias, `article_refs` 749 edges |
| 5 · Embedding benchmark | **done — Gemini wins decisively**, see `BENCHMARK.md` |
| 5b · Wire retrieval into the app | done — 885/885 chunks in pgvector, HNSW verified |
| 6 · Reranker | **done — `rerank-2.5`, hit@5 73.9% → 87.0%** |
| 7 · Generation layer | **done** — chat, contextualiser, facts, quote validation, streaming, confidence gate |
| 8 · Frontend workbench | **done** — streaming, markdown, quote-highlighted article cards, related articles, session list, corpus banner |
| 9 · Update detection | **done** — article-level diff, `crawl_log`, silence monitor; new-document discovery not built |

Full backlog with priority: `OPEN-ITEMS.md`.

## The one thing that matters right now

Retrieval works. The critical gap that dominated this file for two weeks —
`retrieve()` bound to FTS, scoring 0.0% — is **closed**. The live path is
`enumeration-aware vector top-50 → one-hop citation expansion → rerank-2.5
shown prefix + matched slice → top-N`, measured at **88.9% hit@5 / 92.6% hit@8
/ MRR 0.681** on the 27-question golden set (2026-08-19). The golden set grows
by pinning every diagnosed failure, so the headline number has moved both ways
over time — 91% on a partial index, 84.6% after hard real questions were
pinned, 88.9% after the Class-1 mechanism (enumeration blur) was fixed at the
index and the reranker. Compare like with like: `BENCHMARK.md` records which
set and index each figure was measured on.

What's live in the app, all measured rather than assumed:

| Live in the app | Measured |
|---|---|
| Enumeration-aware index → one-hop expansion → slice-aware rerank | **88.9% hit@5, 92.6% hit@8, MRR 0.681** (27 golden questions) |
| Query contextualiser (transliteration + Armenian legal terms) | rescued the colloquial-question case |
| Running `fact_summary` across turns | verified over 3 turns |
| Verbatim quote validation | 11 tests, exact substring only |
| Language mirroring (hy→hy, ru→ru) | 0 Cyrillic in Armenian answers |
| Session chunk carry-over | round-robin, opening turn never evicted |

The current focus: **systemic fixes over case fixes.** Six diagnosed failures
resolve into three root-cause classes (plane mismatch, named-but-unfetched
norm, corpus boundary — `DECISIONS.md`), with an ordered fix plan in
`OPEN-ITEMS.md` items 20–23. Live head-to-heads against Orin show our edge
(verified column-level quotes, currency) and our gaps (their retrieval found
norms ours missed on form-row questions; Labour Code out of scope).

## Scope reality check

Even with every open item closed, this is a **grounded search tool with
citations**, not an advisor. Someone asking *"I want to open a shop, what
taxes do I pay?"* wants synthesis across turnover tax, micro-business
thresholds, VAT registration, and cash-register rules. The system retrieves
governing articles and refuses to go beyond them — correct and safe for legal
work, but a different product from a recommendation engine. That's a
deliberate design stance (see `CLAUDE.md` grounding principles), not a
limitation to quietly work around.
