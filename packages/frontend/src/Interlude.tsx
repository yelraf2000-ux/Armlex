/**
 * Statute to read while the answer is being prepared.
 *
 * The wait to the first word is about seven seconds — two model calls and a
 * retrieval — and it was a typing indicator and nothing else.
 *
 * Three things this must not do, all of them the same worry: a reader who sees
 * a legal sentence inside MatyanAI takes it as law.
 *
 *  - It is never mistaken for the answer. It is labelled, set apart, and gone
 *    the instant the first word of the answer arrives.
 *  - It is never mistaken for the basis of the answer. It carries its own
 *    citation and never enters the sources column, which means one thing only:
 *    what the answer rests on.
 *  - It is never invented. Every word comes verbatim from the corpus — see
 *    `interlude.ts` on the server for why that rules out a hand-written list.
 *
 * One at a time, changed on a slow beat. In practice most waits show exactly
 * one; the rotation is for the times retrieval runs long.
 */
import { useEffect, useState } from 'react';
import { useSettings } from './Settings.js';

interface Item {
  text: string;
  ref: string;
  documentTitle: string;
  arlisId: number;
}

/*
 * Fetched once per page, not per question, and deliberately not awaited by
 * anything: if it fails or is slow the wait simply looks the way it used to.
 */
let pending: Promise<Item[]> | null = null;
function load(): Promise<Item[]> {
  pending ??= fetch('/api/interlude')
    .then((r) => (r.ok ? r.json() : { interludes: [] }))
    .then((d: { interludes?: Item[] }) => d.interludes ?? [])
    .catch(() => []);
  return pending;
}

/** Long enough to read a sentence of statute without hurrying. */
const BEAT_MS = 7000;

export function Interlude() {
  const { t } = useSettings();
  const [items, setItems] = useState<Item[]>([]);
  const [at, setAt] = useState(0);

  useEffect(() => {
    let live = true;
    void load().then((got) => {
      if (!live) return;
      // A different one each time the wait begins, rather than everyone in the
      // country reading the same article all morning.
      setAt(Math.floor(Math.random() * Math.max(got.length, 1)));
      setItems(got);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => setAt((i) => (i + 1) % items.length), BEAT_MS);
    return () => clearInterval(timer);
  }, [items.length]);

  const item = items[at % Math.max(items.length, 1)];
  if (!item) return null;

  return (
    <div className="interlude">
      <div className="interlude-label">{t('interlude.label')}</div>
      {/* Keyed on the index so React remounts it and the fade runs again. */}
      <p className="interlude-text" lang="hy" key={at}>
        {item.text}
      </p>
      <div className="interlude-ref" lang="hy">
        {item.documentTitle.length > 42 ? `${item.documentTitle.slice(0, 42)}…` : item.documentTitle}
        {', '}
        {item.ref}
      </div>
    </div>
  );
}
