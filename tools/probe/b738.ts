import { flatWorld, newSim, run, kt, ft, TestPilot } from '../../tests/helpers';
import { RAD, KT, FT, DEG, clamp } from '../../src/core/math';
import { B738 } from '../../src/sim/aircraft/b738';
const mode = process.argv[2];
if (mode === 'level') for (const [kias, thr, flap] of [[250, 0.7, 0], [180, 0.55, 0], [150, 0.6, 5]] as const) {
  const sim = newSim(flatWorld(0), undefined, B738);
  sim.spawnAir(0, -20000, 5000, 0);
  const ac = sim.aircraft; ac.placeInFlight(0, -20000, 5000 * FT, 0, kias * KT * 1.08, 0);
  sim.controls.throttle = thr; sim.controls.flapLever = flap; ac.flap = B738.controls.flapDetents[flap];
  const p = new TestPilot(sim);
  run(sim, 120, () => { p.holdAltitudeWithPitch(5000 * FT); p.wingsLevel(0); sim.controls.throttle = clamp(sim.controls.throttle + (kias - kt(ac.cas)) * 0.0002, 0, 1); });
  console.log(`${kias} kt flap ${flap}: KCAS ${kt(ac.cas).toFixed(0)} thr ${sim.controls.throttle.toFixed(2)} N1 ${(ac.engine.rpm/100).toFixed(1)} alpha ${(ac.alpha*RAD).toFixed(1)} pitch ${(ac.euler[1]*RAD).toFixed(1)} elev ${(ac.elevator*RAD).toFixed(1)} stick ${sim.controls.pitch.toFixed(2)} ff ${(ac.engines.reduce((a,e)=>a+e.fuelFlow,0)*3600).toFixed(0)} kg/h mass ${ac.mass.toFixed(0)}`);
}
if (mode === 'takeoff') {
  const sim = newSim(flatWorld(0), undefined, B738);
  sim.spawn({ kind: 'runway', ident: '36' });
  const ac = sim.aircraft, c = sim.controls;
  console.log('mass', ac.mass.toFixed(0), 'cg', ac.cg.x.toFixed(2), 'gear', ac.gearStates.map(g => (g.force/1000).toFixed(0)+'kN '+g.compression.toFixed(2)).join(' '), 'flap', ac.flap*RAD);
  c.throttle = 0.95; c.brakeLeft = c.brakeRight = 0;
  let t1 = 0, vr = 0, lo = 0, loT = 0;
  run(sim, 90, (t) => {
    const [phi, th, psi] = ac.euler;
    c.yaw = clamp(-psi * 4 - ac.pos.y * 0.03 - ac.omega.z * 2, -1, 1); c.roll = clamp(-phi * 2, -1, 1);
    const ias = kt(ac.cas);
    if (ias > 148) { if (!vr) vr = ac.pos.x; const tgt = ac.onGround ? 8 * DEG : 14 * DEG; c.pitch = clamp(1.5 * (tgt - th) - 2.5 * ac.omega.y + 0.2, -1, 1); } else c.pitch = 0;
    if (t > 2 && !ac.onGround && !lo) { lo = ac.pos.x; loT = t; console.log('liftoff KIAS', ias.toFixed(0), 'pitch', (th*RAD).toFixed(1), 't', t.toFixed(1), 'dist m', lo.toFixed(0)); }
    if (lo && ac.agl > 35 * FT + 4) { console.log('35 ft at', ac.pos.x.toFixed(0), 'm KIAS', ias.toFixed(0)); return true; }
    if (ac.crashed) { console.log('CRASH', ac.crashReason); return true; }
  });
  console.log('rotate at m', vr.toFixed(0), 'N1', (ac.engine.rpm/100).toFixed(1), 'thrust kN', (ac.engines.reduce((a,e)=>a+e.thrust,0)/1000).toFixed(0), 'events', ac.events.map(e=>e.name).join(','));
}
