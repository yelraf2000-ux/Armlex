/**
 * The smallest router that does the job.
 *
 * Every screen used to be React state, so the address bar said `/` wherever you
 * were. Reload — or deploy, which reloads everybody — and you were back at a
 * blank consultation with no way to say where you had been. The URL is where a
 * browser keeps that, and it already survives reloads, the back button, a
 * bookmark and a pasted link, none of which component state does.
 *
 * No dependency: the app has four screens and the paths are matched with a
 * regex in one place. `pushState` deliberately does NOT fire `popstate` — it
 * only fires for the user's own back and forward — so navigating in code has to
 * announce itself, which is what the event below is for.
 */
import { useEffect, useState } from 'react';

/** Our own navigations. The browser's arrive as `popstate`; these do not. */
const MOVED = 'armlex:navigate';

/**
 * Go somewhere.
 *
 * `replace` for a move the reader did not ask for — a new conversation
 * acquiring its id mid-answer is the same screen gaining a name, and it should
 * not cost them a press of the back button to leave.
 */
export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (path === window.location.pathname) return;
  window.history[opts.replace ? 'replaceState' : 'pushState'](null, '', path);
  window.dispatchEvent(new Event(MOVED));
}

/** The current path, re-rendering on every move however it was made. */
export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', sync);
    window.addEventListener(MOVED, sync);
    // The path can have moved between the first render and this subscription.
    sync();
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(MOVED, sync);
    };
  }, []);
  return path;
}

/**
 * Which half of the workspace, if the path is in it at all.
 *
 * Bare `/workspace` counts as the members list — it is where the page opens —
 * but App corrects the address to say so, rather than leaving two paths that
 * show the same screen.
 */
export function workspaceSectionIn(path: string): 'members' | 'usage' | null {
  if (path === '/workspace' || path === '/workspace/members') return 'members';
  if (path === '/workspace/usage') return 'usage';
  return null;
}

/** `/c/<uuid>` — a conversation. Null for every other path. */
export function sessionIdIn(path: string): string | null {
  return /^\/c\/([0-9a-f-]{36})$/i.exec(path)?.[1] ?? null;
}
