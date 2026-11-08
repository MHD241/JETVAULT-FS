/**
 * Scope of the game for now: only the Boeing 737-800 at Edinburgh (EGPH). The Cessna, glider, Darter, Glasgow and Portmoak
 * are still in the code (and tests) but hidden from the menus and not loaded. Set to false to bring everything back.
 */
export const FOCUS_MODE = true;
export const FOCUS_AIRPORT = 'EGPH';
export const FOCUS_AIRCRAFT = 'b738';
export const airportVisible = (icao: string) => !FOCUS_MODE || icao === FOCUS_AIRPORT;

/**
 * Edition. FREE = the current look (satellite-photo ground, simple lights), kept exactly as released (git branch `free-edition`).
 * PRO = the new authored world (procedural ground, full airport lighting, and later the hand-built airport and city).
 * Pro is switched on with `?pro` in the URL (remembered in localStorage until `?free`).
 */
export const PRO: boolean = (() => {
  try {
    if (typeof location === 'undefined') return false;
    const q = new URLSearchParams(location.search);
    if (q.has('free')) { localStorage.removeItem('jetvault.edition'); return false; }
    if (q.has('pro')) { localStorage.setItem('jetvault.edition', 'pro'); return true; }
    return localStorage.getItem('jetvault.edition') === 'pro';
  } catch { return false; }
})();
