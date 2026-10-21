// Numerically extract stability derivatives from the flight model and compare with
// Roskam's Cessna 172 cruise data (per radian).
import { flatWorld, newSim } from '../../tests/helpers';
import { Vec3, Quat, KT, FT } from '../../src/core/math';
import { Aircraft } from '../../src/sim/fdm/aircraft';
const sim = newSim(flatWorld(0));
sim.spawn({ kind: 'runway', ident: '36' });
const ac = sim.aircraft;
const V = 120 * KT, alt = 5000 * FT;
const S = ac.def.wingArea, b = ac.def.wingSpan, cbar = ac.def.mac;
const c = { ...sim.controls, throttle: 0, mags: 'OFF' as const };
// measure body forces/moments for a given state using a 1-step finite difference on velocities
function fm(alpha: number, beta: number, p = 0, q = 0, r = 0, ctl: Partial<typeof c> = {}) {
  const a = new Aircraft(ac.def);
  a.q = Quat.fromEuler(0, 0, 0);
  a.pos = new Vec3(0, 0, -alt);
  const vb = new Vec3(V * Math.cos(alpha) * Math.cos(beta), V * Math.sin(beta), V * Math.sin(alpha) * Math.cos(beta));
  a.vel = vb; a.omega = new Vec3(p, q, r);
  const dt = 1e-4;
  const cc = { ...c, ...ctl };
  // settle control surfaces
  a.elevator = 0; a.rudder = 0; a.aileronL = 0; a.aileronR = 0;
  const v0 = a.vel.clone(), w0 = a.omega.clone(), q0 = a.q.clone(), p0 = a.pos.clone();
  // first pass to find the wing CL, then prime the tail downwash at its steady value
  a.step(dt, cc as any, sim.env, false, false);
  const AR = b * b / S;
  a.downwash = 2 * a.wingCL / (Math.PI * AR * 0.85);
  a.vel = v0.clone(); a.omega = w0.clone(); a.q = q0; a.pos = p0;
  a.step(dt, cc as any, sim.env, false, false);
  const acc = a.vel.sub(v0).scale(1 / dt).sub(new Vec3(0, 0, 9.80665));
  const F = a.q.invRotate(acc).scale(a.mass);
  const wdot = a.omega.sub(w0).scale(1 / dt);
  const Iw = a.inertia.mul(w0);
  const M = a.inertia.mul(wdot).add(w0.cross(Iw));
  const qbar = 0.5 * a.air.density * V * V;
  return { CX: F.x / (qbar * S), CY: F.y / (qbar * S), CZ: F.z / (qbar * S), Cl: M.x / (qbar * S * b), Cm: M.y / (qbar * S * cbar), Cn: M.z / (qbar * S * b), a };
}
const a0 = 2 * Math.PI / 180, d = 0.02;
const base = fm(a0, 0);
const CL = (r: ReturnType<typeof fm>, al: number) => -r.CZ * Math.cos(al) + r.CX * Math.sin(al);
const pr = (name: string, ours: number, roskam: number) => console.log(name.padEnd(8), ours.toFixed(4).padStart(9), roskam.toFixed(4).padStart(9));
console.log('deriv        ours    Roskam C172');
const up = fm(a0 + d, 0), dn = fm(a0 - d, 0);
pr('CL0', CL(fm(0, 0), 0), 0.307);
pr('CLa', (CL(up, a0 + d) - CL(dn, a0 - d)) / (2 * d), 4.41);
pr('Cma', (up.Cm - dn.Cm) / (2 * d), -0.613);
const bp = fm(a0, d), bm = fm(a0, -d);
pr('CYb', (bp.CY - bm.CY) / (2 * d), -0.393);
pr('Clb', (bp.Cl - bm.Cl) / (2 * d), -0.0923);
pr('Cnb', (bp.Cn - bm.Cn) / (2 * d), 0.0587);
const ph = d * 2 * V / b;
const pp = fm(a0, 0, ph), pm = fm(a0, 0, -ph);
pr('Clp', (pp.Cl - pm.Cl) / (2 * d), -0.484);
pr('Cnp', (pp.Cn - pm.Cn) / (2 * d), -0.0278);
const rp = fm(a0, 0, 0, 0, ph), rm = fm(a0, 0, 0, 0, -ph);
pr('Clr', (rp.Cl - rm.Cl) / (2 * d), 0.0798);
pr('Cnr', (rp.Cn - rm.Cn) / (2 * d), -0.0937);
const qh = d * 2 * V / cbar;
const qp = fm(a0, 0, 0, qh), qm = fm(a0, 0, 0, -qh);
pr('Cmq', (qp.Cm - qm.Cm) / (2 * d), -12.4);
console.log('CD at CL', CL(base, a0).toFixed(3), (-base.CX * Math.cos(a0) - base.CZ * Math.sin(a0)).toFixed(4));
