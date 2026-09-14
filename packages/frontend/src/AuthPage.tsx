/**
 * A page for someone who is not signed in yet: the product's own masthead over
 * a centred card.
 *
 * Verify, reset and invite each drew a 42px centred title of their own — the
 * design every other screen left behind when the mark moved to the top-left
 * corner. So these were the screens where the name sat somewhere else, at a
 * different size, and did nothing when clicked. They take the same masthead as
 * everything else now, and the mark goes home from here as it does everywhere.
 */
import type { ReactNode } from 'react';
import { BRAND } from './brand.js';

export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="provenance">
        <div className="masthead-top">
          {/*
            A real link, not a button that sets state. These pages are reached
            from a link in an email, with a one-time token in the address, and
            going home has to leave that address behind — a full load of / is
            exactly that, and it is what the shared-conversation page does too.
          */}
          <a className="brand" href="/">
            {BRAND}
          </a>
        </div>
      </header>
      <div className="login">{children}</div>
    </>
  );
}
