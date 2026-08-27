/**
 * Interface language and theme, shared through context.
 *
 * Context rather than prop-drilling: the translator is needed at every depth
 * (rail, thread, norm panel, login), and threading it through would make every
 * component signature carry a concern none of them own.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LANGS, initialLang, storeLang, translator } from './i18n.js';
import type { Lang } from './i18n.js';
import { applyTheme, initialTheme } from './theme.js';
import type { Theme } from './theme.js';

interface Settings {
  /** Whether the consultations rail is shown; remembered across visits. */
  railOpen: boolean;
  toggleRail: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  t: (key: string) => string;
}

const RAIL_KEY = 'armlex.rail';

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => FORCED_LANG ?? initialLang());
  const [theme, setThemeState] = useState<Theme>(() => initialTheme());
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RAIL_KEY) !== 'closed';
    } catch {
      return true;
    }
  });

  useEffect(() => { storeLang(lang); }, [lang]);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KEY, railOpen ? 'open' : 'closed');
    } catch {
      /* a blocked localStorage must not break the layout */
    }
  }, [railOpen]);

  const value = useMemo<Settings>(
    () => ({
      railOpen,
      toggleRail: () => setRailOpen((v) => !v),
      lang,
      setLang: setLangState,
      theme,
      setTheme: setThemeState,
      t: translator(lang),
    }),
    [lang, theme, railOpen],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings called outside SettingsProvider');
  return ctx;
}

/**
 * TEST BUILD: the theme switcher is hidden.
 *
 * A tester asked to judge whether the answers are any good should not be
 * spending attention on Light/Dark. Theme still WORKS — 'auto' is the default,
 * `applyTheme` leaves the attribute off, and the stylesheet resolves the OS
 * preference — so a tester on a dark machine still gets the night edition. Only
 * the manual override is out of sight.
 *
 * To restore: flip SHOW_THEME_SWITCHER back to true. Nothing else changed.
 */
const SHOW_THEME_SWITCHER = false;

/**
 * TEST BUILD: Armenian only.
 *
 * Hiding the switcher is not enough on its own. `initialLang()` falls back to
 * the browser's language and then to Russian, so a tester on a Russian or
 * English machine would have landed in an interface they were never meant to
 * see, with the control to leave it removed. FORCED_LANG pins the choice; the
 * other dictionaries are untouched and complete.
 *
 * To restore: set FORCED_LANG to null and SHOW_LANG_SWITCHER to true.
 */
const SHOW_LANG_SWITCHER = false;
const FORCED_LANG: Lang | null = 'hy';

/** Compact switchers for the provenance bar. */
export function SettingsControls() {
  const { lang, setLang, theme, setTheme, t } = useSettings();

  // Words, not dingbats. ◐ ☀ ☾ are typographic strays here — every other
  // control in the edition is a word with a rule under it, and the glyphs
  // rendered differently on every platform anyway.
  const themes: { key: Theme; label: string }[] = [
    { key: 'light', label: t('theme.light') },
    { key: 'dark', label: t('theme.dark') },
  ];

  // With both switchers hidden this would be an empty flex box still claiming a
  // gap in the masthead row. Render nothing instead.
  if (!SHOW_LANG_SWITCHER && !SHOW_THEME_SWITCHER) return null;

  return (
    <div className="settings">
      {SHOW_LANG_SWITCHER ? (
        <div className="switcher" role="group" aria-label="Language">
          {LANGS.map((l) => (
            <button
              key={l.code}
              className={lang === l.code ? 'sw active' : 'sw'}
              aria-pressed={lang === l.code}
              onClick={() => setLang(l.code)}
            >
              {l.label}
            </button>
          ))}
        </div>
      ) : null}

      {SHOW_THEME_SWITCHER ? (
        <div className="switcher" role="group" aria-label="Theme">
          {themes.map((th) => (
            <button
              key={th.key}
              className={theme === th.key ? 'sw active' : 'sw'}
              aria-pressed={theme === th.key}
              onClick={() => setTheme(th.key)}
            >
              {th.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The rail toggle, kept separate from the other controls so it can sit at the
 * far left of the bar.
 *
 * Placed between the mode tabs and the language switcher it read as a fourth
 * mode and went unnoticed; a navigation toggle belongs on the provenance line,
 * before everything else. It names the thing it opens rather than showing a
 * glyph, and `aria-expanded` plus the rule under it carry the state.
 */
export function RailToggle() {
  const { railOpen, toggleRail, t } = useSettings();
  return (
    <button className="rail-toggle" onClick={toggleRail} aria-expanded={railOpen}>
      {t('nav.consultations')}
    </button>
  );
}
