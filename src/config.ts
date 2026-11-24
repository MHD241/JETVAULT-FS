/**
 * Scope of the game for now: only the Boeing 737-800 at Edinburgh (EGPH). The Cessna, glider, Darter, Glasgow and Portmoak
 * are still in the code (and tests) but hidden from the menus and not loaded. Set to false to bring everything back.
 */
export const FOCUS_MODE = true;
export const FOCUS_AIRPORT = 'EGPH';
/** Airports shown in the menus while FOCUS_MODE is on. */
export const FOCUS_AIRPORTS = ['EGPH', 'EGLL', 'EGKK', 'EGPF'];
export const FOCUS_AIRCRAFT = 'b738';
export const airportVisible = (icao: string) => !FOCUS_MODE || FOCUS_AIRPORTS.includes(icao);

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

/** Aircraft that are free for everybody; the others are bought with JetCoins (see economy.ts) and are all unlocked in the Pro edition (?pro). */
export const FREE_AIRCRAFT = ['b738', 'a320'];
