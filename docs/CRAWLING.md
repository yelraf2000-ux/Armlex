# Update detection (pipeline B)

The corpus is a snapshot of a moving target. A stale corpus fails in the worst
way a legal tool can: it answers confidently, cites a real article, and quotes
text that has been superseded. Nothing about the answer looks wrong.

## What runs

```bash
npm run crawl
```

Re-fetches every ingested document, chunks it exactly as ingestion would, and
compares against the stored chunks. Reports per document: `unchanged`,
`changed` (with the specific articles added / removed / modified), or `error`.
Writes one row to `crawl_log` per run. Exit code is non-zero if anything
errored.

It **does not modify the corpus.** The spec's rule is *serve old data, never
ingest garbage* — a parser broken by a site redesign would otherwise overwrite
a good corpus with an empty one, on a schedule, unattended. `--apply` records
the new hashes once a human has looked.

### Accepting a change

```bash
npm run crawl -- --apply
npm run ingest
npx tsx packages/backend/src/embed/generate.ts gemini-embedding-2
npx tsx packages/backend/src/embed/load.ts gemini-embedding-2 --replace
npx tsx packages/backend/src/ingest/buildRefs.ts --apply
```

Re-embedding is cheap because the vector cache is keyed by content: only chunks
whose text actually changed miss the cache. A full corpus pass costs about two
minutes, and most of it is cache hits.

## Design notes

**Comparison is on chunked text, not raw HTML.** ARLIS pages carry volatile
markup that changes between requests without the law changing; hashing the
response would report everything as modified every run, and a monitor that
always alarms is a monitor nobody reads.

**The baseline is the stored chunks, not a hash column.** `content_hash_hy`
exists in the schema but was never populated by ingestion — comparing against it
reported all 20 documents as changed on the first run. Adding a "record the
baseline" step would have been worse: it would stamp the *current* page as the
baseline, so any amendment made between ingestion and the first crawl would be
absorbed silently and never reported. Comparing live chunks to stored chunks has
no such blind spot.

**A zero-chunk parse is an error, not a repeal.** If a document suddenly parses
to nothing, the page structure moved. Treating that as "the act was emptied"
would delete a good document.

**Silence is monitored.** After 10 days with no detected change the run prints a
warning. A detector that has quietly broken — wrong URL shape, changed markup —
reports "nothing changed" forever, and that looks exactly like a quiet period in
legislation.

## Scheduling

There is no cron on Windows. Register the weekly job with Task Scheduler:

```bash
schtasks /create /tn ArmLexCrawl /sc weekly /d SUN /st 04:00 /tr "cmd /c cd /d C:\Users\Raf\Desktop\ArmLex && npm run crawl >> data\crawl.log 2>&1"
```

Off-peak on purpose: the crawl is rate-limited to one request every
`ARLIS_CRAWL_DELAY_MS` (default 2000 ms), so a 20-document pass is about a
minute of steady, polite traffic.

## Not built: discovery of NEW documents

This job detects changes to documents **already in the corpus**. It does not
find newly published acts. The spec proposes two routes, neither implemented:

1. **ARLIS search by publication date** — needs the search endpoint
   reverse-engineered, and it may require JS rendering (Playwright), which is
   why it was not done blind.
2. **Sequential id probing above the known maximum** — simple, but every
   Armenian legal act shares one id space, so it would fetch a large volume of
   unrelated legislation and then need a classifier to decide what is
   tax-related.

Until one exists, adding a document to the corpus is a manual decision — which
is defensible for a 20-document tax vertical, and would not scale to a second
vertical.
