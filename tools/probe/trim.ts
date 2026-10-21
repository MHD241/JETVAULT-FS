// Static trim solver: finds alpha and elevator for 1 g level flight; reports drag.
import { flatWorld, newSim } from '../../tests/helpers';
import { Vec3, Quat, KT, FT, DEG, RAD } from '../../src/core/math';
import { Aircraft } from '../../src/sim/fdm/aircraft';
import { B738 } from '../../src/sim/aircraft/b738';
import { C172 } from '../../src/sim/aircraft/c172';
const DEF = process.argv[2] === 'c172' ? C172 : B738;
const sim = newSim(flatWorld(0), undefined, DEF);
sim.spawn({ kind: 'runway', ident: '36' });
const mass = Number(process.argv[3] ?? (DEF === B738 ? 65000 : 1000));
function resid(V: number, alt: number, alpha: number, elev: number, flapLever: number, gear: boolean) {
  const a = new Aircraft(DEF);
  a.payload = a.payload.map(() => 0); a.fuel = a.fuel.map(() => 0); a.updateMass();
  a.payload[0] = mass - a.mass; a.updateMass();
  a.q = Quat.fromEuler(0, alpha, 0); a.pos = new Vec3(0, 0, -alt);
  a.vel = new Vec3(V, 0, 0); a.omega = new Vec3();
  a.flap = DEF.controls.flapDetents[flapLever]; a.gearExt = gear ? 1 : 0; a.elevator = elev;
  const AR = DEF.wingSpan ** 2 / DEF.wingArea;
  const c = { ...sim.controls, throttle: 0, mags: 'OFF' as const, mixture: 0, pitch: 0, flapLever, gearDown: gear, trim: 0 };
  // hold elevator by setting the surface time constant to infinity: use pitch input mapping
  const ctl = DEF.controls; const stick = elev < 0 ? -elev / ctl.elevatorUp : -elev / ctl.elevatorDown;
  c.pitch = stick;
  for (let k = 0; k < 2; k++) {
    const v0 = a.vel.clone(), w0 = a.omega.clone(), q0 = a.q.clone(), p0 = a.pos.clone();
    a.elevator = elev; a.flap = DEF.controls.flapDetents[flapLever];
    a.step(1e-4, c as any, sim.env, false, true);
    if (k === 0) { a.downwash = 2 * a.wingCL / (Math.PI * AR * 0.85); a.vel = v0; a.omega = w0; a.q = q0; a.pos = p0; a.time = 0; continue; }
    const acc = a.vel.sub(v0).scale(1e4).sub(new Vec3(0, 0, 9.80665)); // world, minus gravity -> specific force
    const fb = a.q.invRotate(acc).scale(a.mass);
    const wdot = a.omega.sub(w0).scale(1e4);
    // wind axes: lift up, drag back (flight path level)
    const lift = -(fb.z * Math.cos(alpha) - fb.x * Math.sin(alpha));
    const drag = -(fb.x * Math.cos(alpha) + fb.z * Math.sin(alpha));
    return { lift, weight: a.mass * 9.80665, drag, my: wdot.y * a.inertia.iyy, mass: a.mass };
  }
  throw new Error();
}
const cases = DEF === B738 ? [[250, 5000, 0, false], [210, 5000, 1, false], [180, 3000, 3, false], [160, 2000, 5, true], [145, 1500, 7, true], [138, 1500, 8, true]] : [[100, 3000, 0, false], [65, 1000, 3, false]];
for (const [kt, altFt, fl, gear] of cases as [number, number, number, boolean][]) {
  const alt = altFt * FT;
  const rho = 1.225 * Math.pow(1 - 2.2558e-5 * alt, 4.2559);
  const V = kt * KT * Math.sqrt(1.225 / rho);
  let al = 3 * DEG, el = 0;
  for (let it = 0; it < 30; it++) {
    const r = resid(V, alt, al, el, fl, gear);
    const ra = resid(V, alt, al + 1e-3, el, fl, gear), re = resid(V, alt, al, el + 1e-3, fl, gear);
    const f1 = r.lift - r.weight, f2 = r.my;
    const a11 = (ra.lift - r.lift) / 1e-3, a12 = (re.lift - r.lift) / 1e-3, a21 = (ra.my - r.my) / 1e-3, a22 = (re.my - r.my) / 1e-3;
    const det = a11 * a22 - a12 * a21;
    const da = (f1 * a22 - f2 * a12) / det, de = (a11 * f2 - a21 * f1) / det;
    al -= Math.max(-0.03, Math.min(0.03, da)); el -= Math.max(-0.03, Math.min(0.03, de));
  }
  const r = resid(V, alt, al, el, fl, gear);
  console.log(`${kt} KIAS ${altFt} ft flap ${fl} gear ${gear}: alpha ${(al * RAD).toFixed(2)} elev ${(el * RAD).toFixed(2)} deg  L/D ${(r.lift / r.drag).toFixed(1)} drag ${(r.drag / 1000).toFixed(1)} kN (mass ${r.mass.toFixed(0)})`);
}
if (process.argv[4] === 'cl') {
  const V = 155 * KT, q = 0.5 * 1.225 * V * V;
  for (const fl of [0, 3, 7]) {
    const row: string[] = [];
    for (const a of [4, 6, 8, 10, 12, 14, 16]) {
      const r = resid(V, 300, a * DEG, 0, fl, true);
      row.push(`${a}:${(r.lift / (q * DEF.wingArea)).toFixed(2)}`);
    }
    console.log(`flap lever ${fl} CL(alpha):`, row.join(' '));
  }
}
