import { flatWorld, newSim, run, ft, LandingPilot } from '../../tests/helpers';
for (const flaps of [3, 0]) {
const sim = newSim(flatWorld(0));
sim.spawn({ kind: 'approach', ident: '36', distanceNm: 2 });
const ac = sim.aircraft;
ac.payload[1] = 1157 - ac.mass; ac.updateMass();
sim.controls.flapLever = flaps;
const lp = new LandingPilot(sim, 0, 0, 0, 0, flaps ? 62 : 70, 300);
run(sim, 300, () => { lp.step(); if (lp.phase === 'stopped') return true; });
const td = lp.touchdown!;
console.log(flaps, lp.phase, 'td', td && { ...td }, 'roll ft', lp.stop && ft(lp.stop.y - td.y).toFixed(0), ac.crashed, ac.crashReason, 'cross', ac.pos.y.toFixed(1));
}
