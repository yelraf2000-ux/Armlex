/**
 * Light / dark, with "auto" as a real third state rather than a hidden default.
 *
 * The stylesheet already resolves three cases: bare `:root` carries the light
 * palette, `@media (prefers-color-scheme: dark)` guarded by
 * `:root:not([data-theme="light"])` handles an unset preference, and
 * `:root[data-theme="dark"]` lets an explicit choice win over the OS. All this
 * needs to do is stamp — or remove — the attribute.
 *
 * "Auto" removes the attribute entirely instead of resolving to a value now.
 * A viewer whose OS switches at sunset should switch with it, and freezing
 * today's resolution would silently break that.
 */
export type Theme = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'armlex.theme';

export function initialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'auto';
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') {
    root.removeAttribute('data-theme');
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  root.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
}
