/**
 * The product name, in one place.
 *
 * It was a literal in four files — the masthead, the gate, the label on every
 * assistant turn, and the one-shot answer header — which is how a rename ends
 * up half-applied and a stale name survives in the corner of one screen.
 *
 * Not translated: it is a name, and it reads the same in all three interface
 * languages. Sentences that DECLINE it (Armenian takes MatyanAI-ն) live in the
 * dictionary as ordinary strings, because only the sentence knows the case.
 *
 * Deliberately NOT changed with it: the localStorage keys (armlex.theme,
 * armlex.lang, armlex.rail), the npm workspace names, and the database. Those
 * are internal identifiers; renaming them would silently reset every reader's
 * saved preferences to buy nothing.
 */
export const BRAND = 'MatyanAI';
