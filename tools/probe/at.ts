import { flatWorld, newSim, run } from '../../tests/helpers';
import { FT, RAD } from '../../src/core/math';
import { AutoTrim } from '../../src/sim/assists';
import { B738 } from '../../src/sim/aircraft/b738';
const sim = newSim(flatWorld(0), undefined, B738);
sim.spawnAir(0, -20000, 3000, 0);
sim.controls.trim = 0.25;
const at = new AutoTrim(); const a0 = sim.aircraft.altitude;
for (let i = 0; i < 12; i++) { run(sim, 5, () => { sim.controls.pitch = 0; sim.controls.roll = -sim.aircraft.euler[0]; at.update(1/240, sim.aircraft, sim.controls, 0); });
  const ac = sim.aircraft; console.log(`${(i+1)*5}s dAlt ${((ac.altitude-a0)/FT).toFixed(0)} pitch ${(ac.euler[1]*RAD).toFixed(1)} kias ${(sim.systems.ind.iasKt).toFixed(0)} trim ${sim.controls.trim.toFixed(2)} elev ${(ac.elevator*RAD).toFixed(1)} q ${(ac.omega.y*RAD).toFixed(2)}`); }
