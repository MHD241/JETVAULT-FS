// Lifting-surface aerodynamics.
//
// The airframe is broken into lifting surfaces (wing strips, horizontal tail strips,
// fin). Each surface computes its own local airflow from the aircraft's air-relative
// velocity, body rates (omega x r), propeller slipstream, wing downwash and ground
// effect, then evaluates section coefficients over the full +/-180 deg angle-of-attack
// range (attached flow, stall, post-stall flat plate). Damping derivatives, dihedral
// effect, adverse yaw, wing drop at the stall etc. therefore emerge from the geometry
// rather than being prescribed.

import { Vec3, DEG, clamp, smoothstep } from '../../core/math';

export interface AirfoilParams {
  /** 2D lift curve slope, per radian. */
  a0: number;
  /** Zero-lift angle of attack, radians. */
  alpha0: number;
  /** Maximum section lift coefficient (clean). */
  clMax: number;
  /** Minimum (negative) section lift coefficient. */
  clMin: number;
  /** Zero-lift profile drag. */
  cd0: number;
  /** Profile drag rise with cl^2 (form drag). */
  cdK: number;
  /** Pitching moment about the quarter chord. */
  cm0: number;
}

export interface ControlParams {
  /** Fraction of chord: converts deflection into an equivalent AoA change (tau). */
  effectiveness: number;
  /** Change in clMax per radian of deflection (flaps raise clMax, ailerons less so). */
  dClMaxPerRad: number;
  /** Profile drag added per radian^2 of deflection. */
  cdPerRad2: number;
  /** Section pitching moment change per radian of deflection (negative = nose down). */
  cmPerRad: number;
}

export interface SurfaceDef {
  name: string;
  /** Aerodynamic centre (quarter chord, mid-span of strip) in body frame relative to the reference datum. */
  pos: Vec3;
  area: number;
  chord: number;
  /** Unit normal: the direction positive lift acts at zero AoA (e.g. (0,0,-1) for a wing). */
  normal: Vec3;
  /** Incidence relative to body x axis, radians (rotation of chord toward -normal at the trailing edge). */
  incidence: number;
  /** Effective aspect ratio of the parent lifting system (wing, tail, fin). */
  aspectRatio: number;
  /** Oswald efficiency. */
  oswald: number;
  /** Span of the parent lifting system for ground effect, m. */
  span: number;
  airfoil: AirfoilParams;
  control?: ControlParams;
  /** Fraction of this surface immersed in the propeller slipstream (0..1). */
  slipstream: number;
  /** If set, the surface sees the main wing downwash (tail surfaces). */
  downwash: boolean;
  /** 'wing' surfaces contribute to the wing lift used for downwash. */
  role: 'wing' | 'htail' | 'vtail';
}

export interface SurfaceState {
  alpha: number; // local angle of attack, rad
  cl: number;
  cd: number;
  q: number; // dynamic pressure, Pa
  stalled: number; // 0..1 stall blend
  force: Vec3; // body frame, N
  moment: Vec3; // body frame about CG, N m
}

/** Precomputed lift/drag curves over -180..180 deg for one surface. */
export class SectionModel {
  constructor(private s: SurfaceDef) {}

  /** Returns [cl, cd_profile, cm, stallBlend] for effective AoA alpha (rad) and control deflection (rad). */
  coeffs(alpha: number, defl: number): [number, number, number, number] {
    const af = this.s.airfoil;
    const ar = this.s.aspectRatio;
    const ctl = this.s.control;
    // 3D lift slope (Helmbold for low AR, reduces to lifting line at high AR)
    const k = af.a0 / (Math.PI * ar);
    const a = af.a0 / (Math.sqrt(1 + k * k) + k);
    const dAlpha = ctl ? ctl.effectiveness * defl : 0;
    const clMax = af.clMax + (ctl ? Math.max(0, ctl.dClMaxPerRad * defl) : 0);
    const clMin = af.clMin + (ctl ? Math.min(0, ctl.dClMaxPerRad * defl) : 0);
    const ae = alpha - af.alpha0 + dAlpha; // effective angle from zero lift
    // Attached flow is linear up to (clMax - 0.15); a parabolic knee of width 0.3/a then
    // rounds the curve into the peak with zero slope, after which lift decays gradually
    // (trailing-edge stall typical of NACA 24xx sections) and finally joins the flat plate.
    const knee = 0.15;
    const kw = (2 * knee) / a;
    const plateCl = 1.1 * Math.sin(2 * alpha + dAlpha * 0.5);
    let cl: number, stall: number;
    const a1 = (clMax - knee) / a;
    const n1 = (clMin + knee) / a;
    if (ae <= a1 && ae >= n1) {
      cl = a * ae;
      stall = 0;
    } else if (ae > a1) {
      const x = ae - a1;
      if (x < kw) {
        cl = clMax - knee + a * x - (a * x * x) / (2 * kw);
        stall = 0;
      } else {
        const over = x - kw;
        const pre = clMax * (1 - 0.35 * smoothstep(0, 12 * DEG, over));
        stall = smoothstep(0, 5 * DEG, over);
        const w = smoothstep(10 * DEG, 30 * DEG, over);
        cl = pre * (1 - w) + plateCl * w;
      }
    } else {
      const x = n1 - ae;
      if (x < kw) {
        cl = clMin + knee - a * x + (a * x * x) / (2 * kw);
        stall = 0;
      } else {
        const over = x - kw;
        const pre = clMin * (1 - 0.35 * smoothstep(0, 12 * DEG, over));
        stall = smoothstep(0, 5 * DEG, over);
        const w = smoothstep(8 * DEG, 28 * DEG, over);
        cl = pre * (1 - w) + plateCl * w;
      }
    }
    // Large angles (reverse flow): always the plate
    if (Math.abs(alpha) > 60 * DEG) {
      const w = smoothstep(60 * DEG, 90 * DEG, Math.abs(alpha));
      cl = cl * (1 - w) + plateCl * w;
      stall = Math.max(stall, w);
    }
    const sa = Math.sin(alpha);
    const cdPlate = 1.98 * sa * sa;
    const cdAtt = af.cd0 + af.cdK * cl * cl + (ctl ? ctl.cdPerRad2 * defl * defl : 0);
    const cdp = cdAtt * (1 - stall) + Math.max(cdAtt, cdPlate + af.cd0) * stall;
    // moment about quarter chord; past the stall the centre of pressure moves aft toward mid chord
    const cm = af.cm0 * (1 - stall) + (ctl ? ctl.cmPerRad * defl : 0) - 0.25 * stall * (cl * Math.cos(alpha) + cdp * sa) * 0.8;
    return [cl, cdp, cm, stall];
  }

  /** Lift-curve slope actually used (per rad), exposed for downwash estimates. */
  liftSlope() {
    const af = this.s.airfoil;
    const k = af.a0 / (Math.PI * this.s.aspectRatio);
    return af.a0 / (Math.sqrt(1 + k * k) + k);
  }
}

/** Ground-effect factor on induced drag / downwash (McCormick): 1 = free air. */
export function groundEffectFactor(heightAboveGround: number, span: number) {
  if (heightAboveGround <= 0) return 0.05;
  const r = (16 * heightAboveGround) / span;
  return clamp((r * r) / (1 + r * r), 0.05, 1);
}
