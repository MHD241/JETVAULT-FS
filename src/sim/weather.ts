import { Vec3, rng, gauss, clamp, FT, KT, DEG } from '../core/math';
import { AtmosphereConditions, T0_STD } from './atmosphere';

export type CloudCover = 'SKC' | 'FEW' | 'SCT' | 'BKN' | 'OVC';

export interface WeatherSettings {
  /** Where the weather came from. Only 'manual' exists until a METAR provider is wired up. */
  source: 'manual' | 'metar';
  /** Direction the wind blows FROM, degrees true. */
  windDirection: number;
  /** Mean wind at 10 m AGL, knots. */
  windSpeed: number;
  /** Gust peak, knots (0 = no gusts). */
  gustSpeed: number;
  /** 0..1 turbulence intensity (0 none, 0.33 light, 0.66 moderate, 1 severe). */
  turbulence: number;
  /** Surface (field elevation) temperature, deg C. */
  temperatureC: number;
  /** QNH, hPa. */
  qnh: number;
  /** Visibility, metres. */
  visibility: number;
  cloudCover: CloudCover;
  /** Cloud base, ft AMSL. */
  cloudBaseFt: number;
  /** 0..1 rain intensity (visual only for now). */
  rain: number;
  /** Time of day, hours local (0..24). */
  timeOfDay: number;
  /** Day of year 1..366 for sun position. */
  dayOfYear: number;
}

export const DEFAULT_WEATHER: WeatherSettings = {
  source: 'manual',
  windDirection: 240,
  windSpeed: 8,
  gustSpeed: 0,
  turbulence: 0.15,
  temperatureC: 12,
  qnh: 1013.25,
  visibility: 30000,
  cloudCover: 'SCT',
  cloudBaseFt: 3500,
  rain: 0,
  timeOfDay: 13,
  dayOfYear: 172,
};

/** Converts surface weather to atmosphere model conditions (field elevation in m). */
export function atmosphereFromWeather(w: WeatherSettings, fieldElev: number): AtmosphereConditions {
  const isaAtField = T0_STD - 0.0065 * fieldElev;
  return { seaLevelPressure: w.qnh * 100, isaDeviation: w.temperatureC + 273.15 - isaAtField };
}

/**
 * Wind field: mean wind with a logarithmic boundary layer profile, discrete gusts, and
 * continuous turbulence using first-order (Dryden-like) filtered noise with MIL-F-8785C
 * low-altitude length scales. Output is the air velocity in world NED (m/s).
 */
export class WindModel {
  settings: WeatherSettings;
  private r: () => number;
  private turb = new Vec3();
  private gustPhase = 0;
  private gustValue = 0;
  private gustTarget = 0;

  constructor(settings: WeatherSettings, seed = 1) {
    this.settings = settings;
    this.r = rng(seed);
  }

  /** Mean wind (no gusts / turbulence) at height AGL, world NED. */
  meanWind(agl: number): Vec3 {
    const w = this.settings;
    const z0 = 0.05; // roughness length (open terrain / airfield)
    const h = clamp(agl, 1, 2000);
    const factor = Math.min(Math.log(h / z0) / Math.log(10 / z0), 1.6);
    const spd = w.windSpeed * KT * factor;
    const from = w.windDirection * DEG;
    // Blowing FROM `from` means air moves toward from+180
    return new Vec3(-Math.cos(from) * spd, -Math.sin(from) * spd, 0);
  }

  /** Advance turbulence state; airspeed (m/s) sets the spatial-to-temporal frequency. */
  step(dt: number, agl: number, airspeed: number) {
    const w = this.settings;
    // Gusts: random gust events toward the reported peak
    if (w.gustSpeed > w.windSpeed) {
      this.gustPhase -= dt;
      if (this.gustPhase <= 0) {
        this.gustPhase = 2 + this.r() * 6;
        this.gustTarget = this.r() < 0.5 ? (w.gustSpeed - w.windSpeed) * (0.4 + 0.6 * this.r()) : 0;
      }
      this.gustValue += (this.gustTarget - this.gustValue) * (1 - Math.exp(-dt / 1.2));
    } else {
      this.gustValue = 0;
    }
    // Continuous turbulence
    const hFt = clamp(agl / FT, 10, 1000);
    // MIL-F-8785C: sigma_w = 0.1 * W20, with W20 = 15/30/45 kt for light/moderate/severe
    const sigW = 0.1 * (w.turbulence * 45) * KT;
    const sigU = sigW / Math.pow(0.177 + 0.000823 * hFt, 0.4);
    const Lw = hFt * FT;
    const Lu = (hFt / Math.pow(0.177 + 0.000823 * hFt, 1.2)) * FT;
    const V = Math.max(airspeed, 5);
    const ou = (s: number, L: number, sigma: number) => {
      const a = Math.exp((-V * dt) / L);
      return s * a + sigma * Math.sqrt(1 - a * a) * gauss(this.r);
    };
    this.turb.x = ou(this.turb.x, Lu, sigU);
    this.turb.y = ou(this.turb.y, Lu, sigU);
    this.turb.z = ou(this.turb.z, Lw, sigW);
  }

  /** Total wind at height AGL in world NED. Turbulence components are aligned with the mean wind. */
  windAt(agl: number): Vec3 {
    const m = this.meanWind(agl);
    const spd = m.len();
    const dir = spd > 0.01 ? m.scale(1 / spd) : new Vec3(1, 0, 0);
    const gust = this.gustValue * KT;
    const fade = clamp(agl / 3, 0, 1); // vertical gusts vanish at the surface
    return new Vec3(
      m.x + dir.x * (gust + this.turb.x) - dir.y * this.turb.y,
      m.y + dir.y * (gust + this.turb.x) + dir.x * this.turb.y,
      this.turb.z * fade,
    );
  }
}
