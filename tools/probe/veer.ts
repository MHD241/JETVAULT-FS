import { flatWorld, newSim, run, kt } from '../../tests/helpers';
import { RAD, KT, FT } from '../../src/core/math';
for (const sym of [false, true]) for (const thr of [0.3, 1]) {
  const sim = newSim(flatWorld(0));
  sim.spawn({ kind: 'runway', ident: '36' });
  const ac = sim.aircraft;
  if (sym) { ac.payload[1] = ac.payload[0]; ac.updateMass(); }
  sim.controls.throttle = thr; sim.controls.trim = 0;
  run(sim, thr === 1 ? 14 : 20, () => { sim.controls.pitch = 0; sim.controls.roll = 0; sim.controls.yaw = 0; });
  const g = ac.gearStates;
  console.log(`sym=${sym} thr=${thr}: speed ${kt(ac.vel.len()).toFixed(1)} kt, hdg ${(ac.euler[2]*RAD).toFixed(2)} deg, lateral ${ac.pos.y.toFixed(2)} m, cg.y ${ac.cg.y.toFixed(3)}, loads L ${g[1].force.toFixed(0)} R ${g[2].force.toFixed(0)}`);
}
