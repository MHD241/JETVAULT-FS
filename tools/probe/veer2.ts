import { flatWorld, newSim, run, kt } from '../../tests/helpers';
import { RAD, Vec3 } from '../../src/core/math';
// engine OFF, aircraft given 15 m/s initial roll, neutral controls: pure gear/aero test
for (const yaw0 of [0, 0.02]) {
  const sim = newSim(flatWorld(0));
  sim.spawn({ kind: 'runway', ident: '36' });
  const ac = sim.aircraft; ac.payload[1] = ac.payload[0]; ac.updateMass();
  const c = sim.controls; c.mags = 'OFF'; c.mixture = 0; c.throttle = 0; c.parkingBrake = false;
  run(sim, 1);
  ac.vel = new Vec3(15, 0, 0); ac.omega = new Vec3(0, 0, yaw0);
  for (let i = 0; i < 5; i++) { run(sim, 1, () => { c.pitch = c.roll = c.yaw = 0; });
    console.log(`yaw0=${yaw0} t=${i + 1} spd ${ac.vel.len().toFixed(1)} hdg ${(ac.euler[2]*RAD).toFixed(2)} r ${(ac.omega.z*RAD).toFixed(2)} lat ${ac.pos.y.toFixed(2)} gear lat forces?`, ac.gearStates.map(g => g.force.toFixed(0)).join('/')); }
}
