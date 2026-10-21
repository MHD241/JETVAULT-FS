import { loadEGPH, newSim, run, CALM_ISA, kt } from '../../tests/helpers';
import { RAD } from '../../src/core/math';
const world = await loadEGPH();
const sim = newSim(world, CALM_ISA);
sim.spawn({ kind: 'runway', ident: '06' });
const ac = sim.aircraft, c = sim.controls;
c.throttle = 0.3; run(sim, 6);
console.log('speed', kt(ac.vel.len()).toFixed(1), 'hdg', (ac.euler[2]*RAD).toFixed(1));
c.brakeLeft = 1; c.yaw = -1;
for (let i = 0; i < 10; i++) { run(sim, 0.5); const g = ac.gearStates; console.log(i, 'hdg', (ac.euler[2]*RAD).toFixed(1), 'r', (ac.omega.z*RAD).toFixed(1), 'spd', kt(ac.vel.len()).toFixed(1), g.map(s => `${s.wheelSpeed.toFixed(2)}/${s.force.toFixed(0)}/${s.skidding}`).join(' '), 'beta', (ac.beta*RAD).toFixed(0)); }
