// Local transverse Mercator projection centred on the region origin (matches the
// +proj=tmerc definition used by tools/build_geodata.py). Snyder, "Map Projections - A
// Working Manual", eqs. 8-9 .. 8-25 (WGS84 ellipsoid, k0 = 1).

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const D2R = Math.PI / 180;

function meridionalArc(phi: number) {
  const e4 = E2 * E2, e6 = e4 * E2;
  return A * ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
    - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
    - ((35 * e6) / 3072) * Math.sin(6 * phi));
}

export class LocalProjection {
  private M0: number;
  constructor(public lat0: number, public lon0: number) {
    this.M0 = meridionalArc(lat0 * D2R);
  }

  /** WGS84 lat/lon (deg) -> local east/north (m). */
  forward(lat: number, lon: number): { east: number; north: number } {
    const phi = lat * D2R;
    const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
    const N = A / Math.sqrt(1 - E2 * s * s);
    const T = t * t;
    const C = EP2 * c * c;
    const Aa = (lon - this.lon0) * D2R * c;
    const M = meridionalArc(phi);
    const east = N * (Aa + ((1 - T + C) * Aa ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5) / 120);
    const north = M - this.M0 + N * t * (Aa * Aa / 2 + ((5 - T + 9 * C + 4 * C * C) * Aa ** 4) / 24
      + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6) / 720);
    return { east, north };
  }

  /** Local east/north (m) -> WGS84 lat/lon (deg). */
  inverse(east: number, north: number): { lat: number; lon: number } {
    const M = this.M0 + north;
    const mu = M / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
    const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
    const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
      + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
      + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
    const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
    const C1 = EP2 * c * c;
    const T1 = t * t;
    const N1 = A / Math.sqrt(1 - E2 * s * s);
    const R1 = (A * (1 - E2)) / Math.pow(1 - E2 * s * s, 1.5);
    const D = east / N1;
    const lat = phi1 - ((N1 * t) / R1) * (D * D / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24
      + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);
    const lon = (D - ((1 + 2 * T1 + C1) * D ** 3) / 6
      + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) / c;
    return { lat: lat / D2R, lon: this.lon0 + lon / D2R };
  }
}

export const EGPH_ORIGIN = { lat: 55.950145, lon: -3.372288 };
/**
 * Approximate magnetic variation at Edinburgh, degrees (negative = west). Estimated from
 * the trend of the World Magnetic Model for 2025-2027; replace with a WMM evaluation
 * when navigation accuracy matters.
 */
export const EGPH_MAG_VAR = -1.0;
