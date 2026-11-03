/**
 * Scope of the game for now: only the Boeing 737-800 at Edinburgh (EGPH). The Cessna, glider, Darter, Glasgow and Portmoak
 * are still in the code (and tests) but hidden from the menus and not loaded. Set to false to bring everything back.
 */
export const FOCUS_MODE = true;
export const FOCUS_AIRPORT = 'EGPH';
export const FOCUS_AIRCRAFT = 'b738';
export const airportVisible = (icao: string) => !FOCUS_MODE || icao === FOCUS_AIRPORT;
