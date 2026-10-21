import { flatWorld, newSim, run, kt, TestPilot } from '../../tests/helpers';
import { FT, KT, RAD } from '../../src/core/math';
const mode = process.argv[2] ?? 'power';
const sim = newSim(flatWorld(0));
sim.spawn({ kind: 'runway', ident: '36' });
sim.aircraft.placeInFlight(0, 1000, 4000 * FT, 0, 106 * KT, 0);
const c = sim.controls; c.throttle = mode === 'power' ? 0.62 : 0;
if (mode !== 'power') { c.mags = 'OFF'; c.mixture = 0; }
const p = new TestPilot(sim);
run(sim, 90, () => { if (mode === 'power') p.holdAltitudeWithPitch(4000 * FT); else p.holdSpeedWithPitch(80); p.wingsLevel(0); c.trim = Math.max(-1, Math.min(1, c.trim + c.pitch / 240 * 0.8)); });
console.log('trim', c.trim.toFixed(3), 'stick', c.pitch.toFixed(3), 'roll', c.roll.toFixed(3), 'yaw', c.yaw.toFixed(3));
c.pitch = 0; c.roll = 0; c.yaw = 0;
const ac = sim.aircraft;
for (let i = 0; i < 12; i++) { run(sim, 10); const [phi, th, psi] = ac.euler; console.log(`${(i+1)*10}s bank ${(phi*RAD).toFixed(1)} pitch ${(th*RAD).toFixed(1)} hdg ${(psi*RAD).toFixed(0)} KCAS ${kt(ac.cas).toFixed(0)} alt ${(ac.altitude/FT).toFixed(0)} beta ${(ac.beta*RAD).toFixed(2)} p ${(ac.omega.x*RAD).toFixed(2)} r ${(ac.omega.z*RAD).toFixed(2)}`); }
