import { flatWorld, loadEGPH, newSim, run } from '../../tests/helpers';
import { FT, KT } from '../../src/core/math';
const world = await loadEGPH();
for (const [name, w] of [['flat', flatWorld(0)], ['EGPH real terrain + buildings', world]] as const) {
  const sim = newSim(w as any);
  sim.spawn({ kind: 'runway', ident: name === 'flat' ? '36' : '24' });
  sim.aircraft.placeInFlight(0, 1000, 3000 * FT, 0, 100 * KT, 0);
  sim.controls.throttle = 0.65;
  const t0 = performance.now();
  run(sim, 300);
  const ms = performance.now() - t0;
  console.log(`${name}: 300 s simulated (${300 * 240} steps) in ${ms.toFixed(0)} ms -> ${(ms / (300 * 240) * 1000).toFixed(1)} us/step, ${(300000 / ms).toFixed(0)}x real time`);
}
