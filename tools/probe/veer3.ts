import { flatWorld, newSim, run, kt } from '../../tests/helpers';
import { RAD } from '../../src/core/math';
import { C172 } from '../../src/sim/aircraft/c172';
for (const swirl of [0.06, 0]) {
  (C172 as any).swirl = swirl;
  const sim = newSim(flatWorld(0));
  sim.spawn({ kind: 'runway', ident: '36' });
  const ac = sim.aircraft; ac.payload[1] = ac.payload[0]; ac.updateMass();
  sim.controls.throttle = 0.3;
  run(sim, 8, () => { sim.controls.pitch = sim.controls.roll = sim.controls.yaw = 0; });
  console.log(`swirl ${swirl}: spd ${kt(ac.vel.len()).toFixed(1)} hdg ${(ac.euler[2]*RAD).toFixed(2)} thrust ${ac.engine.thrust.toFixed(0)} Qprop ${ac.engine.propTorque.toFixed(0)} rudder ${(ac.rudder*RAD).toFixed(2)} ailL ${(ac.aileronL*RAD).toFixed(2)} ailR ${(ac.aileronR*RAD).toFixed(2)} steer ${ac.gearStates[0].steer.toFixed(3)} loads ${ac.gearStates.map(g=>g.force.toFixed(0)).join('/')}`);
}
