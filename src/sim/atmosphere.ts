// International Standard Atmosphere (ICAO Doc 7488) troposphere + lower stratosphere,
// generalised for non-standard sea-level pressure (QNH) and temperature (ISA deviation).

export const R_AIR = 287.05287; // J/(kg K)
export const GAMMA = 1.4;
export const G0 = 9.80665;
export const P0_STD = 101325; // Pa
export const T0_STD = 288.15; // K
export const RHO0_STD = 1.225; // kg/m^3
export const LAPSE = 0.0065; // K/m
const TROPOPAUSE = 11000;

export interface AirState {
  pressure: number; // Pa (static)
  temperature: number; // K
  density: number; // kg/m^3
  speedOfSound: number; // m/s
}

export interface AtmosphereConditions {
  /** Sea level pressure, Pa (QNH equivalent). */
  seaLevelPressure: number;
  /** ISA temperature deviation, K. */
  isaDeviation: number;
}

export const STANDARD: AtmosphereConditions = { seaLevelPressure: P0_STD, isaDeviation: 0 };

/** Air properties at geometric altitude h (m MSL). */
export function airAt(h: number, c: AtmosphereConditions = STANDARD, out?: AirState): AirState {
  const T0 = T0_STD + c.isaDeviation;
  const p0 = c.seaLevelPressure;
  const expo = G0 / (R_AIR * LAPSE);
  let T: number, p: number;
  if (h <= TROPOPAUSE) {
    T = T0 - LAPSE * h;
    p = p0 * Math.pow(T / T0, expo);
  } else {
    const T11 = T0 - LAPSE * TROPOPAUSE;
    const p11 = p0 * Math.pow(T11 / T0, expo);
    T = T11;
    p = p11 * Math.exp((-G0 * (h - TROPOPAUSE)) / (R_AIR * T11));
  }
  const rho = p / (R_AIR * T);
  const a = Math.sqrt(GAMMA * R_AIR * T);
  if (out) {
    out.pressure = p; out.temperature = T; out.density = rho; out.speedOfSound = a;
    return out;
  }
  return { pressure: p, temperature: T, density: rho, speedOfSound: a };
}

/** Pressure altitude (m) for a static pressure, standard datum. */
export function pressureAltitude(p: number): number {
  return (T0_STD / LAPSE) * (1 - Math.pow(p / P0_STD, (R_AIR * LAPSE) / G0));
}

/** Altimeter reading (m) for static pressure p with Kollsman setting (Pa). */
export function indicatedAltitude(p: number, kollsman: number): number {
  return (T0_STD / LAPSE) * (1 - Math.pow(p / kollsman, (R_AIR * LAPSE) / G0));
}

/**
 * Calibrated airspeed (m/s) from impact pressure qc and static pressure, using the
 * subsonic compressible pitot relation referenced to sea-level standard.
 */
export function casFromImpactPressure(qc: number): number {
  if (qc <= 0) return 0;
  const k = (GAMMA - 1) / GAMMA;
  return Math.sqrt(((2 * GAMMA) / (GAMMA - 1)) * (P0_STD / RHO0_STD) * (Math.pow(qc / P0_STD + 1, k) - 1));
}

/** Impact (pitot minus static) pressure for true airspeed v at the given air state. */
export function impactPressure(v: number, air: AirState): number {
  const M = v / air.speedOfSound;
  return air.pressure * (Math.pow(1 + ((GAMMA - 1) / 2) * M * M, GAMMA / (GAMMA - 1)) - 1);
}
