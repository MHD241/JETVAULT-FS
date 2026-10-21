import { flatWorld, newSim, run, kt } from '../../tests/helpers';
import { FT, KT, RAD } from '../../src/core/math';
for (const trim of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) {
  for (const thr of [1, 0.45]) {
    const sim = newSim(flatWorld(0));
    sim.spawn({ kind: 'runway', ident: '36' });
    sim.aircraft.placeInFlight(0, 1000, 1500 * FT, 0, 75 * KT, 0.05);
    const c = sim.controls; c.throttle = thr; c.trim = trim;
    run(sim, 90, () => { c.roll = -sim.aircraft.euler[0] * 2; c.pitch = 0; c.yaw = sim.aircraft.beta * 4; });
    const ac = sim.aircraft;
    console.log(`trim ${trim} thr ${thr}: KCAS ${kt(ac.cas).toFixed(0)} vs ${(-ac.vel.z / FT * 60).toFixed(0)} fpm pitch ${(ac.euler[1] * RAD).toFixed(1)}`);
  }
}
