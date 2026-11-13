/**
 * Study_Link detection (task 9.1, Requirement 21.1 / 28.3).
 *
 * MineLogic ships as a static site on GitHub Pages with no server router
 * (Requirement 28.2). A Study_Link therefore carries its Study_Code in a way a
 * static host can serve directly on a deep link (28.3). We use a `?study=CODE`
 * query parameter: it survives GitHub Pages' static routing, is trivial to
 * build into a link, and needs no rewrite rules (a hash would also work, but a
 * query param reads cleanly and is what share links tend to use).
 *
 * `detectStudyCode(search)` parses a code out of a URL search string. It is
 * pure (takes the search string) so it is testable without a DOM; the default
 * reads window.location.search when available. When no study param is present
 * it returns null and the app routes normally — guest play, the Hub, and every
 * other screen are untouched when there is no Study_Link.
 */

/** The query parameter a Study_Link uses to carry its Study_Code. */
export const STUDY_PARAM = 'study';

/**
 * Parse the Study_Code from a URL search string (e.g. "?study=SPRING2025").
 * Returns the trimmed code, or null when the param is absent or empty. Accepts
 * a search string with or without the leading "?".
 */
export function detectStudyCode(search: string): string | null {
  if (!search) return null;
  const qs = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(qs);
  const raw = params.get(STUDY_PARAM);
  if (raw == null) return null;
  const code = raw.trim();
  return code.length > 0 ? code : null;
}

/**
 * The Study_Code for the current page, read from window.location.search, or
 * null when there is no Study_Link (or no DOM). This is what App uses on load
 * to decide whether to enter the study module.
 */
export function currentStudyCode(): string | null {
  try {
    if (typeof window !== 'undefined' && window.location) {
      return detectStudyCode(window.location.search);
    }
  } catch {
    // Accessing window can throw in some sandboxed environments.
  }
  return null;
}
