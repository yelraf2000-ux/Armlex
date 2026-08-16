/** Domain types shared across scraper, backend and (later) frontend. */

export type Lang = 'hy' | 'ru' | 'en';

export type DocType =
  | 'code'
  | 'law'
  | 'gov_decision'
  | 'ministerial_order'
  | 'src_clarification';

export type DocStatus = 'in_force' | 'repealed' | 'suspended' | 'unknown';

/**
 * ARLIS act identity. An "act family" is the logical document (e.g. the Tax
 * Code); ARLIS also mints a *separate* act id for every consolidated revision.
 * `arlisId` is the id we treat as canonical (the one whose /latest we follow).
 */
export interface ArlisRef {
  arlisId: number;
  url: string;
}

export const ARLIS_BASE = 'https://www.arlis.am';

/** Consolidated ("latest") view of an act. */
export function actLatestUrl(arlisId: number, lang: Lang = 'hy'): string {
  return `${ARLIS_BASE}/${lang}/acts/${arlisId}/latest`;
}

/** A specific stored revision of an act (no /latest suffix). */
export function actVersionUrl(arlisId: number, lang: Lang = 'hy'): string {
  return `${ARLIS_BASE}/${lang}/acts/${arlisId}`;
}
