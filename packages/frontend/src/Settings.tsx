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
  const [lang, setLangState] = useState<Lang>(() => initialLang());
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

/** Compact switchers for the provenance bar. */
export function SettingsControls() {
  const { lang, setLang, theme, setTheme, t } = useSettings();

  // Words, not dingbats. ◐ ☀ ☾ are typographic strays here — every other
  // control in the edition is a word with a rule under it, and the glyphs
  // rendered differently on every platform anyway.
  //
  // "Auto" is still the DEFAULT — an unset preference follows the OS, and a
  // reader whose machine switches at sunset switches with it. It simply has no
  // button of its own: two words say everything a third one did, and until one
  // is pressed neither is marked, which is what "following the system" looks
  // like. `applyTheme` clears the attribute for 'auto', so nothing else changes.
  const themes: { key: Theme; label: string }[] = [
    { key: 'light', label: t('theme.light') },
    { key: 'dark', label: t('theme.dark') },
  ];

  return (
    <div className="settings">
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
