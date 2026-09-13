/**
 * A sentence with the product's own name set apart inside it.
 *
 * The name is a `{brand}` placeholder in the dictionaries rather than written
 * into each translation, for two reasons: only the sentence knows how to
 * decline it — Armenian takes MatyanAI-ն, Russian leaves it bare — and the name
 * itself is the one word that never gets translated. Splitting on the
 * placeholder is what lets it carry the accent while the sentence around it
 * stays body text.
 *
 * Used by every screen that greets someone who is not signed in yet, and by the
 * empty consultation screen, which had its own copy of this until now.
 */
import type { ReactNode } from 'react';
import { BRAND } from './brand.js';

export function BrandLine({ text }: { text: string }): ReactNode {
  return text
    .split('{brand}')
    .flatMap((part, i) =>
      i === 0 ? [part] : [<span key={i} className="brand-name">{BRAND}</span>, part],
    );
}
