/**
 * Interface settings, shared through context.
 *
 * Context rather than prop-drilling: the translator is needed at every depth
 * (rail, thread, norm panel, login), and threading it through would make every
 * component signature carry a concern none of them own.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from './i18n.js';

interface Settings {
  /** Whether the consultations rail is shown; remembered across visits. */
  railOpen: boolean;
  toggleRail: () => void;
  /**
   * Explicit open/close. A click on the sidebar's blank ground must only ever
   * CLOSE it, and the collapsed strip's buttons must only ever OPEN it — a
   * toggle wired to either would flip the wrong way whenever the two raced.
   */
  setRail: (open: boolean) => void;
  t: (key: string) => string;
}

const RAIL_KEY = 'armlex.rail';

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RAIL_KEY) !== 'closed';
    } catch {
      return true;
    }
  });

  /* The document's language never changes now, so it is set once. It drives
     font selection and screen-reader pronunciation for the chrome; Armenian
     legal text carries its own lang="hy" regardless. */
  useEffect(() => {
    document.documentElement.lang = 'hy';
  }, []);
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
      setRail: setRailOpen,
      t,
    }),
    [railOpen],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings called outside SettingsProvider');
  return ctx;
}
