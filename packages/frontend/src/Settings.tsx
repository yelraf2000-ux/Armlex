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

  const themes: { key: Theme; glyph: string; label: string }[] = [
    { key: 'auto', glyph: '◐', label: t('theme.auto') },
    { key: 'light', glyph: '☀', label: t('theme.light') },
    { key: 'dark', glyph: '☾', label: t('theme.dark') },
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
            title={th.label}
            onClick={() => setTheme(th.key)}
          >
            <span aria-hidden="true">{th.glyph}</span>
            <span className="sr-only">{th.label}</span>
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
 * mode and went unnoticed; a navigation toggle belongs before the brand, where
 * every other application puts one. The icon also states which way it acts —
 * ☰ to open, ✕ to close — because a pressed-state colour alone does not say
 * what the button will do next.
 */
export function RailToggle() {
  const { railOpen, toggleRail, t } = useSettings();
  return (
    <button
      className="rail-toggle"
      onClick={toggleRail}
      aria-expanded={railOpen}
      title={t('nav.consultations')}
    >
      <span aria-hidden="true">{railOpen ? '✕' : '☰'}</span>
      <span className="sr-only">{t('nav.consultations')}</span>
    </button>
  );
}
