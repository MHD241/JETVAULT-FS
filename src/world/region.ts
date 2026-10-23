// Selectable map regions. Each has its own data folder (public/data/<id>) built by tools/*.py with AIRPORT=<id>.
// Switching reloads the page (the world is loaded once at start-up).

export interface RegionInfo { id: string; icao: string; name: string; blurb: string }

export const REGIONS: RegionInfo[] = [
  { id: 'egph', icao: 'EGPH', name: 'Edinburgh Airport', blurb: 'Runway 06/24 · 48 km of real terrain, taxiways, terminal with jet bridges' },
  { id: 'egpm', icao: 'EGPM', name: 'Portmoak (Scottish Gliding Centre)', blurb: 'Grass strip below the Lomond Hills · 32 km of real terrain · glider site' },
];

const KEY = 'jv-airport';

export function currentRegion(): string {
  try {
    const q = new URLSearchParams(location.search).get('airport');
    const s = q ?? localStorage.getItem(KEY);
    if (s && REGIONS.some((r) => r.id === s)) return s;
  } catch { /* storage or location unavailable */ }
  return 'egph';
}

export function switchRegion(id: string) {
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  location.reload();
}
