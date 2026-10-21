import { flatWorld, newSim, run, kt } from '../../tests/helpers';
import { FT, KT, RAD } from '../../src/core/math';
const trim = Number(process.argv[2] ?? 0.3), thr = Number(process.argv[3] ?? 1);
const sim = newSim(flatWorld(0));
sim.spawn({ kind: 'runway', ident: '36' });
sim.aircraft.placeInFlight(0, 1000, 1500 * FT, 0, 75 * KT, 0.05);
const c = sim.controls; c.throttle = thr; c.trim = trim;
for (let i = 0; i < 30; i++) {
  run(sim, 3, () => { c.roll = -sim.aircraft.euler[0] * 2; c.pitch = 0; c.yaw = sim.aircraft.beta * 4; });
  const ac = sim.aircraft;
  console.log(`${(i + 1) * 3}s KCAS ${kt(ac.cas).toFixed(0)} vs ${(-ac.vel.z / FT * 60).toFixed(0)} pitch ${(ac.euler[1] * RAD).toFixed(1)} alpha ${(ac.alpha * RAD).toFixed(1)} q ${(ac.omega.y * RAD).toFixed(1)} elev ${(ac.elevator * RAD).toFixed(1)} tailalpha ${(ac.surfaces.find(s => s.def.name === 'htailL')!.alpha * RAD).toFixed(1)} dw ${(ac.downwash*RAD).toFixed(1)} stall ${ac.surfaces[0].stall.toFixed(2)}`);
}
